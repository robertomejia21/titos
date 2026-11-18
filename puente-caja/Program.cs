using System.Globalization;
using System.Text;

namespace PuenteCaja;

public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        CultureInfo.DefaultThreadCurrentCulture = CultureInfo.InvariantCulture;

        if (args.Contains("--ayuda") || args.Contains("--help") || args.Contains("-h"))
        {
            Console.WriteLine("""
                Puente de caja Titos
                Uso: PuenteCaja [--config ruta\puente-caja.json] [--puerto N] [--probar]
                       PuenteCaja --configurar
                       PuenteCaja --escuchar COM2 [baudios] [bits] [paridad] [parada] [comando]
                  --config   Archivo de configuración (por omisión: puente-caja.json junto al exe o en la carpeta actual)
                  --puerto   Sobrescribe el puerto HTTP de la configuración (útil para pruebas)
                  --configurar Abre en el navegador la página para detectar báscula y escáner
                             (si el puente ya está abierto, solo abre la página)
                  --probar   Autoprueba con el simulador (VENTA, VERIFICACION, CANCELACION) y termina
                  --escuchar Muestra lo que llega por un puerto COM (báscula/escáner). Ej.:
                             PuenteCaja --escuchar COM2 9600 7 odd 1 W
                """);
            return 0;
        }

        if (args.Contains("--probar")) return await AutoPrueba.EjecutarAsync();
        if (args.Contains("--escuchar")) return await Dispositivos.EscucharAsync(args);

        Configuracion cfg;
        var avisos = new List<string>();
        try
        {
            cfg = Configuracion.Cargar(Argumento(args, "--config"), avisos);
            if (Argumento(args, "--puerto") is { } p)
            {
                if (!int.TryParse(p, out var puerto) || puerto is < 1 or > 65535)
                    throw new InvalidOperationException($"--puerto {p} no es válido.");
                cfg.Puerto = puerto;
            }
        }
        catch (Exception ex)
        {
            Escribir($"Error de configuración: {ex.Message}", ConsoleColor.Red);
            return 1;
        }

        var urlConfigurar = $"http://localhost:{cfg.Puerto}/configurar";
        var abrirConfigurar = args.Contains("--configurar");
        if (abrirConfigurar && await PuenteYaAbiertoAsync(cfg.Puerto))
        {
            AbrirNavegador(urlConfigurar);
            return 0;
        }

        var carpetaConfig = cfg.RutaArchivo is null ? null : Path.GetDirectoryName(cfg.RutaArchivo);
        var servicio = new ServicioTransacciones(cfg.Banorte, Path.Combine(AppContext.BaseDirectory, "logs"), carpetaConfig);
        var dispositivos = new Dispositivos(cfg.Dispositivos);
        var servidor = new ServidorHttp(cfg, servicio, dispositivos);
        try
        {
            servidor.Iniciar();
        }
        catch (Exception ex)
        {
            Escribir($"No se pudo abrir el puerto {cfg.Puerto}: {ex.Message}", ConsoleColor.Red);
            Escribir("¿Hay otro puente abierto? Cierre la otra ventana o cambie \"puerto\" en puente-caja.json.", ConsoleColor.Red);
            return 1;
        }

        Banner(cfg, servicio, servidor, avisos);

        using var cts = new CancellationTokenSource();
        dispositivos.Iniciar(cts.Token);
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            if (cts.IsCancellationRequested) return;
            if (servicio.Ocupado)
                Escribir("Hay una operación en curso en la terminal; el puente se cerrará y su resultado no se podrá consultar aquí.", ConsoleColor.Yellow);
            Escribir("Cerrando el puente de caja…", ConsoleColor.Cyan);
            cts.Cancel();
        };

        var atender = servidor.AtenderAsync(cts.Token);
        if (abrirConfigurar) AbrirNavegador(urlConfigurar);
        await atender;
        Escribir("Puente detenido.", ConsoleColor.Cyan);
        return 0;
    }

    private static async Task<bool> PuenteYaAbiertoAsync(int puerto)
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            var texto = await http.GetStringAsync($"http://localhost:{puerto}/estado");
            return texto.Contains("\"version\"", StringComparison.Ordinal);
        }
        catch
        {
            return false;
        }
    }

    private static void AbrirNavegador(string url)
    {
        try { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception ex) { Escribir($"Abra en el navegador: {url} ({ex.Message})", ConsoleColor.Yellow); }
    }

    private static string? Argumento(string[] args, string nombre)
    {
        var i = Array.IndexOf(args, nombre);
        return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
    }

    private static void Banner(Configuracion cfg, ServicioTransacciones servicio, ServidorHttp servidor, List<string> avisos)
    {
        var b = cfg.Banorte;
        Escribir("==============================================================", ConsoleColor.Cyan);
        Escribir($"  Puente de caja Titos  v{ServidorHttp.Version}", ConsoleColor.Cyan);
        Escribir("==============================================================", ConsoleColor.Cyan);
        Console.WriteLine($"  Escuchando en:      {string.Join("  ", servidor.Prefijos)}");
        Console.WriteLine($"  Configuración:      {cfg.RutaArchivo ?? "(valores por omisión)"}");
        if (servicio.Pinpad.Simulado)
            Escribir("  PinPad:             SIMULADOR (no se cobra nada de verdad)", ConsoleColor.Yellow);
        else if (servicio.Pinpad.Disponible)
            Escribir($"  PinPad:             DLL Banorte ({((PinpadDll)servicio.Pinpad).RutaResuelta}) — {(Environment.Is64BitProcess ? "64" : "32")} bits", ConsoleColor.Green);
        else
            Escribir($"  PinPad:             DLL NO CARGADA — {servicio.Pinpad.Error}", ConsoleColor.Red);
        Console.WriteLine($"  Terminal:           {b.IpPinpad}:{b.PuertoPinpad}");
        Console.WriteLine($"  Modo Payworks:      {b.Modo}");
        Console.WriteLine($"  Credenciales:       {(b.TieneCredenciales ? $"usuario {b.Usuario} (contraseña configurada)" : "FALTAN usuario y/o contraseña")}");
        Console.WriteLine($"  Orígenes permitidos: {string.Join(", ", cfg.OrigenesPermitidos)}");
        Console.WriteLine($"  Tiempo de espera:   {b.TimeoutSegundos} s");
        var d = cfg.Dispositivos;
        Console.WriteLine($"  Escáner (COM):      {(d.Escaner.Activo ? $"{d.Escaner.PuertoCom} {CanalSerial.Descripcion(d.Escaner)}" : "no activado")}");
        Console.WriteLine($"  Báscula (COM):      {(d.Bascula.Activo ? $"{d.Bascula.PuertoCom} {CanalSerial.Descripcion(d.Bascula)} · protocolo {d.Bascula.Protocolo} · {d.Bascula.Unidad}" : "no activada")}");
        Escribir($"  Configurar báscula y escáner: http://localhost:{cfg.Puerto}/configurar", ConsoleColor.Cyan);
        if (b.Modo == "PRD")
            Escribir("  ¡ATENCIÓN! Modo PRD (producción): las ventas aprobadas son cobros REALES.", ConsoleColor.Red);
        foreach (var a in avisos) Escribir("  Aviso: " + a, ConsoleColor.Yellow);
        if (!b.UsarSimulador && !b.TieneCredenciales)
            Escribir("  Aviso: sin usuario/contraseña de Payworks las transacciones serán rechazadas (PAYW-3003).", ConsoleColor.Yellow);
        Escribir("==============================================================", ConsoleColor.Cyan);
        Console.WriteLine("  Deje esta ventana abierta mientras se cobra. Ctrl+C para cerrar.");
        Console.WriteLine();
    }

    public static void Escribir(string texto, ConsoleColor color) => ServicioTransacciones.Registrar(texto, color);
}

