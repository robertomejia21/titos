using System.Collections.Concurrent;
using System.IO.Ports;
using System.Numerics;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace PuenteCaja;

/// <summary>Un puerto COM de la PC con el nombre que muestra el Administrador de dispositivos.</summary>
public sealed record PuertoCom(string Nombre, string? Descripcion)
{
    /// <summary>Los puertos Bluetooth tardan mucho en abrir y nunca son la báscula ni el escáner.</summary>
    public bool Omitir => Descripcion?.Contains("Bluetooth", StringComparison.OrdinalIgnoreCase) == true;
}

public static class PuertosCom
{
    private static readonly object Candado = new();
    private static (long hora, Dictionary<string, string> nombres)? _cache;

    public static List<PuertoCom> Listar()
    {
        var nombres = NombresAmigables();
        return SerialPort.GetPortNames()
            .Select(p => p.Trim().ToUpperInvariant())
            .Where(p => p.StartsWith("COM", StringComparison.Ordinal))
            .Distinct()
            .OrderBy(p => int.TryParse(p.AsSpan(3), out var n) ? n : 999)
            .Select(p => new PuertoCom(p, nombres.GetValueOrDefault(p)))
            .ToList();
    }

    /// <summary>
    /// Nombre de cada COM ("USB Serial Device", "Puerto de comunicaciones"…) leído del registro
    /// (HKLM\SYSTEM\CurrentControlSet\Enum\…\Device Parameters\PortName). Se guarda 15 s.
    /// </summary>
    private static Dictionary<string, string> NombresAmigables()
    {
        lock (Candado)
        {
            if (_cache is { } c && Environment.TickCount64 - c.hora < 15000) return c.nombres;
            var r = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (OperatingSystem.IsWindows())
            {
                try
                {
                    using var enumKey = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Enum");
                    foreach (var bus in enumKey?.GetSubKeyNames() ?? Array.Empty<string>())
                    {
                        using var kBus = Abrir(enumKey!, bus);
                        foreach (var disp in kBus?.GetSubKeyNames() ?? Array.Empty<string>())
                        {
                            using var kDisp = Abrir(kBus!, disp);
                            foreach (var inst in kDisp?.GetSubKeyNames() ?? Array.Empty<string>())
                            {
                                using var kInst = Abrir(kDisp!, inst);
                                using var parametros = kInst is null ? null : Abrir(kInst, "Device Parameters");
                                if (parametros?.GetValue("PortName") is not string puerto || !puerto.StartsWith("COM", StringComparison.OrdinalIgnoreCase)) continue;
                                var nombre = kInst!.GetValue("FriendlyName") as string ?? kInst.GetValue("DeviceDesc") as string;
                                if (string.IsNullOrWhiteSpace(nombre)) continue;
                                // DeviceDesc viene como "@msports.inf,%comport%;Communications Port"
                                if (nombre.StartsWith('@') && nombre.Contains(';')) nombre = nombre[(nombre.LastIndexOf(';') + 1)..];
                                nombre = Regex.Replace(nombre, @"\s*\(COM\d+\)\s*$", "").Trim();
                                r[puerto.Trim()] = nombre;
                            }
                        }
                    }
                }
                catch { /* sin permisos para leer el registro: se muestran solo los nombres COM */ }
            }
            _cache = (Environment.TickCount64, r);
            return r;
        }

        static RegistryKey? Abrir(RegistryKey padre, string nombre)
        {
            if (!OperatingSystem.IsWindows()) return null;
            try { return padre.OpenSubKey(nombre); } catch { return null; }
        }
    }
}

/// <summary>Una búsqueda de escáner o báscula en curso (la página de configuración la consulta cada segundo).</summary>
public sealed class SesionDeteccion
{
    public SesionDeteccion(string tipo, int segundos)
    {
        Tipo = tipo;
        SegundosMaximos = segundos;
    }

    public string Tipo { get; }
    public int SegundosMaximos { get; }
    public DateTime Inicio { get; } = DateTime.UtcNow;
    public CancellationTokenSource Cts { get; } = new();
    public ConcurrentDictionary<string, string> Puertos { get; } = new();

