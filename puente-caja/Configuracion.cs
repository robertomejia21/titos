using System.Text.Json;
using System.Text.Json.Serialization;

namespace PuenteCaja;

public sealed class Configuracion
{
    public int Puerto { get; set; } = 8091;
    public List<string> OrigenesPermitidos { get; set; } = new() { "https://titos.da-vinci.ai", "http://localhost:3000" };
    public ConfiguracionBanorte Banorte { get; set; } = new();
    public ConfiguracionDispositivos Dispositivos { get; set; } = new();

    /// <summary>Ruta del archivo del que se leyó la configuración (null si se usaron valores por omisión).</summary>
    [JsonIgnore] public string? RutaArchivo { get; set; }

    public static readonly string[] ModosValidos = { "PRD", "AUT", "DEC", "RND" };

    private static readonly JsonSerializerOptions OpcionesLectura = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    /// <summary>
    /// Busca puente-caja.json: primero la ruta indicada con --config, luego junto al exe,
    /// luego en la carpeta actual. Aplica las variables de entorno y valida.
    /// </summary>
    public static Configuracion Cargar(string? rutaExplicita, List<string> avisos)
    {
        var candidatos = new List<string>();
        if (!string.IsNullOrWhiteSpace(rutaExplicita)) candidatos.Add(Path.GetFullPath(rutaExplicita));
        else
        {
            candidatos.Add(Path.Combine(AppContext.BaseDirectory, "puente-caja.json"));
            candidatos.Add(Path.Combine(Directory.GetCurrentDirectory(), "puente-caja.json"));
        }

        Configuracion? cfg = null;
        foreach (var ruta in candidatos.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!File.Exists(ruta)) continue;
            try
            {
                cfg = JsonSerializer.Deserialize<Configuracion>(File.ReadAllText(ruta), OpcionesLectura)
                      ?? throw new InvalidOperationException("el archivo está vacío");
                cfg.RutaArchivo = ruta;
                break;
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException($"No se pudo leer la configuración {ruta}: {ex.Message}");
            }
        }

        if (cfg is null)
        {
            if (!string.IsNullOrWhiteSpace(rutaExplicita))
                throw new InvalidOperationException($"No existe el archivo de configuración {candidatos[0]}");
            avisos.Add("No se encontró puente-caja.json; se usan los valores por omisión (simulador, modo AUT). Copie puente-caja.ejemplo.json como puente-caja.json.");
            cfg = new Configuracion();
        }

        cfg.Banorte ??= new ConfiguracionBanorte();
        cfg.Dispositivos ??= new ConfiguracionDispositivos();
        cfg.OrigenesPermitidos ??= new List<string>();
        cfg.AplicarEntorno();
        cfg.Validar();
        return cfg;
    }

    private void AplicarEntorno()
    {
        static string? Env(string n)
        {
            var v = Environment.GetEnvironmentVariable(n);
            return string.IsNullOrWhiteSpace(v) ? null : v.Trim();
        }

        Banorte.Usuario = Env("BANORTE_PAYWORKS_USUARIO") ?? Banorte.Usuario;
        Banorte.Password = Environment.GetEnvironmentVariable("BANORTE_PAYWORKS_PASSWORD") is { Length: > 0 } pw ? pw : Banorte.Password;
        Banorte.IpPinpad = Env("BANORTE_PINPAD_IP") ?? Banorte.IpPinpad;
        Banorte.PuertoPinpad = Env("BANORTE_PINPAD_PUERTO") ?? Banorte.PuertoPinpad;
        Banorte.Modo = Env("BANORTE_MODO") ?? Banorte.Modo;
    }

    private void Validar()
    {
        Banorte.Modo = (Banorte.Modo ?? "").Trim().ToUpperInvariant();
        if (!ModosValidos.Contains(Banorte.Modo))
            throw new InvalidOperationException($"El modo \"{Banorte.Modo}\" no es válido. Use PRD, AUT, DEC o RND.");
        if (Puerto is < 1 or > 65535)
            throw new InvalidOperationException($"El puerto {Puerto} no es válido.");
        if (Banorte.TimeoutSegundos is < 10 or > 600)
            throw new InvalidOperationException("timeoutSegundos debe estar entre 10 y 600.");
        if (Banorte.RetardoSimuladorMs is < 0 or > 60000)
            throw new InvalidOperationException("retardoSimuladorMs debe estar entre 0 y 60000.");
        Banorte.IpPinpad = (Banorte.IpPinpad ?? "").Trim();
        Banorte.PuertoPinpad = (Banorte.PuertoPinpad ?? "").Trim();
        Banorte.Usuario ??= "";
        Banorte.Password ??= "";
        Banorte.RutaDll = string.IsNullOrWhiteSpace(Banorte.RutaDll) ? "PINPAD.TPV" : Banorte.RutaDll.Trim();
        Dispositivos.Validar(Puerto);
        OrigenesPermitidos = OrigenesPermitidos
            .Where(o => !string.IsNullOrWhiteSpace(o))
            .Select(o => o.Trim().TrimEnd('/'))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }
}

