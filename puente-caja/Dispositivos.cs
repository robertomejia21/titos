using System.Globalization;
using System.IO.Ports;
using System.Text;
using System.Text.RegularExpressions;

namespace PuenteCaja;

/// <summary>
/// Un puerto COM que se abre solo (y se reintenta si se desconecta), parte lo que llega en
/// tramas (por CR, LF o ETX) y guarda las últimas para diagnóstico.
/// </summary>
public sealed class CanalSerial : IDisposable
{
    private readonly ConfiguracionSerial _cfg;
    private readonly string _nombre;
    private readonly object _candado = new();
    private readonly LinkedList<object> _ultimas = new();
    private SerialPort? _puerto;

    public event Action<string>? Trama;
    public bool Abierto => _puerto?.IsOpen == true;
    public string? Error { get; private set; }

    public CanalSerial(string nombre, ConfiguracionSerial cfg)
    {
        _nombre = nombre;
        _cfg = cfg;
    }

    public static SerialPort Crear(ConfiguracionSerial c) => new(c.PuertoCom, c.Baudios,
        c.Paridad switch { "odd" => Parity.Odd, "even" => Parity.Even, _ => Parity.None },
        c.BitsDatos, c.BitsParada == 2 ? StopBits.Two : StopBits.One)
    {
        Handshake = c.ControlFlujo == "rtscts" ? Handshake.RequestToSend : Handshake.None,
        DtrEnable = true,
        RtsEnable = c.ControlFlujo != "rtscts",
        ReadTimeout = SerialPort.InfiniteTimeout,
        WriteTimeout = 1000,
        Encoding = Encoding.Latin1,
    };

    public async Task EjecutarAsync(CancellationToken ct)
    {
        var buffer = new byte[256];
        var trama = new StringBuilder();
        while (!ct.IsCancellationRequested)
        {
            try
            {
                using var puerto = Crear(_cfg);
                puerto.Open();
                _puerto = puerto;
                Error = null;
                ServicioTransacciones.Registrar($"{_nombre}: {_cfg.PuertoCom} abierto ({Descripcion(_cfg)})", ConsoleColor.Green);
                using var registro = ct.Register(() => { try { puerto.Close(); } catch { } });
                while (!ct.IsCancellationRequested)
                {
                    var n = await puerto.BaseStream.ReadAsync(buffer, ct);
                    if (n <= 0) continue;
                    for (var i = 0; i < n; i++)
                    {
                        var b = buffer[i];
                        if ((b & 0x7F) is 0x0D or 0x0A or 0x03)
                        {
                            if (trama.Length > 0) Emitir(trama.ToString());
                            trama.Clear();
                        }
                        else if (trama.Length < 200) trama.Append((char)b);
                    }
                }
            }
            catch (Exception ex) when (!ct.IsCancellationRequested)
            {
                var mensaje = ex switch
                {
                    FileNotFoundException or IOException when !Abierto && ex.Message.Contains(_cfg.PuertoCom) => $"El puerto {_cfg.PuertoCom} no existe en esta PC",
                    UnauthorizedAccessException => $"El puerto {_cfg.PuertoCom} está ocupado por otro programa",
                    _ => ex.Message.TrimEnd('.'),
                };
                if (Error != mensaje) ServicioTransacciones.Registrar($"{_nombre}: {mensaje}. Se reintenta en 5 s.", ConsoleColor.Yellow);
                Error = mensaje;
            }
            catch { /* cerrando */ }
            finally { _puerto = null; trama.Clear(); }
            try { await Task.Delay(5000, ct); } catch { break; }
        }
    }

    public void Enviar(string texto)
    {
        var p = _puerto;
        if (p is null || !p.IsOpen) return;
        try { p.Write(texto); } catch (Exception ex) { Error = ex.Message; }
    }