    /// <summary>buscando · encontrado · no-encontrado · cancelado · error</summary>
    public string Estado { get; private set; } = "buscando";
    public string Mensaje { get; set; } = "Preparando…";
    public ConfiguracionSerial? Resultado { get; private set; }
    public string? Muestra { get; private set; }
    public decimal? Valor { get; private set; }
    public string? UnidadEnTrama { get; private set; }
    public string? Aviso { get; private set; }

    public void Encontrado(ConfiguracionSerial resultado, string muestra, decimal? valor = null, string? unidadEnTrama = null, string? aviso = null)
    {
        Resultado = resultado;
        Muestra = muestra;
        Valor = valor;
        UnidadEnTrama = unidadEnTrama;
        Aviso = aviso;
        Mensaje = "¡Listo!";
        Estado = "encontrado";
    }

    public void Terminar(string estado, string mensaje)
    {
        if (Estado != "buscando") return;
        Mensaje = mensaje;
        Estado = estado;
    }

    public object Vista() => new
    {
        tipo = Tipo,
        estado = Estado,
        mensaje = Mensaje,
        segundos = (int)(DateTime.UtcNow - Inicio).TotalSeconds,
        segundosMaximos = SegundosMaximos,
        puertos = Puertos.OrderBy(p => p.Key.Length).ThenBy(p => p.Key).Select(p => new { puerto = p.Key, estado = p.Value }).ToArray(),
        resultado = Resultado,
        descripcion = Resultado is null ? null : CanalSerial.Descripcion(Resultado),
        muestra = Muestra,
        valor = Valor,
        unidadEnTrama = UnidadEnTrama,
        aviso = Aviso,
    };
}

/// <summary>
/// Detección automática. El escáner se escucha en todos los puertos a la vez (8 bits sin paridad: los
/// códigos son ASCII, así que también se leen bien los equipos de 7 bits con paridad). La báscula se
/// busca probando, en cada puerto en paralelo, velocidades/paridades comunes y los comandos de peso
/// de las marcas más usadas.
/// </summary>
public static class Detector
{
    public const int SegundosEscaner = 60;
    public const int SegundosBascula = 120;

    private static readonly int[] BaudiosEscaner = { 9600, 19200, 38400, 115200, 4800, 2400 };

    /// <summary>Configuraciones de báscula, de la más común a la menos común.</summary>
    internal static readonly (int Baudios, int Bits, string Paridad, int Parada)[] ConfigsBascula =
    {
        (9600, 7, "even", 1), (9600, 7, "odd", 1), (9600, 8, "none", 1), (9600, 7, "none", 1),
        (2400, 7, "even", 1), (4800, 7, "even", 1), (2400, 8, "none", 1), (4800, 8, "none", 1),
        (19200, 8, "none", 1), (1200, 7, "even", 1),
    };

    /// <summary>Comandos para pedir el peso. "" = no se envía nada (báscula continua).</summary>
    public static readonly (string Comando, string Protocolo, string Nombre)[] ComandosBascula =
    {
        ("W", "ncr", "W (NCR · Toledo · CAS · Magellan · Datalogic)"),
        ("P", "ncr", "P (Torrey y similares)"),
        ("S11\r", "magellan", "S11 (Magellan de un solo cable)"),
        ("S\r\n", "ncr", "S (Mettler Toledo SICS)"),
        ("IP\r\n", "ncr", "IP (Ohaus)"),
    };

    // ---------------------------------------------------------------- Escáner