public sealed class ConfiguracionBanorte
{
    public bool UsarSimulador { get; set; } = true;
    public string RutaDll { get; set; } = "PINPAD.TPV";
    public string IpPinpad { get; set; } = "192.168.100.44";

    [JsonConverter(typeof(TextoONumeroConverter))]
    public string PuertoPinpad { get; set; } = "1818";

    public string Usuario { get; set; } = "";
    public string Password { get; set; } = "";
    public string Modo { get; set; } = "AUT";
    public int TimeoutSegundos { get; set; } = 90;

    /// <summary>Solo simulador: cuánto tarda en "pasar la tarjeta".</summary>
    public int RetardoSimuladorMs { get; set; } = 2000;

    [JsonIgnore] public bool TieneCredenciales => Usuario.Length > 0 && Password.Length > 0;
}

/// <summary>
/// Escáner y báscula conectados por puerto COM (p. ej. PSC/Datalogic Magellan 8200 a dos cables:
/// "POS Terminal" = códigos, "Scale Host" = peso). El punto de venta los lee en
/// http://localhost:{puertoHttp}/escaner y /peso.
/// </summary>
public sealed class ConfiguracionDispositivos
{
    /// <summary>Puerto HTTP adicional donde el punto de venta busca /peso y /escaner (8090 por omisión).</summary>
    public int PuertoHttp { get; set; } = 8090;
    public ConfiguracionSerial Escaner { get; set; } = new();
    public ConfiguracionSerial Bascula { get; set; } = new() { Protocolo = "ncr" };

    public void Validar(int puertoPrincipal)
    {
        Escaner ??= new ConfiguracionSerial();
        Bascula ??= new ConfiguracionSerial { Protocolo = "ncr" };
        if (PuertoHttp is < 0 or > 65535) throw new InvalidOperationException($"dispositivos.puertoHttp {PuertoHttp} no es válido.");
        if (PuertoHttp == puertoPrincipal) PuertoHttp = 0; // ya se atiende en el puerto principal
        Escaner.Validar("escaner", new[] { "lineas" });
        Bascula.Validar("bascula", new[] { "ncr", "magellan", "continuo" });
        if (Escaner.Activo && Bascula.Activo && Escaner.PuertoCom.Equals(Bascula.PuertoCom, StringComparison.OrdinalIgnoreCase)
            && Bascula.Protocolo != "magellan")
            throw new InvalidOperationException("El escáner y la báscula usan el mismo puerto COM; eso solo es posible con protocolo \"magellan\" (un solo cable).");
    }
}

