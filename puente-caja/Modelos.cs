using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace PuenteCaja;

public static class Comandos
{
    public const string ObtenerLlave = "OBTENER_LLAVE";
    public const string Venta = "VENTA";
    public const string Cancelacion = "CANCELACION";
    public const string Devolucion = "DEVOLUCION";
    public const string Reversa = "REVERSA";
    public const string Verificacion = "VERIFICACION";

    public static readonly string[] Todos = { ObtenerLlave, Venta, Cancelacion, Devolucion, Reversa, Verificacion };
    public static readonly string[] ConMonto = { Venta, Cancelacion, Devolucion };
    public static readonly string[] ConReferenciaObligatoria = { Cancelacion, Devolucion };
}

/// <summary>Cuerpo de POST /banorte/transaccion.</summary>
public sealed class SolicitudTransaccion
{
    public string? Comando { get; set; }
    public string? NumeroControl { get; set; }
    public decimal? Monto { get; set; }
    public string? Referencia { get; set; }
    public string? Autorizacion { get; set; }

    public const decimal MontoMaximo = 999999.99m;
    private static readonly Regex Alfanumerico = new("^[A-Za-z0-9]{1,30}$", RegexOptions.CultureInvariant);

    /// <summary>Normaliza y valida. Devuelve el mensaje de error o null si es válida.</summary>
    public string? Validar()
    {
        Comando = Comando?.Trim().ToUpperInvariant();
        NumeroControl = NumeroControl?.Trim();
        Referencia = string.IsNullOrWhiteSpace(Referencia) ? null : Referencia.Trim();
        Autorizacion = string.IsNullOrWhiteSpace(Autorizacion) ? null : Autorizacion.Trim();

        if (string.IsNullOrEmpty(Comando) || !Comandos.Todos.Contains(Comando))
            return "comando no válido. Use OBTENER_LLAVE, VENTA, CANCELACION, DEVOLUCION, REVERSA o VERIFICACION.";
        if (string.IsNullOrEmpty(NumeroControl) || !Alfanumerico.IsMatch(NumeroControl))
            return "numeroControl es obligatorio y solo puede tener letras y números sin acentos (máximo 30).";

        if (Comandos.ConMonto.Contains(Comando))
        {
            if (Monto is null || Monto <= 0) return $"monto es obligatorio y debe ser mayor a 0 para {Comando}.";
        }
        if (Monto is not null)
        {
            if (Monto <= 0 || Monto > MontoMaximo) return "monto fuera de rango.";
            if (decimal.Round(Monto.Value, 2) != Monto.Value) return "monto no puede tener más de 2 decimales.";
        }

        if (Comandos.ConReferenciaObligatoria.Contains(Comando) && Referencia is null)
            return $"referencia es obligatoria para {Comando} (referencia Payworks de la transacción original).";
        if (Referencia is not null && !Alfanumerico.IsMatch(Referencia))
            return "referencia solo puede tener letras y números (máximo 30).";
        if (Autorizacion is not null && !Alfanumerico.IsMatch(Autorizacion))
            return "autorizacion solo puede tener letras y números (máximo 30).";
        return null;
    }
}

/// <summary>
/// Respuesta del puente. Nunca lleva el número completo de la tarjeta ni la vigencia:
/// solo bin (máx. 8 dígitos) y últimos 4.
/// </summary>
public sealed class RespuestaPuente
{
    public bool Ok { get; set; } = true;
    public string Comando { get; set; } = "";
    public string NumeroControl { get; set; } = "";
    public string Resultado { get; set; } = "E";
    public string? Codigo { get; set; }
    public string? Texto { get; set; }
    public string? Autorizacion { get; set; }
    public string? Referencia { get; set; }
    public string? Afiliacion { get; set; }
    public string? TipoTarjeta { get; set; }
    public string? Marca { get; set; }
    public string? Banco { get; set; }
    public string? Bin { get; set; }
    public string? Ultimos4 { get; set; }
    public string? ModoEntrada { get; set; }
    public bool? PinValidado { get; set; }
    public string? ResultadoAutorizador { get; set; }
    public string? Aid { get; set; }
    public string? Tvr { get; set; }
    public string? AppPrefName { get; set; }
    public string? AppLabel { get; set; }
    public string? FechaSolicitud { get; set; }
    public string? FechaRespuesta { get; set; }
    public string Modo { get; set; } = "AUT";
    public bool Simulado { get; set; }

    public static readonly string[] ResultadosValidos = { "A", "D", "R", "T", "F", "E" };

    public RespuestaPuente Clonar() => (RespuestaPuente)MemberwiseClone();

    public static RespuestaPuente Error(SolicitudTransaccion s, string modo, bool simulado, string texto, string codigo = "PUENTE") => new()
    {
        Comando = s.Comando ?? "",
        NumeroControl = s.NumeroControl ?? "",
        Resultado = "E",
        Codigo = codigo,
        Texto = texto,
        Modo = modo,
        Simulado = simulado,
    };
}

public static class Json
{
    public static readonly JsonSerializerOptions Opciones = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static string Serializar<T>(T valor) => JsonSerializer.Serialize(valor, Opciones);
}