    public static async Task DetectarEscanerAsync(SesionDeteccion s, IReadOnlyList<string> puertos)
    {
        var ct = s.Cts.Token;
        var fin = DateTime.UtcNow.AddSeconds(s.SegundosMaximos);
        for (var i = 0; DateTime.UtcNow < fin && !ct.IsCancellationRequested; i++)
        {
            var baudios = BaudiosEscaner[i % BaudiosEscaner.Length];
            s.Mensaje = $"Escuchando todos los puertos a {baudios} baudios…";
            using var ronda = CancellationTokenSource.CreateLinkedTokenSource(ct);
            ronda.CancelAfter(TimeSpan.FromSeconds(i < BaudiosEscaner.Length ? 5 : 4));
            var tareas = puertos.Select(p => Task.Factory.StartNew(() => EscucharEscaner(p, baudios, s, ronda), TaskCreationOptions.LongRunning)).ToArray();
            var hallazgo = (await Task.WhenAll(tareas)).FirstOrDefault(h => h is not null);
            if (hallazgo is not null)
            {
                var (puerto, codigo, sinTerminador) = hallazgo.Value;
                var cfg = new ConfiguracionSerial
                {
                    Activo = true, PuertoCom = puerto, Baudios = baudios, BitsDatos = 8, Paridad = "none", BitsParada = 1,
                    Protocolo = "lineas",
                };
                string? aviso = null;
                if (sinTerminador)
                    aviso = "El lector no manda Enter (CR) al final del código. Prográmalo con sufijo CR (viene en su manual) o no se registrarán los escaneos.";
                else if (codigo.StartsWith("S08", StringComparison.Ordinal))
                    aviso = "Parece un Magellan de un solo cable: detecta también la báscula; quedará en el mismo puerto.";
                s.Puertos[puerto] = "¡escáner!";
                s.Encontrado(cfg, codigo, aviso: aviso);
                return;
            }
            // Si ningún puerto se pudo abrir, se espera a que termine la ronda en vez de reintentar en seguida.
            try { await Task.Delay(Timeout.Infinite, ronda.Token); } catch (OperationCanceledException) { }
        }
        s.Terminar(ct.IsCancellationRequested ? "cancelado" : "no-encontrado",
            ct.IsCancellationRequested ? "Búsqueda cancelada." : "No llegó ningún código por los puertos COM.");
    }

    private static (string Puerto, string Codigo, bool SinTerminador)? EscucharEscaner(string puerto, int baudios, SesionDeteccion s, CancellationTokenSource ronda)
    {
        var ct = ronda.Token;
        SerialPort sp;
        try { sp = Abrir(puerto, baudios, 8, "none", 1, 120); }
        catch (Exception ex) { s.Puertos[puerto] = MotivoNoAbre(ex, puerto); return null; }

        using (sp)
        using (ct.Register(() => { try { sp.Close(); } catch { } }))
        {
            if (!(s.Puertos.TryGetValue(puerto, out var previo) && previo.StartsWith("llegan", StringComparison.Ordinal)))
                s.Puertos[puerto] = $"escuchando a {baudios}";
            var trama = new List<byte>();
            var buf = new byte[256];

            (string, string, bool)? Evaluar(bool conTerminador)
            {
                if (trama.Count == 0) return null;
                var codigo = AnalizarCodigo(trama);
                var datos = trama.Count(b => (b & 0x7F) is not (0x0D or 0x0A or 0x02 or 0x03));
                trama.Clear();
                if (codigo is not null)
                {
                    ronda.Cancel();
                    return (puerto, codigo, !conTerminador);
                }
                if (datos >= 2) s.Puertos[puerto] = $"llegan datos ilegibles a {baudios} baudios; sigue escaneando";
                return null;
            }

            while (!ct.IsCancellationRequested)
            {
                int n;
                try { n = sp.Read(buf, 0, buf.Length); }
                catch (TimeoutException)
                {
                    // Silencio: si quedó algo sin Enter al final, se evalúa como código sin terminador.
                    if (Evaluar(false) is { } h) return h;
                    continue;
                }
                catch { break; }
                for (var i = 0; i < n; i++)
                {
                    trama.Add(buf[i]);
                    if ((buf[i] & 0x7F) is 0x0D or 0x0A or 0x03)
                    {
                        if (Evaluar(true) is { } h) return h;
                    }
                    else if (trama.Count > 300) trama.Clear();
                }
            }
        }
        return null;
    }

