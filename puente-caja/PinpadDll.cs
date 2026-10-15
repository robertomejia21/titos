using System.Runtime.InteropServices;
using System.Text;

namespace PuenteCaja;

/// <summary>Lo que el servicio necesita de una PinPad (la DLL real o el simulador).</summary>
public interface IPinpad
{
    /// <summary>"dll" o "simulador".</summary>
    string Tipo { get; }
    bool Simulado { get; }
    /// <summary>true si la PinPad está lista para transaccionar (el simulador siempre lo está).</summary>
    bool Disponible { get; }
    /// <summary>Motivo por el que no está disponible.</summary>
    string? Error { get; }

    /// <summary>Ejecuta la transacción de forma síncrona (bloquea hasta que la PinPad contesta).</summary>
    RespuestaPuente Ejecutar(SolicitudTransaccion s, ConfiguracionBanorte cfg);
}

/// <summary>
/// Envoltura de PINPAD.TPV de Banorte (Payworks · Interredes Remoto, Anexos IV/V).
/// Se carga en tiempo de ejecución con NativeLibrary para que la falta de la DLL no tumbe el programa.
/// La DLL guarda estado global: el servicio garantiza que solo un hilo la use a la vez.
/// </summary>
public sealed class PinpadDll : IPinpad
{
    [UnmanagedFunctionPointer(CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    private delegate void SetTexto([MarshalAs(UnmanagedType.LPStr)] string valor);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    private delegate void SetDosTextos([MarshalAs(UnmanagedType.LPStr)] string a, [MarshalAs(UnmanagedType.LPStr)] string b);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void SetFlotante(float valor);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void EnviarTxn(int timeoutSegundos);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate IntPtr GetPuntero();

    [UnmanagedFunctionPointer(CallingConvention.Cdecl, CharSet = CharSet.Ansi)]
    private delegate void GetVB([MarshalAs(UnmanagedType.LPStr)] StringBuilder buffer);

    private readonly IntPtr _handle;

    private readonly SetDosTextos? _setIPAddressPort;
    private readonly SetTexto? _setUser, _setPassword, _setMode, _setCommand, _setControlNumber, _setPaywReference, _setAuthCode;
    private readonly SetFlotante? _setTransactionAmount, _setCashBackAmount;
    private readonly EnviarTxn? _sendTxn;

    public string Tipo => "dll";
    public bool Simulado => false;
    public bool Disponible { get; }
    public string? Error { get; }
    public string RutaResuelta { get; }

    public PinpadDll(string rutaDll, string? carpetaConfig)
    {
        RutaResuelta = ResolverRuta(rutaDll, carpetaConfig);
        try
        {
            _handle = NativeLibrary.Load(RutaResuelta);
        }
        catch (Exception ex)
        {
            Error = $"No se pudo cargar la DLL de Banorte \"{RutaResuelta}\": {ex.Message}" +
                    (ex is BadImageFormatException ? " (¿la DLL es de 64 bits y el puente de 32, o al revés? Vea el README)" : "");
            return;
        }

        _setIPAddressPort = Export<SetDosTextos>("PPSetIPAddressPort");
        _setUser = Export<SetTexto>("PPSetUser");
        _setPassword = Export<SetTexto>("PPSetPassword");
        _setMode = Export<SetTexto>("PPSetMode");
        _setCommand = Export<SetTexto>("PPSetCommand");
        _setControlNumber = Export<SetTexto>("PPSetControlNumber");
        _setTransactionAmount = Export<SetFlotante>("PPSetTransactionAmount");
        _sendTxn = Export<EnviarTxn>("PPSendTxn");
        _setPaywReference = Export<SetTexto>("PPSetPaywReference");
        _setAuthCode = Export<SetTexto>("PPSetAuthCode");
        _setCashBackAmount = Export<SetFlotante>("PPSetCashBackAmount");

        var faltantes = new List<string>();
        if (_setIPAddressPort is null) faltantes.Add("PPSetIPAddressPort");
        if (_setUser is null) faltantes.Add("PPSetUser");
        if (_setPassword is null) faltantes.Add("PPSetPassword");
        if (_setMode is null) faltantes.Add("PPSetMode");
        if (_setCommand is null) faltantes.Add("PPSetCommand");
        if (_setControlNumber is null) faltantes.Add("PPSetControlNumber");
        if (_setTransactionAmount is null) faltantes.Add("PPSetTransactionAmount");
        if (_sendTxn is null) faltantes.Add("PPSendTxn");
        if (faltantes.Count > 0)
        {
            Error = $"La DLL \"{RutaResuelta}\" no exporta las funciones: {string.Join(", ", faltantes)}.";
            return;
        }
        Disponible = true;
    }

    private static string ResolverRuta(string rutaDll, string? carpetaConfig)
    {
        if (Path.IsPathRooted(rutaDll)) return rutaDll;
        foreach (var baseDir in new[] { AppContext.BaseDirectory, carpetaConfig, Directory.GetCurrentDirectory() })
        {
            if (string.IsNullOrEmpty(baseDir)) continue;
            var ruta = Path.GetFullPath(Path.Combine(baseDir, rutaDll));
            if (File.Exists(ruta)) return ruta;
        }
        return Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, rutaDll));
    }

