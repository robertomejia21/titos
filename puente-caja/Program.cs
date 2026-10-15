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
                  --config   Archivo de configuración (por omisión: puente-caja.json junto al exe o en la carpeta actual)
                  --puerto   Sobrescribe el puerto HTTP de la configuración (útil para pruebas)
                  --probar   Autoprueba con el simulador (VENTA, VERIFICACION, CANCELACION) y termina
                """);
            return 0;
        }

        if (args.Contains("--probar")) return await AutoPrueba.EjecutarAsync();

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

        var carpetaConfig = cfg.RutaArchivo is null ? null : Path.GetDirectoryName(cfg.RutaArchivo);
        var servicio = new ServicioTransacciones(cfg.Banorte, Path.Combine(AppContext.BaseDirectory, "logs"), carpetaConfig);
        var servidor = new ServidorHttp(cfg, servicio);
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
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            if (cts.IsCancellationRequested) return;
            if (servicio.Ocupado)
                Escribir("Hay una operación en curso en la terminal; el puente se cerrará y su resultado no se podrá consultar aquí.", ConsoleColor.Yellow);
            Escribir("Cerrando el puente de caja…", ConsoleColor.Cyan);
            cts.Cancel();
        };

        await servidor.AtenderAsync(cts.Token);
        Escribir("Puente detenido.", ConsoleColor.Cyan);
        return 0;
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

        if (fallas == 0) ServicioTransacciones.Registrar("Autoprueba superada.", ConsoleColor.Green);
        else ServicioTransacciones.Registrar($"Autoprueba con {fallas} falla(s).", ConsoleColor.Red);
        return fallas == 0 ? 0 : 1;
    }
}
