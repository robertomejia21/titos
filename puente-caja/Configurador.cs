using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PuenteCaja;

/// <summary>
/// Lógica de la página http://localhost:{puerto}/configurar: muestra los puertos COM, busca el escáner
/// y la báscula, y guarda lo encontrado en puente-caja.json sin reiniciar el puente.
/// </summary>
public sealed class Configurador
{
    private readonly Configuracion _cfg;
    private readonly Dispositivos _dispositivos;
    private readonly Func<string?> _asegurarPuertoDispositivos;
    private readonly object _candado = new();
    private SesionDeteccion? _sesion;
    private Task _tarea = Task.CompletedTask;

    public Configurador(Configuracion cfg, Dispositivos dispositivos, Func<string?> asegurarPuertoDispositivos)
    {
        _cfg = cfg;
        _dispositivos = dispositivos;
        _asegurarPuertoDispositivos = asegurarPuertoDispositivos;
    }

    public string RutaArchivo => _cfg.RutaArchivo ?? Path.Combine(AppContext.BaseDirectory, "puente-caja.json");

    public object Estado(bool escuchandoPuertoDispositivos)
    {
        var d = _dispositivos.Configuracion;
        return new
        {
            ok = true,
            version = ServidorHttp.Version,
            equipo = Environment.MachineName,
            archivo = RutaArchivo,
            puertoPrincipal = _cfg.Puerto,
            puertoDispositivos = d.PuertoHttp > 0 ? d.PuertoHttp : _cfg.Puerto,
            escuchandoPuertoDispositivos,
            pausado = _dispositivos.Pausado,
            puertos = PuertosCom.Listar().Select(p => new { nombre = p.Nombre, descripcion = p.Descripcion, omitido = p.Omitir }).ToArray(),
            dispositivos = d,
            diagnostico = _dispositivos.Diagnostico(),
            escaner = _dispositivos.Escaner().cuerpo,
            bascula = _dispositivos.Peso().cuerpo,
            comandos = Detector.ComandosBascula.Select(c => new { comando = c.Comando, protocolo = c.Protocolo, nombre = c.Nombre }).ToArray(),
            deteccion = _sesion?.Vista(),
        };
    }

    public (int status, object cuerpo) Detectar(string? tipo)
    {
        if (tipo is not ("escaner" or "bascula")) return (400, new { ok = false, error = "tipo debe ser \"escaner\" o \"bascula\"" });
        lock (_candado)
        {
            if (_sesion is { Estado: "buscando" }) return (409, new { ok = false, error = "Ya hay una búsqueda en curso." });
            var puertos = PuertosCom.Listar().Where(p => !p.Omitir).Select(p => p.Nombre).ToList();
            if (puertos.Count == 0)
                return (409, new { ok = false, error = "Esta PC no tiene puertos COM (sin contar los de Bluetooth). Si el lector es USB tipo teclado, no necesita configurarse aquí." });

            var s = new SesionDeteccion(tipo, tipo == "escaner" ? Detector.SegundosEscaner : Detector.SegundosBascula);
            foreach (var p in puertos) s.Puertos[p] = "en espera";
            _sesion = s;
            ServicioTransacciones.Registrar($"Configuración: buscando {(tipo == "escaner" ? "escáner" : "báscula")} en {string.Join(", ", puertos)}", ConsoleColor.Cyan);
            _tarea = Task.Run(async () =>
            {
                try
                {
                    await _dispositivos.DetenerAsync();
                    if (tipo == "escaner") await Detector.DetectarEscanerAsync(s, puertos);
                    else await Detector.DetectarBasculaAsync(s, puertos, _dispositivos.Configuracion.Bascula.Unidad);
                }
                catch (Exception ex)
                {
                    s.Terminar("error", "Error al buscar: " + ex.Message);
                }
                finally
                {
                    await _dispositivos.ReiniciarAsync();
                    ServicioTransacciones.Registrar(
                        s.Resultado is { } r ? $"Configuración: {tipo} encontrado en {r.PuertoCom} ({CanalSerial.Descripcion(r)})" : $"Configuración: {s.Mensaje}",
                        s.Resultado is null ? ConsoleColor.Yellow : ConsoleColor.Green);
                }
            });
            return (200, new { ok = true, deteccion = s.Vista() });
        }
    }