    private void Emitir(string texto)
    {
        lock (_candado)
        {
            _ultimas.AddFirst(new { hora = DateTime.Now.ToString("HH:mm:ss.fff"), texto = Visible(texto) });
            while (_ultimas.Count > 15) _ultimas.RemoveLast();
        }
        try { Trama?.Invoke(texto); } catch { /* un error al interpretar no tumba la lectura */ }
    }

    public object Diagnostico()
    {
        lock (_candado)
            return new { puerto = _cfg.PuertoCom, config = Descripcion(_cfg), protocolo = _cfg.Protocolo, abierto = Abierto, error = Error, ultimasTramas = _ultimas.ToArray() };
    }

    public static string Descripcion(ConfiguracionSerial c) =>
        $"{c.Baudios} {c.BitsDatos}{c.Paridad[0].ToString().ToUpperInvariant()}{c.BitsParada}{(c.ControlFlujo == "rtscts" ? " RTS/CTS" : "")}";

    /// <summary>Muestra los caracteres de control como &lt;02&gt; para poder leerlos en el diagnóstico.</summary>
    public static string Visible(string s)
    {
        var sb = new StringBuilder();
        foreach (var ch in s) sb.Append(ch is < ' ' or > '~' ? $"<{(int)ch:X2}>" : ch.ToString());
        return sb.ToString();
    }

    public void Dispose() { try { _puerto?.Close(); } catch { } }
}

/// <summary>
/// Escáner y báscula por COM. Expone lo último leído en el formato que espera el punto de venta
/// (src/lib/escaner.ts y src/lib/bascula.ts).
/// </summary>
public sealed class Dispositivos
{
    private ConfiguracionDispositivos _cfg;
    private CanalSerial? _canalEscaner;
    private CanalSerial? _canalBascula;
    private CancellationToken _ctApp = CancellationToken.None;
    private CancellationTokenSource? _cts;
    private readonly List<Task> _tareas = new();
    private readonly SemaphoreSlim _cambio = new(1, 1);

    private readonly object _candado = new();
    private string? _codigo;
    private double _codigoTs;
    private decimal? _peso;
    private string? _pesoCrudo;
    private string? _pesoEstado;
    private DateTime _pesoHora;

    public Dispositivos(ConfiguracionDispositivos cfg) => _cfg = cfg;

    public ConfiguracionDispositivos Configuracion => _cfg;
    public bool HayAlguno => _cfg.Escaner.Activo || _cfg.Bascula.Activo;
    /// <summary>true mientras la página de configuración busca equipos (los puertos quedan libres).</summary>
    public bool Pausado { get; private set; }

    public void Iniciar(CancellationToken ct)
    {
        _ctApp = ct;
        Arrancar();
    }

    private void Arrancar()
    {
        _cts = CancellationTokenSource.CreateLinkedTokenSource(_ctApp);
        var ct = _cts.Token;
        var unSoloCable = _cfg.Escaner.Activo && _cfg.Bascula.Activo
            && _cfg.Escaner.PuertoCom.Equals(_cfg.Bascula.PuertoCom, StringComparison.OrdinalIgnoreCase);

        if (_cfg.Bascula.Activo)
        {
            var canal = new CanalSerial("Báscula", _cfg.Bascula);
            canal.Trama += t => InterpretarBascula(t, unSoloCable);
            _canalBascula = canal;
            _tareas.Add(canal.EjecutarAsync(ct));
            if (_cfg.Bascula.Protocolo != "continuo") _tareas.Add(PedirPesoAsync(canal, _cfg.Bascula, ct));
        }
        if (_cfg.Escaner.Activo && !unSoloCable)
        {
            var canal = new CanalSerial("Escáner", _cfg.Escaner);
            canal.Trama += InterpretarEscaner;
            _canalEscaner = canal;
            _tareas.Add(canal.EjecutarAsync(ct));
        }
        Pausado = false;
    }