/// <summary>dotnet run -- --probar: recorre el simulador de punta a punta sin abrir el puerto HTTP.</summary>
public static class AutoPrueba
{
    public static async Task<int> EjecutarAsync()
    {
        var cfg = new ConfiguracionBanorte { UsarSimulador = true, Modo = "AUT", RetardoSimuladorMs = 300, Usuario = "prueba", Password = "x" };
        var servicio = new ServicioTransacciones(cfg, carpetaLogs: null, carpetaConfig: null);
        var fallas = 0;
        var sello = DateTime.Now.ToString("HHmmssfff");

        void Verificar(bool condicion, string descripcion)
        {
            ServicioTransacciones.Registrar($"{(condicion ? "OK   " : "FALLA")} {descripcion}", condicion ? ConsoleColor.Green : ConsoleColor.Red);
            if (!condicion) fallas++;
        }

        async Task<RespuestaPuente?> Enviar(SolicitudTransaccion s)
        {
            var error = s.Validar();
            if (error is not null) { Verificar(false, $"validación de {s.Comando}: {error}"); return null; }
            var r = await servicio.EjecutarAsync(s);
            if (r.Estado != EstadoEnvio.Completada) { Verificar(false, $"{s.Comando}: {r.Error}"); return null; }
            Console.WriteLine("      " + Json.Serializar(r.Respuesta));
            return r.Respuesta;
        }

        ServicioTransacciones.Registrar("Autoprueba del puente con el simulador (modo AUT)", ConsoleColor.Cyan);

        var venta = await Enviar(new SolicitudTransaccion { Comando = "VENTA", NumeroControl = "PRUEBAV" + sello, Monto = 123.45m });
        Verificar(venta is { Resultado: "A", Simulado: true } && venta.Autorizacion?.Length == 6 && venta.Referencia?.Length == 12 && venta.Ultimos4?.Length == 4,
            "VENTA aprobada con autorización, referencia y últimos 4");

        var verif = await Enviar(new SolicitudTransaccion { Comando = "VERIFICACION", NumeroControl = "PRUEBAV" + sello });
        Verificar(verif is { Resultado: "A", Comando: "VERIFICACION" } && verif.Referencia == venta?.Referencia,
            "VERIFICACION encuentra la venta original");
        Verificar(servicio.Obtener("PRUEBAV" + sello)?.Comando == "VENTA", "La respuesta guardada sigue siendo la VENTA");

        var canc = await Enviar(new SolicitudTransaccion { Comando = "CANCELACION", NumeroControl = "PRUEBAC" + sello, Monto = 123.45m, Referencia = venta?.Referencia });
        Verificar(canc is { Resultado: "A" } && canc.Referencia != venta?.Referencia && canc.Texto?.Contains(venta?.Referencia ?? "?") == true,
            "CANCELACION aprobada con nueva referencia");

        var noExiste = await Enviar(new SolicitudTransaccion { Comando = "VERIFICACION", NumeroControl = "NOEXISTE" + sello });
        Verificar(noExiste is { Resultado: "R", Codigo: "PAYW-3012" }, "VERIFICACION de algo inexistente → R PAYW-3012");

        var cancelUsuario = await Enviar(new SolicitudTransaccion { Comando = "VENTA", NumeroControl = "PRUEBAF" + sello, Monto = 10.77m });
        Verificar(cancelUsuario is { Resultado: "F", Codigo: "-2006" }, "Monto .77 → F -2006");

        Verificar(new SolicitudTransaccion { Comando = "VENTA", NumeroControl = "CON-GUION", Monto = 1 }.Validar() is not null,
            "Rechaza numeroControl con guion");
        Verificar(new SolicitudTransaccion { Comando = "CANCELACION", NumeroControl = "ABC", Monto = 1 }.Validar() is not null,
            "Rechaza CANCELACION sin referencia");

        var json = Json.Serializar(venta);
        Verificar(!json.Contains("vigencia", StringComparison.OrdinalIgnoreCase) && !json.Contains("\"pan\"", StringComparison.OrdinalIgnoreCase),
            "La respuesta no trae PAN ni vigencia");

        // Interpretación de tramas de báscula y escáner (sin puerto real).
        ServicioTransacciones.Registrar("Autoprueba de báscula/escáner (tramas simuladas)", ConsoleColor.Cyan);
        string Peso(Dispositivos d) => Json.Serializar(d.Peso().cuerpo);
        var ncr = new Dispositivos(new ConfiguracionDispositivos
        {
            Escaner = new ConfiguracionSerial { Activo = true, PuertoCom = "COM1" },
            Bascula = new ConfiguracionSerial { Activo = true, PuertoCom = "COM2", Protocolo = "ncr" },
        });
        ncr.InterpretarBascula("01.235", false);
        Verificar(ncr.Peso().status == 200 && Peso(ncr).Contains("\"peso\":1.235"), "NCR: <02>01.235 → 1.235 kg");
        ncr.InterpretarBascula("?A", false);
        Verificar(ncr.Peso().status == 502, "NCR: \"?\" (en movimiento) → sin peso");
        ncr.InterpretarEscaner("A7501234567890");
        Verificar(Json.Serializar(ncr.Escaner().cuerpo).Contains("A7501234567890"), "Escáner: guarda el código leído");

        var mag = new Dispositivos(new ConfiguracionDispositivos
        {
            Escaner = new ConfiguracionSerial { Activo = true, PuertoCom = "COM1" },
            Bascula = new ConfiguracionSerial { Activo = true, PuertoCom = "COM1", Protocolo = "magellan", Unidad = "lb" },
        });
        mag.InterpretarBascula("S110250", true);
        Verificar(Peso(mag).Contains("\"peso\":1.134"), "Magellan: S110250 (2.50 lb) → 1.134 kg");
        mag.InterpretarBascula("S141", true);
        Verificar(mag.Peso().status == 502, "Magellan: S141 (en movimiento) → sin peso");
        mag.InterpretarBascula("S08F7501234567890", true);
        Verificar(Json.Serializar(mag.Escaner().cuerpo).Contains("\"F7501234567890\""), "Magellan un cable: S08 + código → código (sin S08)");

        // Otras marcas: la unidad de la trama manda sobre la configurada.
        var gen = new Dispositivos(new ConfiguracionDispositivos
        {
            Bascula = new ConfiguracionSerial { Activo = true, PuertoCom = "COM2", Protocolo = "ncr", Unidad = "kg" },
        });
        (string trama, decimal? kg, string desc)[] casos =
        {
            ("\x02" + "000.00", 0m, "NCR en cero"),
            ("S S     0.256 kg", 0.256m, "Mettler SICS estable"),
            ("S D     0.250 kg", null, "Mettler SICS en movimiento"),
            ("ST,GS,+001.234kg", 1.234m, "CAS continuo estable"),
            ("US,GS,+001.234kg", null, "CAS continuo en movimiento"),
            ("  2.50 lb", 1.134m, "\"lb\" en la trama aunque la config diga kg"),
            ("   250 g", 0.25m, "gramos"),
            ("-0.015", null, "negativo → bajo cero"),
            ("S +", null, "SICS sobrecarga"),
        };
        foreach (var (trama, kg, desc) in casos)
        {
            gen.InterpretarBascula(trama, false);
            var (status, cuerpo) = gen.Peso();
            var leido = status == 200 ? System.Text.Json.Nodes.JsonNode.Parse(Json.Serializar(cuerpo))?["peso"]?.GetValue<decimal>() : null;
            Verificar(kg is null ? status == 502 : leido == kg, $"Báscula {desc}: \"{CanalSerial.Visible(trama)}\" → {(kg is null ? "sin peso" : $"{kg} kg")}");
        }

        // Detector: un código se reconoce aunque el escáner use 7 bits con cualquier paridad.
        ServicioTransacciones.Registrar("Autoprueba del detector", ConsoleColor.Cyan);
        static byte[] ConParidad(string texto, string paridad) => texto.Select(c =>
        {
            var b = (byte)c;
            var unos = System.Numerics.BitOperations.PopCount(b);
            var alto = paridad switch { "even" => unos % 2 == 1, "odd" => unos % 2 == 0, "mark" => true, _ => false };
            return (byte)(alto ? b | 0x80 : b);
        }).ToArray();
        foreach (var paridad in new[] { "none", "even", "odd", "mark" })
            Verificar(Detector.AnalizarCodigo(ConParidad("A844911009246\r", paridad)) == "A844911009246", $"Detector escáner: código con paridad {paridad}");
        Verificar(Detector.AnalizarCodigo(new byte[] { 0x12, 0xF3, 0x80, 0x55, 0xAA, 0x31, 0x0D }) is null, "Detector escáner: ignora basura (velocidad equivocada)");
        Verificar(Detector.AnalizarCodigo(ConParidad("  1.234 kg\r", "none")) is null, "Detector escáner: ignora el peso de una báscula continua");
        Verificar(Detector.PareceBascula("\x02" + "000.47", "W", "ncr"), "Detector báscula: respuesta NCR");
        Verificar(!Detector.PareceBascula("W", "W", "ncr"), "Detector báscula: ignora el eco del comando");
        Verificar(!Detector.PareceBascula("00\x7F.47", "W", "ncr"), "Detector báscula: ignora errores de paridad");
        Verificar(Detector.PareceBascula("S110250", "S11\r", "magellan"), "Detector báscula: respuesta Magellan S11");
        Verificar(Detector.PareceBascula("  0.000 kg", "", "continuo"), "Detector báscula: trama continua");
        Verificar(!Detector.PareceBascula("7501234567890", "", "continuo"), "Detector báscula: un código de barras no es peso");

        // Guardar desde /configurar: solo cambia "dispositivos" y conserva lo demás.
        var temporal = Path.Combine(Path.GetTempPath(), $"puente-prueba-{sello}.json");
        try
        {
            File.WriteAllText(temporal, "// comentario\n{ \"puerto\": 8091, \"banorte\": { \"usuario\": \"u1\", \"modo\": \"PRD\" }, \"Dispositivos\": { \"puertoHttp\": 1 } }");
            var nueva = new ConfiguracionDispositivos
            {
                Escaner = new ConfiguracionSerial { Activo = true, PuertoCom = "COM9", BitsDatos = 8, Paridad = "none" },
                Bascula = new ConfiguracionSerial { Activo = true, PuertoCom = "COM1", Protocolo = "ncr", ComandoPeso = "S\r\n", Unidad = "lb" },
            };
            nueva.Validar(8091);
            Configurador.GuardarEnArchivo(temporal, nueva);
            var errores = new List<string>();
            var leida = Configuracion.Cargar(temporal, errores);
            Verificar(leida.Banorte.Usuario == "u1" && leida.Banorte.Modo == "PRD" && leida.Dispositivos.Escaner.PuertoCom == "COM9"
                      && leida.Dispositivos.Bascula.ComandoPeso == "S\r\n" && leida.Dispositivos.Bascula.Unidad == "lb" && leida.Dispositivos.PuertoHttp == 8090
                      && File.Exists(temporal + ".respaldo"),
                "Guardar configuración: conserva Banorte, escribe dispositivos y deja respaldo");
        }
        finally
        {
            foreach (var f in new[] { temporal, temporal + ".respaldo" }) try { File.Delete(f); } catch { }
        }

        if (fallas == 0) ServicioTransacciones.Registrar("Autoprueba superada.", ConsoleColor.Green);
        else ServicioTransacciones.Registrar($"Autoprueba con {fallas} falla(s).", ConsoleColor.Red);
        return fallas == 0 ? 0 : 1;
    }
}
