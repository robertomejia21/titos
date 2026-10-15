using System.Collections.Concurrent;
using System.Globalization;

namespace PuenteCaja;

public enum EstadoEnvio { Completada, Ocupada, NoDisponible }

public sealed record ResultadoEnvio(EstadoEnvio Estado, RespuestaPuente? Respuesta = null, string? Error = null);

/// <summary>
/// Serializa el acceso a la PinPad (un solo dispositivo físico y una DLL con estado global),
/// ejecuta cada transacción en un hilo dedicado, guarda las respuestas en memoria y en el log.
/// </summary>
public sealed class ServicioTransacciones
{
    private readonly ConfiguracionBanorte _cfg;
    private readonly string? _carpetaLogs;
    private readonly SemaphoreSlim _terminal = new(1, 1);
    private readonly ConcurrentDictionary<string, RespuestaPuente> _respuestas = new(StringComparer.OrdinalIgnoreCase);
    private readonly object _candadoLog = new();

    public IPinpad Pinpad { get; }
    public bool Ocupado => _terminal.CurrentCount == 0;

    public ServicioTransacciones(ConfiguracionBanorte cfg, string? carpetaLogs, string? carpetaConfig)
    {
        _cfg = cfg;
        _carpetaLogs = carpetaLogs;
        Pinpad = cfg.UsarSimulador
            ? new PinpadSimulador(Obtener, BuscarPorReferencia)
            : new PinpadDll(cfg.RutaDll, carpetaConfig);
    }

    public RespuestaPuente? Obtener(string numeroControl) =>
        _respuestas.TryGetValue(numeroControl, out var r) ? r.Clonar() : null;

    private RespuestaPuente? BuscarPorReferencia(string referencia) =>
        _respuestas.Values.FirstOrDefault(r => r.Comando != Comandos.Verificacion &&
                                               string.Equals(r.Referencia, referencia, StringComparison.OrdinalIgnoreCase))?.Clonar();

    /// <summary>La solicitud ya debe venir validada.</summary>
    public async Task<ResultadoEnvio> EjecutarAsync(SolicitudTransaccion s)
    {
        if (!Pinpad.Disponible)
            return new(EstadoEnvio.NoDisponible, Error:
                $"La terminal no está disponible: {Pinpad.Error} No se realizó ningún cobro.");

        if (!_terminal.Wait(0))
            return new(EstadoEnvio.Ocupada, Error: "La terminal está ocupada con otra operación");

        Task<RespuestaPuente> trabajo;
        try
        {
            // Hilo dedicado: la DLL bloquea hasta que la PinPad contesta y el listener debe seguir
            // respondiendo /estado mientras tanto.
            trabajo = Task.Factory.StartNew(() => Procesar(s), CancellationToken.None,
                TaskCreationOptions.LongRunning, TaskScheduler.Default);
        }
        catch
        {
            _terminal.Release();
            throw;
        }

        var limite = Task.Delay(TimeSpan.FromSeconds(_cfg.TimeoutSegundos + 30));
        if (await Task.WhenAny(trabajo, limite) == trabajo)
            return new(EstadoEnvio.Completada, await trabajo);

        // La DLL sigue bloqueada: la terminal queda ocupada hasta que regrese, y su respuesta
        // se guardará para que el navegador la recupere con GET /banorte/resultado/{numeroControl}.
        Registrar($"La terminal no contestó en {_cfg.TimeoutSegundos + 30} s para {s.Comando} {s.NumeroControl}; se sigue esperando en segundo plano.");
        var t = RespuestaPuente.Error(s, _cfg.Modo, Pinpad.Simulado,
            "La terminal no respondió a tiempo. Consulte el resultado más tarde o haga una VERIFICACION.");
        t.Resultado = "T";
        return new(EstadoEnvio.Completada, t);
    }

    private RespuestaPuente Procesar(SolicitudTransaccion s)
    {
        RespuestaPuente r;
        try
        {
            Registrar($"Enviando {s.Comando} numeroControl={s.NumeroControl}" +
                      (s.Monto is null ? "" : $" monto={s.Monto.Value.ToString("0.00", CultureInfo.InvariantCulture)}") +
                      (s.Referencia is null ? "" : $" referencia={s.Referencia}") +
                      (Pinpad.Simulado ? " (simulador)" : ""));
            r = Pinpad.Ejecutar(s, _cfg);
        }
        catch (Exception ex)
        {
            r = RespuestaPuente.Error(s, _cfg.Modo, Pinpad.Simulado, $"Error en el puente: {ex.Message}");
        }

        try
        {
            Guardar(r, s.Monto);
        }
        catch (Exception ex)
        {
            Registrar($"No se pudo guardar la respuesta de {s.NumeroControl}: {ex.Message}");
        }
        finally
        {
            _terminal.Release();
        }
        return r;
    }

    private void Guardar(RespuestaPuente r, decimal? monto)
    {
        // Una VERIFICACION no pisa la respuesta original guardada con el mismo número de control.
        if (r.Comando == Comandos.Verificacion && _respuestas.TryGetValue(r.NumeroControl, out var previa) &&
            previa.Comando != Comandos.Verificacion)
        {
            // se conserva la original
        }
        else
        {
            _respuestas[r.NumeroControl] = r.Clonar();
        }

        var color = r.Resultado == "A" ? ConsoleColor.Green : r.Resultado is "D" or "R" ? ConsoleColor.Yellow : ConsoleColor.Red;
        Registrar($"{r.Comando} {r.NumeroControl} → {r.Resultado}" +
                  (r.Codigo is null ? "" : $" código={r.Codigo}") +
                  (r.Texto is null ? "" : $" «{r.Texto}»") +
                  (r.Autorizacion is null ? "" : $" aut={r.Autorizacion}") +
                  (r.Referencia is null ? "" : $" ref={r.Referencia}") +
                  (r.Ultimos4 is null ? "" : $" ****{r.Ultimos4}") +
                  (r.Simulado ? " [SIMULADO]" : ""), color);

        if (_carpetaLogs is null) return;
        // La respuesta ya viene sin datos sensibles (solo bin ≤ 8 dígitos y últimos 4; nunca contraseña).
        var linea = Json.Serializar(new
        {
            fecha = DateTime.Now.ToString("yyyy-MM-ddTHH:mm:ss.fffzzz", CultureInfo.InvariantCulture),
            monto,
            respuesta = r,
        });
        lock (_candadoLog)
        {
            Directory.CreateDirectory(_carpetaLogs);
            File.AppendAllText(Path.Combine(_carpetaLogs, $"transacciones-{DateTime.Now:yyyy-MM-dd}.log"), linea + Environment.NewLine);
        }
    }

    public static void Registrar(string mensaje, ConsoleColor? color = null)
    {
        lock (typeof(Console))
        {
            var previo = Console.ForegroundColor;
            if (color is not null) Console.ForegroundColor = color.Value;
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {mensaje}");
            Console.ForegroundColor = previo;
        }
    }
}