    private T? Export<T>(string nombre) where T : Delegate =>
        NativeLibrary.TryGetExport(_handle, nombre, out var p) ? Marshal.GetDelegateForFunctionPointer<T>(p) : null;

    /// <summary>
    /// Lee un parámetro de salida: primero PPGetXxx (devuelve const char*, no se libera);
    /// si no existe, PPVBGetXxx(StringBuilder); si tampoco, "".
    /// </summary>
    private string Leer(string nombre)
    {
        var get = Export<GetPuntero>("PPGet" + nombre);
        if (get is not null)
        {
            var p = get();
            return p == IntPtr.Zero ? "" : (Marshal.PtrToStringAnsi(p) ?? "").Trim();
        }
        var vb = Export<GetVB>("PPVBGet" + nombre);
        if (vb is not null)
        {
            var sb = new StringBuilder(512);
            vb(sb);
            return sb.ToString().Trim();
        }
        return "";
    }

    public RespuestaPuente Ejecutar(SolicitudTransaccion s, ConfiguracionBanorte cfg)
    {
        if (!Disponible) throw new InvalidOperationException(Error ?? "La DLL de Banorte no está cargada.");
        if (s.Referencia is not null && _setPaywReference is null)
            throw new InvalidOperationException("La DLL no exporta PPSetPaywReference; no se puede enviar la referencia.");
        if (s.Autorizacion is not null && _setAuthCode is null)
            throw new InvalidOperationException("La DLL no exporta PPSetAuthCode; no se puede enviar la autorización.");

        _setIPAddressPort!(cfg.IpPinpad, cfg.PuertoPinpad);
        _setUser!(cfg.Usuario);
        _setPassword!(cfg.Password);
        _setMode!(cfg.Modo);
        _setCommand!(s.Comando!);
        _setControlNumber!(s.NumeroControl!);
        // La DLL conserva los valores de la transacción anterior: se limpian los opcionales.
        _setTransactionAmount!(s.Monto is null ? 0f : (float)s.Monto.Value);
        _setCashBackAmount?.Invoke(0f);
        _setPaywReference?.Invoke(s.Referencia ?? "");
        _setAuthCode?.Invoke(s.Autorizacion ?? "");

        _sendTxn!(cfg.TimeoutSegundos);

        var resultado = Leer("PaywResult").ToUpperInvariant();
        var texto = Leer("Text").Replace('+', ' ').Trim();
        if (!RespuestaPuente.ResultadosValidos.Contains(resultado))
        {
            texto = $"La DLL no devolvió un resultado reconocible (\"{resultado}\"). {texto}".Trim();
            resultado = "E";
        }

        // Datos de la tarjeta: solo últimos 4 y como máximo los primeros 8 dígitos. El número
        // completo se descarta aquí mismo y nunca se guarda ni se registra.
        var ultimos4 = SoloDigitos(Leer("Pan"));
        ultimos4 = ultimos4.Length > 4 ? ultimos4[^4..] : ultimos4;
        var bin = SoloDigitos(Leer("Bin"));
        bin = bin.Length > 8 ? bin[..8] : bin;

        return new RespuestaPuente
        {
            Comando = s.Comando!,
            NumeroControl = s.NumeroControl!,
            Resultado = resultado,
            Codigo = Vacio(Leer("PaywCode")),
            Texto = Vacio(texto),
            Autorizacion = Vacio(Leer("AuthCode")),
            Referencia = Vacio(Leer("PaywReference")),
            Afiliacion = Vacio(Leer("Affiliation")),
            TipoTarjeta = Vacio(Leer("CardType")),
            Marca = Vacio(Leer("CardBrand")),
            Banco = Vacio(Leer("IssuingBank")),
            Bin = Vacio(bin),
            Ultimos4 = Vacio(ultimos4),
            ModoEntrada = Vacio(Leer("EntryMode")),
            PinValidado = Leer("PINRequested") == "1",
            ResultadoAutorizador = Vacio(Leer("AuthResult")),
            Aid = Vacio(Leer("AppID")),
            Tvr = Vacio(Leer("TVR")),
            AppPrefName = Vacio(Leer("AppPrefName")),
            AppLabel = Vacio(Leer("AppLabel")),
            FechaSolicitud = Vacio(Leer("CustReqDate")),
            FechaRespuesta = Vacio(Leer("CustRespDate")),
            Modo = cfg.Modo,
            Simulado = false,
        };
    }

    private static string SoloDigitos(string v) => new(v.Where(char.IsAsciiDigit).ToArray());
    private static string? Vacio(string v) => string.IsNullOrEmpty(v) ? null : v;
}