public sealed class ConfiguracionSerial
{
    public bool Activo { get; set; }
    /// <summary>COM1, COM2…</summary>
    public string PuertoCom { get; set; } = "";
    public int Baudios { get; set; } = 9600;
    public int BitsDatos { get; set; } = 7;
    /// <summary>"none", "odd", "even".</summary>
    public string Paridad { get; set; } = "odd";
    public int BitsParada { get; set; } = 1;
    /// <summary>"none" o "rtscts".</summary>
    public string ControlFlujo { get; set; } = "none";
    /// <summary>
    /// Escáner: "lineas" (cada código termina en CR/LF).
    /// Báscula: "ncr" (se envía "W" y responde el peso), "magellan" (un solo cable: "S11"),
    /// "continuo" (la báscula manda el peso sola, sin pedirlo).
    /// </summary>
    public string Protocolo { get; set; } = "lineas";
    /// <summary>Báscula: cada cuánto se pide el peso.</summary>
    public int IntervaloMs { get; set; } = 300;
    /// <summary>Báscula: "kg" o "lb". El punto de venta trabaja en kilos; si la báscula pesa en libras se convierte.</summary>
    public string Unidad { get; set; } = "kg";
    /// <summary>Báscula NCR: comando que pide el peso (por omisión "W").</summary>
    public string ComandoPeso { get; set; } = "W";

    public void Validar(string nombre, string[] protocolos)
    {
        PuertoCom = (PuertoCom ?? "").Trim().ToUpperInvariant();
        Protocolo = (Protocolo ?? "").Trim().ToLowerInvariant();
        Paridad = (Paridad ?? "none").Trim().ToLowerInvariant();
        ControlFlujo = (ControlFlujo ?? "none").Trim().ToLowerInvariant();
        Unidad = (Unidad ?? "kg").Trim().ToLowerInvariant();
        ComandoPeso = string.IsNullOrEmpty(ComandoPeso) ? "W" : ComandoPeso;
        if (!Activo) return;
        if (!System.Text.RegularExpressions.Regex.IsMatch(PuertoCom, @"^COM\d{1,3}$"))
            throw new InvalidOperationException($"{nombre}.puertoCom debe ser como COM1, COM2…");
        if (!protocolos.Contains(Protocolo))
            throw new InvalidOperationException($"{nombre}.protocolo debe ser uno de: {string.Join(", ", protocolos)}.");
        if (Baudios is < 300 or > 115200) throw new InvalidOperationException($"{nombre}.baudios no es válido.");
        if (BitsDatos is not (7 or 8)) throw new InvalidOperationException($"{nombre}.bitsDatos debe ser 7 u 8.");
        if (BitsParada is not (1 or 2)) throw new InvalidOperationException($"{nombre}.bitsParada debe ser 1 o 2.");
        if (Paridad is not ("none" or "odd" or "even")) throw new InvalidOperationException($"{nombre}.paridad debe ser none, odd o even.");
        if (ControlFlujo is not ("none" or "rtscts")) throw new InvalidOperationException($"{nombre}.controlFlujo debe ser none o rtscts.");
        if (Unidad is not ("kg" or "lb")) throw new InvalidOperationException($"{nombre}.unidad debe ser kg o lb.");
        if (IntervaloMs is < 100 or > 5000) throw new InvalidOperationException($"{nombre}.intervaloMs debe estar entre 100 y 5000.");
    }
}

/// <summary>Acepta "1818" o 1818 en el JSON.</summary>
public sealed class TextoONumeroConverter : JsonConverter<string>
{
    public override string? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        reader.TokenType switch
        {
            JsonTokenType.String => reader.GetString(),
            JsonTokenType.Number => reader.TryGetInt64(out var n) ? n.ToString() : reader.GetDouble().ToString(System.Globalization.CultureInfo.InvariantCulture),
            JsonTokenType.Null => null,
            _ => throw new JsonException("Se esperaba texto o número"),
        };

    public override void Write(Utf8JsonWriter writer, string value, JsonSerializerOptions options) => writer.WriteStringValue(value);
}