    private async Task DetenerInternoAsync()
    {
        _cts?.Cancel();
        try { await Task.WhenAll(_tareas).WaitAsync(TimeSpan.FromSeconds(5)); } catch { /* ya se cerraron */ }
        _tareas.Clear();
        _cts?.Dispose();
        _cts = null;
        _canalBascula?.Dispose();
        _canalEscaner?.Dispose();
        _canalBascula = null;
        _canalEscaner = null;
    }

    /// <summary>Cierra los puertos COM (para que la detección pueda usarlos) sin cerrar el puente.</summary>
    public async Task DetenerAsync()
    {
        await _cambio.WaitAsync();
        try
        {
            await DetenerInternoAsync();
            Pausado = true;
        }
        finally { _cambio.Release(); }
    }

    /// <summary>Vuelve a abrir los puertos, con la configuración nueva si se indica.</summary>
    public async Task ReiniciarAsync(ConfiguracionDispositivos? nueva = null)
    {
        await _cambio.WaitAsync();
        try
        {
            await DetenerInternoAsync();
            if (nueva is not null)
            {
                _cfg = nueva;
                lock (_candado)
                {
                    _codigo = null;
                    _peso = null;
                    _pesoCrudo = null;
                    _pesoEstado = null;
                    _pesoHora = default;
                }
            }
            Arrancar();
        }
        finally { _cambio.Release(); }
    }

    private static async Task PedirPesoAsync(CanalSerial canal, ConfiguracionSerial cfg, CancellationToken ct)
    {
        var comando = cfg.Protocolo == "magellan" ? "S11\r" : cfg.ComandoPeso;
        while (!ct.IsCancellationRequested)
        {
            canal.Enviar(comando);
            try { await Task.Delay(cfg.IntervaloMs, ct); } catch { break; }
        }
    }

    // ---------- Escáner ----------

    internal void InterpretarEscaner(string trama)
    {
        // Se quita el bit de paridad: así también se lee bien un escáner de 7 bits configurado a 8N1.
        var codigo = new string(trama.Select(c => (char)(c & 0x7F)).Where(c => c >= ' ' && c <= '~').ToArray()).Trim();
        // Magellan a un solo cable antepone "S08" al código; el resto de letras del lector
        // (identificador de simbología) las quita el punto de venta si hace falta.
        if (codigo.StartsWith("S08", StringComparison.Ordinal)) codigo = codigo[3..];
        if (codigo.Length == 0) return;
        lock (_candado)
        {
            _codigo = codigo;
            _codigoTs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0;
        }
        ServicioTransacciones.Registrar($"Escáner: {codigo}", ConsoleColor.Gray);
    }

    public (int status, object cuerpo) Escaner()
    {
        if (!_cfg.Escaner.Activo) return (502, new { ok = false, error = "El escáner por COM no está activado en puente-caja.json" });
        lock (_candado)
        {
            if (_codigo is null) return (502, new { ok = false, error = "Todavía no se ha escaneado nada" });
            return (200, new { ok = true, codigo = _codigo, ts = _codigoTs });
        }
    }

    // ---------- Báscula ----------

    internal void InterpretarBascula(string trama, bool unSoloCable)
    {
        var cfg = _cfg.Bascula;
        var t = trama.Trim('\x02', ' ', '\x03');
        if (cfg.Protocolo == "magellan" && t.StartsWith("S08", StringComparison.Ordinal))
        {
            if (unSoloCable) InterpretarEscaner(t);
            return;
        }
        if (LeerTrama(t, cfg.Protocolo) is not { } l) return;
        Guardar(l.Valor is { } v ? EnKg(v, l.Unidad ?? cfg.Unidad) : null, t, l.Estado);
    }

    /// <summary>Peso leído de una trama, en la unidad de la báscula (Valor null = sin peso válido).</summary>
    public readonly record struct LecturaPeso(decimal? Valor, string Estado, string? Unidad);