    private static readonly Regex SoloPeso = new(@"^[-+]?\s*\d+[.,]\d+\s*(kg|lb|lbs|g|oz)?$|\d\s*(kg|lb)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>
    /// Convierte lo leído (a 8N1) en un código si es legible: el bit 8 debe ser coherente (siempre 0,
    /// siempre 1, o paridad par/impar constante) y el texto debe parecer un código de barras.
    /// </summary>
    internal static string? AnalizarCodigo(IReadOnlyList<byte> trama)
    {
        bool todos0 = true, todos1 = true, par = true, impar = true;
        var sb = new StringBuilder();
        foreach (var b in trama)
        {
            var bit7 = b >> 7;
            var unos = BitOperations.PopCount((uint)(b & 0x7F)) + bit7;
            if (bit7 == 1) todos0 = false; else todos1 = false;
            if (unos % 2 == 0) impar = false; else par = false;
            var c = (char)(b & 0x7F);
            if (c is '\r' or '\n' or '\x02' or '\x03') continue;
            sb.Append(c);
        }
        if (!(todos0 || todos1 || par || impar)) return null;
        var codigo = sb.ToString().Trim();
        if (codigo.Length < 4 || codigo.Length > 120 || codigo.Any(c => c < ' ' || c > '~')) return null;
        if (codigo.Count(char.IsLetterOrDigit) < codigo.Length * 0.7) return null;
        if (SoloPeso.IsMatch(codigo)) return null; // una báscula continua, no un escáner
        return codigo;
    }

    // ---------------------------------------------------------------- Báscula

    public static async Task DetectarBasculaAsync(SesionDeteccion s, IReadOnlyList<string> puertos, string unidadActual)
    {
        var ct = s.Cts.Token;
        using var todos = CancellationTokenSource.CreateLinkedTokenSource(ct);
        todos.CancelAfter(TimeSpan.FromSeconds(s.SegundosMaximos));
        s.Mensaje = "Probando velocidades y comandos de peso en cada puerto…";
        var tareas = puertos.Select(p => Task.Factory.StartNew(() => ProbarBascula(p, s, todos), TaskCreationOptions.LongRunning)).ToArray();
        var h = (await Task.WhenAll(tareas)).FirstOrDefault(x => x is not null);
        if (h is null)
        {
            s.Terminar(ct.IsCancellationRequested ? "cancelado" : "no-encontrado",
                ct.IsCancellationRequested ? "Búsqueda cancelada." : "Ningún puerto respondió como báscula.");
            return;
        }

        var (puerto, c, comando, trama) = h.Value;
        var lectura = Dispositivos.LeerTrama(trama, comando.Protocolo);
        var cfg = new ConfiguracionSerial
        {
            Activo = true, PuertoCom = puerto, Baudios = c.Baudios, BitsDatos = c.Bits, Paridad = c.Paridad, BitsParada = c.Parada,
            Protocolo = comando.Comando.Length == 0 ? "continuo" : comando.Protocolo,
            ComandoPeso = comando.Protocolo == "ncr" && comando.Comando.Length > 0 ? comando.Comando : "W",
            Unidad = lectura?.Unidad is "kg" or "lb" ? lectura.Value.Unidad! : unidadActual,
            IntervaloMs = 300,
        };
        s.Puertos[puerto] = "¡báscula!";
        s.Encontrado(cfg, CanalSerial.Visible(trama), lectura?.Valor, lectura?.Unidad,
            comando.Comando.Length == 0 ? "La báscula manda el peso sola, sin pedírselo (modo continuo)." : null);
    }

    private static (string Puerto, (int Baudios, int Bits, string Paridad, int Parada) Config, (string Comando, string Protocolo, string Nombre) Comando, string Trama)?
        ProbarBascula(string puerto, SesionDeteccion s, CancellationTokenSource todos)
    {
        var ct = todos.Token;
        foreach (var c in ConfigsBascula)
        {
            if (ct.IsCancellationRequested) return null;
            var desc = $"{c.Baudios} {c.Bits}{char.ToUpperInvariant(c.Paridad[0])}{c.Parada}";
            SerialPort sp;
            try { sp = Abrir(puerto, c.Baudios, c.Bits, c.Paridad, c.Parada, 40); }
            catch (Exception ex) { s.Puertos[puerto] = MotivoNoAbre(ex, puerto); return null; }

            using (sp)
            using (ct.Register(() => { try { sp.Close(); } catch { } }))
            {
                try
                {
                    s.Puertos[puerto] = $"{desc} · escuchando";
                    var pasivas = LeerTramas(sp, 700, ct).Where(t => PareceBascula(t, "", "continuo")).ToList();
                    if (pasivas.Count >= 2)
                    {
                        todos.Cancel();
                        return (puerto, c, ("", "continuo", "continuo"), pasivas[^1]);
                    }
                    foreach (var cmd in ComandosBascula)
                    {
                        if (ct.IsCancellationRequested) return null;
                        s.Puertos[puerto] = $"{desc} · comando {cmd.Nombre.Split(' ')[0]}";
                        if (Preguntar(sp, cmd, ct) is null) continue;
                        // Se confirma con una segunda respuesta para no confundir ruido con una báscula.
                        if (Preguntar(sp, cmd, ct) is not { } trama) continue;
                        todos.Cancel();
                        return (puerto, c, cmd, trama);
                    }
                }
                catch
                {
                    if (ct.IsCancellationRequested) return null;
                }
            }
        }
        if (!ct.IsCancellationRequested) s.Puertos[puerto] = "sin báscula";
        return null;
    }

    private static string? Preguntar(SerialPort sp, (string Comando, string Protocolo, string Nombre) cmd, CancellationToken ct)
    {
        sp.DiscardInBuffer();
        sp.Write(cmd.Comando);
        return LeerTramas(sp, 450, ct).FirstOrDefault(t => PareceBascula(t, cmd.Comando, cmd.Protocolo));
    }

    private static List<string> LeerTramas(SerialPort sp, int ms, CancellationToken ct)
    {
        var tramas = new List<string>();
        var actual = new StringBuilder();
        var buf = new byte[256];
        var fin = Environment.TickCount64 + ms;
        while (Environment.TickCount64 < fin && !ct.IsCancellationRequested)
        {
            int n;
            try { n = sp.Read(buf, 0, buf.Length); }
            catch (TimeoutException) { continue; }
            for (var i = 0; i < n; i++)
            {
                if (buf[i] is 0x0D or 0x0A or 0x03)
                {
                    if (actual.Length > 0) tramas.Add(actual.ToString());
                    actual.Clear();
                }
                else if (actual.Length < 200) actual.Append((char)buf[i]);
            }
        }
        if (actual.Length > 0) tramas.Add(actual.ToString());
        return tramas;
    }

    private static readonly Regex NumeroDecimal = new(@"\d[.,]\d", RegexOptions.Compiled);
    private static readonly Regex NumeroLargo = new(@"\d{3,}", RegexOptions.Compiled);
    private static readonly Regex EstadoNcr = new(@"^\?.?$", RegexOptions.Compiled);
    private static readonly Regex RespuestaMagellan = new(@"^S1(1\d|4[0-4])", RegexOptions.Compiled);

    /// <summary>¿Esta trama es una respuesta de báscula? Rechaza ruido, ecos del comando y caracteres con error de paridad.</summary>
    internal static bool PareceBascula(string trama, string comando, string protocolo)
    {
        var t = trama.Trim('\x02', '\x03', ' ');
        if (t.Length == 0 || t.Length > 60) return false;
        if (t.Any(c => c < ' ' || c > '~')) return false;
        if (comando.Length > 0 && t == comando.Trim()) return false;
        if (protocolo == "magellan") return RespuestaMagellan.IsMatch(t);
        if (t.StartsWith("S08", StringComparison.Ordinal)) return false;
        var l = Dispositivos.LeerTrama(t, "ncr");
        if (l is null) return false;
        var numero = NumeroDecimal.IsMatch(t) || l.Value.Unidad is not null;
        if (protocolo == "continuo") return numero;
        return numero || NumeroLargo.IsMatch(t) || EstadoNcr.IsMatch(t);
    }

    // ---------------------------------------------------------------- Comunes

    private static SerialPort Abrir(string puerto, int baudios, int bits, string paridad, int parada, int timeoutMs)
    {
        var sp = new SerialPort(puerto, baudios, paridad switch { "odd" => Parity.Odd, "even" => Parity.Even, _ => Parity.None }, bits,
            parada == 2 ? StopBits.Two : StopBits.One)
        {
            Handshake = Handshake.None,
            DtrEnable = true,
            RtsEnable = true,
            ReadTimeout = timeoutMs,
            WriteTimeout = 500,
            Encoding = Encoding.Latin1,
            // Un error de paridad deja un carácter no imprimible: así una configuración equivocada no pasa como buena.
            ParityReplace = 0x7F,
        };
        try
        {
            sp.Open();
        }
        catch
        {
            sp.Dispose();
            throw;
        }
        return sp;
    }

    private static string MotivoNoAbre(Exception ex, string puerto) => ex switch
    {
        UnauthorizedAccessException => "ocupado por otro programa",
        FileNotFoundException or IOException when ex.Message.Contains(puerto, StringComparison.OrdinalIgnoreCase) => "ya no está conectado",
        _ => "no se pudo abrir: " + ex.Message.TrimEnd('.'),
    };
}