    public async Task<object> CancelarAsync()
    {
        SesionDeteccion? s;
        lock (_candado) s = _sesion;
        s?.Cts.Cancel();
        await _tarea;
        lock (_candado) if (ReferenceEquals(_sesion, s)) _sesion = null;
        return new { ok = true };
    }

    public async Task<(int status, object cuerpo)> GuardarAsync(string cuerpo)
    {
        ConfiguracionDispositivos? nueva;
        try
        {
            nueva = JsonSerializer.Deserialize<ConfiguracionDispositivos>(cuerpo, Json.Opciones);
        }
        catch (JsonException)
        {
            return (400, new { ok = false, error = "La configuración no es un JSON válido." });
        }
        if (nueva is null) return (400, new { ok = false, error = "Falta la configuración." });
        try
        {
            nueva.Validar(_cfg.Puerto);
        }
        catch (InvalidOperationException ex)
        {
            return (400, new { ok = false, error = ex.Message });
        }

        await CancelarAsync();
        try
        {
            GuardarEnArchivo(RutaArchivo, nueva);
        }
        catch (Exception ex)
        {
            return (500, new { ok = false, error = $"No se pudo escribir {RutaArchivo}: {ex.Message}" });
        }
        _cfg.RutaArchivo = RutaArchivo;
        _cfg.Dispositivos = nueva;
        await _dispositivos.ReiniciarAsync(nueva);
        var aviso = nueva.Escaner.Activo || nueva.Bascula.Activo ? _asegurarPuertoDispositivos() : null;
        ServicioTransacciones.Registrar(
            $"Configuración guardada · escáner: {(nueva.Escaner.Activo ? $"{nueva.Escaner.PuertoCom} {CanalSerial.Descripcion(nueva.Escaner)}" : "no")}" +
            $" · báscula: {(nueva.Bascula.Activo ? $"{nueva.Bascula.PuertoCom} {CanalSerial.Descripcion(nueva.Bascula)} {nueva.Bascula.Protocolo} {nueva.Bascula.Unidad}" : "no")}",
            ConsoleColor.Green);
        return (200, new { ok = true, archivo = RutaArchivo, aviso });
    }

    /// <summary>
    /// Reemplaza solo la sección "dispositivos" de puente-caja.json (el resto, como las credenciales de
    /// Banorte, se conserva). Deja una copia del archivo anterior en puente-caja.json.respaldo.
    /// </summary>
    internal static void GuardarEnArchivo(string ruta, ConfiguracionDispositivos d)
    {
        JsonObject raiz;
        if (File.Exists(ruta))
        {
            var texto = File.ReadAllText(ruta);
            raiz = JsonNode.Parse(texto, null, new JsonDocumentOptions { CommentHandling = JsonCommentHandling.Skip, AllowTrailingCommas = true }) as JsonObject
                   ?? throw new InvalidOperationException("el archivo no contiene un objeto JSON");
            File.WriteAllText(ruta + ".respaldo", texto, new UTF8Encoding(false));
        }
        else raiz = new JsonObject();

        foreach (var clave in raiz.Select(kv => kv.Key).Where(k => k.Equals("dispositivos", StringComparison.OrdinalIgnoreCase)).ToList())
            raiz.Remove(clave);
        raiz["dispositivos"] = JsonSerializer.SerializeToNode(d, Json.Opciones);

        var temporal = ruta + ".tmp";
        File.WriteAllText(temporal, raiz.ToJsonString(new JsonSerializerOptions { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }),
            new UTF8Encoding(false));
        File.Move(temporal, ruta, overwrite: true);
    }

    /// <summary>La página de configuración, incrustada en el exe.</summary>
    public static byte[] Pagina()
    {
        using var s = typeof(Configurador).Assembly.GetManifestResourceStream("PuenteCaja.configurar.html")
                      ?? throw new InvalidOperationException("Falta configurar.html dentro del exe.");
        using var m = new MemoryStream();
        s.CopyTo(m);
        return m.ToArray();
    }
}
