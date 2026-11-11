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
                        if (b is 0x0D or 0x0A or 0x03)
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
    private readonly ConfiguracionDispositivos _cfg;
    private CanalSerial? _canalEscaner;
    private CanalSerial? _canalBascula;

    private readonly object _candado = new();
    private string? _codigo;
    private double _codigoTs;
    private decimal? _peso;
    private string? _pesoCrudo;
    private string? _pesoEstado;
    private DateTime _pesoHora;

    public Dispositivos(ConfiguracionDispositivos cfg) => _cfg = cfg;

    public bool HayAlguno => _cfg.Escaner.Activo || _cfg.Bascula.Activo;

    public void Iniciar(CancellationToken ct)
    {
        var unSoloCable = _cfg.Escaner.Activo && _cfg.Bascula.Activo
            && _cfg.Escaner.PuertoCom.Equals(_cfg.Bascula.PuertoCom, StringComparison.OrdinalIgnoreCase);

        if (_cfg.Bascula.Activo)
        {
            _canalBascula = new CanalSerial("Báscula", _cfg.Bascula);
            _canalBascula.Trama += t => InterpretarBascula(t, unSoloCable);
            _ = _canalBascula.EjecutarAsync(ct);
            if (_cfg.Bascula.Protocolo != "continuo") _ = PedirPesoAsync(ct);
        }
        if (_cfg.Escaner.Activo && !unSoloCable)
        {
            _canalEscaner = new CanalSerial("Escáner", _cfg.Escaner);
            _canalEscaner.Trama += InterpretarEscaner;
            _ = _canalEscaner.EjecutarAsync(ct);
        }
    }

    private async Task PedirPesoAsync(CancellationToken ct)
    {
        var comando = _cfg.Bascula.Protocolo == "magellan" ? "S11\r" : _cfg.Bascula.ComandoPeso;
        while (!ct.IsCancellationRequested)
        {
            _canalBascula?.Enviar(comando);
            try { await Task.Delay(_cfg.Bascula.IntervaloMs, ct); } catch { break; }
        }
    }

    // ---------- Escáner ----------

    internal void InterpretarEscaner(string trama)
    {
        var codigo = new string(trama.Where(c => c >= ' ' && c <= '~').ToArray()).Trim();
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

    private static readonly Regex Numero = new(@"(\d+(?:[.,]\d+)?)", RegexOptions.Compiled);

    internal void InterpretarBascula(string trama, bool unSoloCable)
    {
        var t = trama.Trim('\x02', ' ', '\x03');
        if (_cfg.Bascula.Protocolo == "magellan")
        {
            if (t.StartsWith("S08", StringComparison.Ordinal)) { if (unSoloCable) InterpretarEscaner(t); return; }
            if (t.StartsWith("S14", StringComparison.Ordinal))
            {
                // S140 = no listo, S141 = en movimiento, S142 = sobrecarga, S143 = bajo cero, S144 = cero
                var estado = t.Length > 3 ? t[3] : '?';
                if (estado == '4') Guardar(0m, t, "cero");
                else Guardar(null, t, estado switch { '1' => "en movimiento", '2' => "sobrecarga", '3' => "bajo cero", _ => "no lista" });
                return;
            }
            if (t.StartsWith("S11", StringComparison.Ordinal))
            {
                var digitos = new string(t[3..].TakeWhile(char.IsDigit).ToArray());
                if (digitos.Length == 0) { Guardar(null, t, "sin peso"); return; }
                // 5 dígitos = milésimas, 4 dígitos = centésimas (de la unidad configurada)
                var valor = decimal.Parse(digitos, CultureInfo.InvariantCulture) / (digitos.Length >= 5 ? 1000m : 100m);
                Guardar(EnKg(valor), t, "estable");
            }
            return;
        }

        // NCR / continuo: el peso viene como texto ("01.23", "  1.234 kg"). Un "?" indica
        // movimiento o error (protocolo NCR/Mettler 8217).
        if (t.Contains('?')) { Guardar(null, t, "en movimiento o sin dato"); return; }
        var m = Numero.Match(t);
        if (!m.Success) return;
        var v = decimal.Parse(m.Groups[1].Value.Replace(',', '.'), CultureInfo.InvariantCulture);
        Guardar(EnKg(v), t, "estable");
    }

    private decimal EnKg(decimal valor) =>
        Math.Round(_cfg.Bascula.Unidad == "lb" ? valor * 0.45359237m : valor, 3);

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
        puertosDisponibles = SerialPort.GetPortNames().OrderBy(p => p).ToArray(),
        escaner = _cfg.Escaner.Activo ? (_canalEscaner?.Diagnostico() ?? new { mismoPuertoQueBascula = true }) : null,
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