    private static readonly Regex NumeroConSigno = new(@"(-?)\s*(\d+(?:[.,]\d+)?)", RegexOptions.Compiled);
    private static readonly Regex UnidadTexto = new(@"(?<![a-z])(kg|lbs?|g)(?![a-z])", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex Inestable = new(@"^(S\s+[DI]\b|US\b|US,|SD\b)", RegexOptions.Compiled);
    private static readonly Regex Sobrecarga = new(@"^S\s*\+|\bOL\b", RegexOptions.Compiled);
    private static readonly Regex BajoCero = new(@"^S\s*-", RegexOptions.Compiled);

    /// <summary>
    /// Interpreta una trama de báscula. Formatos reconocidos:
    /// NCR/Toledo/CAS/Torrey ("&lt;02&gt;001.25", "  1.234 kg", "?A" en movimiento),
    /// Mettler SICS ("S S     0.256 kg", "S D" en movimiento, "S +"/"S -" fuera de rango),
    /// CAS continuo ("ST,GS,+001.234kg", "US,…" en movimiento) y Magellan SCMP ("S11…", "S14x").
    /// La unidad (kg, lb, g) se toma de la trama si viene; si no, se usa la configurada.
    /// Devuelve null si la trama no parece de báscula.
    /// </summary>
    public static LecturaPeso? LeerTrama(string trama, string protocolo)
    {
        var t = new string(trama.Select(c => (char)(c & 0x7F)).ToArray()).Trim('\x02', '\x03', '\r', '\n', ' ');
        if (t.Length == 0) return null;
        if (protocolo == "magellan")
        {
            if (t.StartsWith("S14", StringComparison.Ordinal))
            {
                // S140 = no listo, S141 = en movimiento, S142 = sobrecarga, S143 = bajo cero, S144 = cero
                var estado = t.Length > 3 ? t[3] : '?';
                return estado == '4'
                    ? new LecturaPeso(0m, "cero", null)
                    : new LecturaPeso(null, estado switch { '1' => "en movimiento", '2' => "sobrecarga", '3' => "bajo cero", _ => "no lista" }, null);
            }
            if (t.StartsWith("S11", StringComparison.Ordinal))
            {
                var digitos = new string(t[3..].TakeWhile(char.IsDigit).ToArray());
                if (digitos.Length == 0) return new LecturaPeso(null, "sin peso", null);
                // 5 dígitos = milésimas, 4 dígitos = centésimas (de la unidad configurada)
                return new LecturaPeso(decimal.Parse(digitos, CultureInfo.InvariantCulture) / (digitos.Length >= 5 ? 1000m : 100m), "estable", null);
            }
            return null;
        }

        // Texto: el peso viene como número ("01.23", "  1.234 kg"). Un "?" indica movimiento o
        // error (NCR / Mettler 8217).
        var mu = UnidadTexto.Match(t);
        var unidad = mu.Success ? mu.Groups[1].Value.ToLowerInvariant() switch { "kg" => "kg", "g" => "g", _ => "lb" } : null;
        var unidadFinal = unidad == "g" ? "kg" : unidad;
        if (t.Contains('?')) return new LecturaPeso(null, "en movimiento o sin dato", unidadFinal);
        if (Inestable.IsMatch(t)) return new LecturaPeso(null, "en movimiento", unidadFinal);
        if (Sobrecarga.IsMatch(t)) return new LecturaPeso(null, "sobrecarga", unidadFinal);
        if (BajoCero.IsMatch(t)) return new LecturaPeso(null, "bajo cero", unidadFinal);
        var m = NumeroConSigno.Match(t);
        if (!m.Success) return null;
        var v = decimal.Parse(m.Groups[2].Value.Replace(',', '.'), CultureInfo.InvariantCulture);
        if (m.Groups[1].Value == "-" && v != 0) return new LecturaPeso(null, "bajo cero", unidadFinal);
        if (unidad == "g") v /= 1000m;
        return new LecturaPeso(v, "estable", unidadFinal);
    }

    private static decimal EnKg(decimal valor, string unidad) =>
        Math.Round(unidad == "lb" ? valor * 0.45359237m : valor, 3);

    private void Guardar(decimal? pesoKg, string crudo, string estado)
    {
        lock (_candado)
        {
            _peso = pesoKg;
            _pesoCrudo = CanalSerial.Visible(crudo);
            _pesoEstado = estado;
            _pesoHora = DateTime.UtcNow;
        }
    }

    public (int status, object cuerpo) Peso()
    {
        if (!_cfg.Bascula.Activo) return (502, new { ok = false, error = "La báscula por COM no está activada en puente-caja.json" });
        lock (_candado)
        {
            var fresco = (DateTime.UtcNow - _pesoHora).TotalMilliseconds < Math.Max(2000, _cfg.Bascula.IntervaloMs * 4);
            if (!fresco) return (502, new { ok = false, error = _canalBascula?.Error ?? "La báscula no responde" });
            if (_peso is null) return (502, new { ok = false, error = $"Báscula {_pesoEstado}", crudo = _pesoCrudo });
            // `peso` va en kilos: es lo que usa el punto de venta.
            return (200, new { ok = true, peso = _peso, unidad = "kg", estado = _pesoEstado, crudo = _pesoCrudo });
        }
    }

    public object Diagnostico() => new
    {
        ok = true,
        pausado = Pausado,
        puertosDisponibles = SerialPort.GetPortNames().OrderBy(p => p).ToArray(),
        escaner = _cfg.Escaner.Activo && !Pausado ? (_canalEscaner?.Diagnostico() ?? new { mismoPuertoQueBascula = true }) : null,
        bascula = _cfg.Bascula.Activo ? _canalBascula?.Diagnostico() : null,
    };

    /// <summary>
    /// PuenteCaja --escuchar COM2 9600 7 odd 1 [comando]: muestra en pantalla lo que llega por un
    /// puerto (y opcionalmente envía un comando cada segundo). Sirve para averiguar la configuración.
    /// </summary>
    public static async Task<int> EscucharAsync(string[] args)
    {
        var i = Array.IndexOf(args, "--escuchar");
        string Arg(int k, string def) => i + k < args.Length && !args[i + k].StartsWith("--") ? args[i + k] : def;
        var cfg = new ConfiguracionSerial
        {
            Activo = true,
            PuertoCom = Arg(1, "COM1"),
            Baudios = int.Parse(Arg(2, "9600")),
            BitsDatos = int.Parse(Arg(3, "7")),
            Paridad = Arg(4, "odd"),
            BitsParada = int.Parse(Arg(5, "1")),
        };
        var comando = Arg(6, "");
        if (comando.Length > 0) comando = comando.Replace("\\r", "\r").Replace("\\n", "\n");
        try { cfg.Validar("escuchar", new[] { "lineas" }); }
        catch (Exception ex) { Console.WriteLine(ex.Message); return 1; }

        Console.WriteLine($"Puertos en esta PC: {string.Join(", ", SerialPort.GetPortNames())}");
        Console.WriteLine($"Escuchando {cfg.PuertoCom} a {CanalSerial.Descripcion(cfg)}{(comando.Length > 0 ? $", enviando \"{CanalSerial.Visible(comando)}\" cada segundo" : "")}. Ctrl+C para salir.");
        using var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };
        using var canal = new CanalSerial(cfg.PuertoCom, cfg);
        canal.Trama += t => Console.WriteLine($"{DateTime.Now:HH:mm:ss.fff}  {CanalSerial.Visible(t)}");
        var lectura = canal.EjecutarAsync(cts.Token);
        while (!cts.IsCancellationRequested)
        {
            if (comando.Length > 0) canal.Enviar(comando);
            try { await Task.Delay(1000, cts.Token); } catch { break; }
        }
        await lectura;
        return 0;
    }
}
