using System.Net;
using System.Text;
using System.Text.Json;

namespace PuenteCaja;

/// <summary>
/// API HTTP local (solo localhost / 127.0.0.1) que usa el punto de venta web.
/// CORS restringido a origenesPermitidos, con soporte de Private Network Access de Chrome.
/// </summary>
public sealed class ServidorHttp
{
    public const string Version = "1.0.0";
    private const int TamanoMaximoCuerpo = 16 * 1024;

    private readonly Configuracion _cfg;
    private readonly ServicioTransacciones _servicio;
    private readonly HashSet<string> _origenes;
    private HttpListener? _listener;

    public List<string> Prefijos { get; } = new();

    public ServidorHttp(Configuracion cfg, ServicioTransacciones servicio)
    {
        _cfg = cfg;
        _servicio = servicio;
        _origenes = new HashSet<string>(cfg.OrigenesPermitidos, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Escucha en http://localhost:{puerto}/ y http://127.0.0.1:{puerto}/. Si Windows no permite
    /// registrar 127.0.0.1 sin permisos de administrador, se queda solo con localhost y avisa.
    /// </summary>
    public void Iniciar()
    {
        var localhost = $"http://localhost:{_cfg.Puerto}/";
        var ip = $"http://127.0.0.1:{_cfg.Puerto}/";
        try
        {
            _listener = Crear(localhost, ip);
            Prefijos.AddRange(new[] { localhost, ip });
        }
        catch (HttpListenerException ex) when (ex.ErrorCode == 5)
        {
            ServicioTransacciones.Registrar(
                $"Aviso: Windows no permitió escuchar en {ip} sin permisos de administrador; solo se usará {localhost}. " +
                $"Para habilitarlo ejecute como administrador: netsh http add urlacl url={ip} user=%USERNAME%", ConsoleColor.Yellow);
            _listener = Crear(localhost);
            Prefijos.Add(localhost);
        }
    }

    private static HttpListener Crear(params string[] prefijos)
    {
        var l = new HttpListener();
        foreach (var p in prefijos) l.Prefixes.Add(p);
        try
        {
            l.Start();
        }
        catch
        {
            l.Close();
            throw;
        }
        return l;
    }

    public async Task AtenderAsync(CancellationToken ct)
    {
        var listener = _listener ?? throw new InvalidOperationException("El servidor no se ha iniciado.");
        using var registro = ct.Register(() => { try { listener.Stop(); } catch { /* ya detenido */ } });
        while (!ct.IsCancellationRequested)
        {
            HttpListenerContext ctx;
            try
            {
                ctx = await listener.GetContextAsync();
            }
            catch (Exception) when (ct.IsCancellationRequested || !listener.IsListening)
            {
                break;
            }
            catch (HttpListenerException ex)
            {
                ServicioTransacciones.Registrar($"Error del servidor HTTP: {ex.Message}", ConsoleColor.Red);
                continue;
            }
            _ = Task.Run(() => AtenderUnaAsync(ctx));
        }
        try { listener.Close(); } catch { /* nada */ }
    }

    private async Task AtenderUnaAsync(HttpListenerContext ctx)
    {
        var req = ctx.Request;
        var res = ctx.Response;
        try
        {
            res.Headers["Cache-Control"] = "no-store";
            res.Headers["Vary"] = "Origin";

            var origen = req.Headers["Origin"];
            if (origen is not null)
            {
                if (!_origenes.Contains(origen.TrimEnd('/')))
                {
                    ServicioTransacciones.Registrar($"Rechazada petición de origen no permitido: {origen}", ConsoleColor.Yellow);
                    await EscribirAsync(res, 403, new { ok = false, error = "Origen no permitido" });
                    return;
                }
                res.Headers["Access-Control-Allow-Origin"] = origen;
            }

            var ruta = (req.Url?.AbsolutePath ?? "/").TrimEnd('/');
            if (ruta.Length == 0) ruta = "/";
            var metodo = req.HttpMethod.ToUpperInvariant();

            if (metodo == "OPTIONS")
            {
                res.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
                res.Headers["Access-Control-Allow-Headers"] = "Content-Type";
                res.Headers["Access-Control-Allow-Private-Network"] = "true";
                res.Headers["Access-Control-Max-Age"] = "600";
                res.StatusCode = 204;
                res.Close();
                return;
            }

            if (ruta.Equals("/estado", StringComparison.OrdinalIgnoreCase))
            {
                if (metodo != "GET") { await MetodoNoPermitidoAsync(res, "GET"); return; }
                await EscribirAsync(res, 200, Estado());
                return;
            }

            if (ruta.Equals("/banorte/transaccion", StringComparison.OrdinalIgnoreCase))
            {
                if (metodo != "POST") { await MetodoNoPermitidoAsync(res, "POST"); return; }
                await TransaccionAsync(req, res);
                return;
            }

            const string prefijoResultado = "/banorte/resultado/";
            if (ruta.StartsWith(prefijoResultado, StringComparison.OrdinalIgnoreCase))
            {
                if (metodo != "GET") { await MetodoNoPermitidoAsync(res, "GET"); return; }
                var numero = Uri.UnescapeDataString(ruta[prefijoResultado.Length..]);
                var guardada = _servicio.Obtener(numero);
                if (guardada is null) await EscribirAsync(res, 404, new { ok = false, error = "No hay respuesta guardada para ese número de control" });
                else await EscribirAsync(res, 200, guardada);
                return;
            }

            await EscribirAsync(res, 404, new { ok = false, error = "Ruta no encontrada" });
        }
        catch (Exception ex)
        {
            ServicioTransacciones.Registrar($"Error atendiendo {req.HttpMethod} {req.Url?.AbsolutePath}: {ex.Message}", ConsoleColor.Red);
            try { await EscribirAsync(res, 500, new { ok = false, error = "Error interno del puente: " + ex.Message }); }
            catch { /* la conexión ya se cerró */ }
        }
    }

    public object Estado() => new
    {
        ok = true,
        version = Version,
        pinpad = _servicio.Pinpad.Tipo,
        dllCargada = !_servicio.Pinpad.Simulado && _servicio.Pinpad.Disponible,
        ip = _cfg.Banorte.IpPinpad,
        puerto = _cfg.Banorte.PuertoPinpad,
        modo = _cfg.Banorte.Modo,
        ocupado = _servicio.Ocupado,
        credenciales = _cfg.Banorte.TieneCredenciales,
        errorDll = _servicio.Pinpad.Simulado ? null : _servicio.Pinpad.Error,
    };

    private async Task TransaccionAsync(HttpListenerRequest req, HttpListenerResponse res)
    {
        if (req.ContentLength64 > TamanoMaximoCuerpo)
        {
            await EscribirAsync(res, 413, new { ok = false, error = "El cuerpo de la petición es demasiado grande" });
            return;
        }

        string cuerpo;
        using (var lector = new StreamReader(req.InputStream, Encoding.UTF8))
        {
            var buffer = new char[TamanoMaximoCuerpo + 1];
            var leidos = await lector.ReadBlockAsync(buffer, 0, buffer.Length);
            if (leidos > TamanoMaximoCuerpo)
            {
                await EscribirAsync(res, 413, new { ok = false, error = "El cuerpo de la petición es demasiado grande" });
                return;
            }
            cuerpo = new string(buffer, 0, leidos);
        }

        SolicitudTransaccion? s;
        try
        {
            s = JsonSerializer.Deserialize<SolicitudTransaccion>(cuerpo, Json.Opciones);
        }
        catch (JsonException)
        {
            await EscribirAsync(res, 400, new { ok = false, error = "El cuerpo no es un JSON válido o tiene tipos incorrectos (monto debe ser número)." });
            return;
        }
        if (s is null)
        {
            await EscribirAsync(res, 400, new { ok = false, error = "Falta el cuerpo de la petición." });
            return;
        }

        var error = s.Validar();
        if (error is not null)
        {
            await EscribirAsync(res, 400, new { ok = false, error });
            return;
        }

        var resultado = await _servicio.EjecutarAsync(s);
        switch (resultado.Estado)
        {
            case EstadoEnvio.Ocupada:
                await EscribirAsync(res, 409, new { ok = false, error = resultado.Error });
                break;
            case EstadoEnvio.NoDisponible:
                await EscribirAsync(res, 503, new { ok = false, error = resultado.Error });
                break;
            default:
                await EscribirAsync(res, 200, resultado.Respuesta!);
                break;
        }
    }

    private static Task MetodoNoPermitidoAsync(HttpListenerResponse res, string permitido)
    {
        res.Headers["Allow"] = permitido + ", OPTIONS";
        return EscribirAsync(res, 405, new { ok = false, error = "Método no permitido" });
    }

    private static async Task EscribirAsync<T>(HttpListenerResponse res, int status, T cuerpo)
    {
        var bytes = Encoding.UTF8.GetBytes(Json.Serializar(cuerpo));
        res.StatusCode = status;
        res.ContentType = "application/json; charset=utf-8";
        res.ContentLength64 = bytes.Length;
        await res.OutputStream.WriteAsync(bytes);
        res.Close();
    }
}
