using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace PuenteCaja;

/// <summary>
/// API HTTP local (solo localhost / 127.0.0.1) que usa el punto de venta web.
/// CORS restringido a origenesPermitidos, con soporte de Private Network Access de Chrome.
/// </summary>
public sealed class ServidorHttp
{
    public const string Version = "1.2.0";
    private const int TamanoMaximoCuerpo = 16 * 1024;

    private readonly Configuracion _cfg;
    private readonly ServicioTransacciones _servicio;
    private readonly Dispositivos _dispositivos;
    private readonly HashSet<string> _origenes;
    private readonly HashSet<string> _origenesPropios;
    private readonly Configurador _configurador;
    private HttpListener? _listener;

    public List<string> Prefijos { get; } = new();

    public ServidorHttp(Configuracion cfg, ServicioTransacciones servicio, Dispositivos dispositivos)
    {
        _cfg = cfg;
        _servicio = servicio;
        _dispositivos = dispositivos;
        // La página /configurar se sirve desde el propio puente: su origen siempre se permite.
        _origenesPropios = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            $"http://localhost:{cfg.Puerto}", $"http://127.0.0.1:{cfg.Puerto}",
        };
        _origenes = new HashSet<string>(cfg.OrigenesPermitidos.Concat(_origenesPropios), StringComparer.OrdinalIgnoreCase);
        _configurador = new Configurador(cfg, dispositivos, AsegurarPuertoDispositivos);
    }

    private string PrefijoDispositivos => $"http://localhost:{_cfg.Dispositivos.PuertoHttp}/";

    /// <summary>
    /// Tras guardar báscula/escáner desde /configurar: si el puerto de dispositivos (8090) no se abrió al
    /// arrancar, se agrega en caliente. Devuelve un aviso si no se pudo.
    /// </summary>
    private string? AsegurarPuertoDispositivos()
    {
        var l = _listener;
        if (l is null || _cfg.Dispositivos.PuertoHttp <= 0) return null;
        var prefijo = PrefijoDispositivos;
        lock (Prefijos)
        {
            if (Prefijos.Contains(prefijo)) return null;
            try
            {
                l.Prefixes.Add(prefijo);
                Prefijos.Add(prefijo);
                ServicioTransacciones.Registrar($"Ahora también se escucha en {prefijo} (báscula y escáner).", ConsoleColor.Green);
                return null;
            }
            catch (Exception ex)
            {
                try { l.Prefixes.Remove(prefijo); } catch { /* no quedó registrado */ }
                return $"No se pudo abrir {prefijo} ({ex.Message}). ¿Hay otro programa de báscula abierto? Ciérrelo y reinicie el puente.";
            }
        }
    }

    /// <summary>
    /// Escucha en http://localhost:{puerto}/ y http://127.0.0.1:{puerto}/. Si Windows no permite
    /// registrar 127.0.0.1 sin permisos de administrador, se queda solo con localhost y avisa.
    /// </summary>
    public void Iniciar()
    {
        var localhost = $"http://localhost:{_cfg.Puerto}/";
        var ip = $"http://127.0.0.1:{_cfg.Puerto}/";
        // Puerto extra para la báscula y el escáner (el punto de venta los busca en 8090).
        var extra = _dispositivos.HayAlguno && _cfg.Dispositivos.PuertoHttp > 0
            ? new[] { $"http://localhost:{_cfg.Dispositivos.PuertoHttp}/" }
            : Array.Empty<string>();
        try
        {
            _listener = CrearConExtra(new[] { localhost, ip }, extra);
        }
        catch (HttpListenerException ex) when (ex.ErrorCode == 5)
        {
            ServicioTransacciones.Registrar(
                $"Aviso: Windows no permitió escuchar en {ip} sin permisos de administrador; solo se usará {localhost}. " +
                $"Para habilitarlo ejecute como administrador: netsh http add urlacl url={ip} user=%USERNAME%", ConsoleColor.Yellow);
            _listener = CrearConExtra(new[] { localhost }, extra);
        }
    }

    /// <summary>Si el puerto extra está ocupado (otro programa de báscula), se arranca sin él y se avisa.</summary>
    private HttpListener CrearConExtra(string[] principales, string[] extra)
    {
        if (extra.Length > 0)
        {
            try
            {
                var l = Crear(principales.Concat(extra).ToArray());
                Prefijos.AddRange(principales.Concat(extra));
                return l;
            }
            catch (HttpListenerException ex) when (ex.ErrorCode != 5)
            {
                ServicioTransacciones.Registrar(
                    $"Aviso: no se pudo abrir {extra[0]} ({ex.Message}). ¿Hay otro programa de báscula abierto? " +
                    $"/peso y /escaner quedan solo en el puerto {_cfg.Puerto}.", ConsoleColor.Yellow);
            }
        }
        var principal = Crear(principales);
        Prefijos.AddRange(principales);
        return principal;
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

            if (ruta.Equals("/peso", StringComparison.OrdinalIgnoreCase) || ruta.Equals("/escaner", StringComparison.OrdinalIgnoreCase))
            {
                if (metodo != "GET") { await MetodoNoPermitidoAsync(res, "GET"); return; }
                var (status, cuerpo) = ruta.Equals("/peso", StringComparison.OrdinalIgnoreCase) ? _dispositivos.Peso() : _dispositivos.Escaner();
                await EscribirAsync(res, status, cuerpo);
                return;
            }

            if (ruta.Equals("/configurar", StringComparison.OrdinalIgnoreCase) || ruta.StartsWith("/configurar/", StringComparison.OrdinalIgnoreCase))
            {
                await ConfigurarAsync(req, res, ruta.ToLowerInvariant(), metodo, origen);
                return;
            }

            if (ruta.Equals("/dispositivos", StringComparison.OrdinalIgnoreCase))
            {
                if (metodo != "GET") { await MetodoNoPermitidoAsync(res, "GET"); return; }
                await EscribirAsync(res, 200, _dispositivos.Diagnostico());
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

    private async Task ConfigurarAsync(HttpListenerRequest req, HttpListenerResponse res, string ruta, string metodo, string? origen)
    {
        if (ruta == "/configurar")
        {
            if (metodo != "GET") { await MetodoNoPermitidoAsync(res, "GET"); return; }
            var html = Configurador.Pagina();
            res.StatusCode = 200;
            res.ContentType = "text/html; charset=utf-8";
            res.Headers["X-Frame-Options"] = "DENY";
            res.ContentLength64 = html.Length;
            await res.OutputStream.WriteAsync(html);
            res.Close();
            return;
        }
        if (ruta == "/configurar/estado")
        {
            if (metodo != "GET") { await MetodoNoPermitidoAsync(res, "GET"); return; }
            bool escuchando;
            lock (Prefijos) escuchando = _cfg.Dispositivos.PuertoHttp <= 0 || Prefijos.Contains(PrefijoDispositivos);
            await EscribirAsync(res, 200, _configurador.Estado(escuchando));
            return;
        }

        // Lo que cambia la configuración solo se acepta desde la propia página (o sin Origin, p. ej. curl).
        if (metodo != "POST") { await MetodoNoPermitidoAsync(res, "POST"); return; }
        if (origen is not null && !_origenesPropios.Contains(origen.TrimEnd('/')))
        {
            await EscribirAsync(res, 403, new { ok = false, error = "Solo se puede configurar desde http://localhost:" + _cfg.Puerto + "/configurar" });
            return;
        }
        if (req.ContentType?.StartsWith("application/json", StringComparison.OrdinalIgnoreCase) != true)
        {
            await EscribirAsync(res, 415, new { ok = false, error = "Se espera Content-Type: application/json" });
            return;
        }
        var cuerpo = await LeerCuerpoAsync(req);
        if (cuerpo is null)
        {
            await EscribirAsync(res, 413, new { ok = false, error = "El cuerpo de la petición es demasiado grande" });
            return;
        }

        switch (ruta)
        {
            case "/configurar/detectar":
            {
                string? tipo = null;
                try { tipo = JsonNode.Parse(cuerpo)?["tipo"]?.GetValue<string>(); } catch { /* se valida abajo */ }
                var (status, r) = _configurador.Detectar(tipo);
                await EscribirAsync(res, status, r);
                return;
            }
            case "/configurar/cancelar":
                await EscribirAsync(res, 200, await _configurador.CancelarAsync());
                return;
            case "/configurar/guardar":
            {
                var (status, r) = await _configurador.GuardarAsync(cuerpo);
                await EscribirAsync(res, status, r);
                return;
            }
            default:
                await EscribirAsync(res, 404, new { ok = false, error = "Ruta no encontrada" });
                return;
        }
    }

    /// <summary>Lee el cuerpo (máximo 16 KB). Devuelve null si es más grande.</summary>
    private static async Task<string?> LeerCuerpoAsync(HttpListenerRequest req)
    {
        if (req.ContentLength64 > TamanoMaximoCuerpo) return null;
        using var lector = new StreamReader(req.InputStream, Encoding.UTF8);
        var buffer = new char[TamanoMaximoCuerpo + 1];
        var leidos = await lector.ReadBlockAsync(buffer, 0, buffer.Length);
        return leidos > TamanoMaximoCuerpo ? null : new string(buffer, 0, leidos);
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
        var cuerpo = await LeerCuerpoAsync(req);
        if (cuerpo is null)
        {
            await EscribirAsync(res, 413, new { ok = false, error = "El cuerpo de la petición es demasiado grande" });
            return;
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
