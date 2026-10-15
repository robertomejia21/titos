using System.Security.Cryptography;

namespace PuenteCaja;

/// <summary>
/// Simulador de la PinPad para probar sin la DLL. Nada llega a Banorte: todas las respuestas
/// llevan simulado=true y en modo PRD nunca aprueba.
/// Montos especiales: terminación .66 → T (sin respuesta), .77 → F (cancelado por el usuario), .88 → D.
/// </summary>
public sealed class PinpadSimulador : IPinpad
{
    private readonly Func<string, RespuestaPuente?> _buscarGuardada;
    private readonly Func<string, RespuestaPuente?> _buscarPorReferencia;

    public PinpadSimulador(Func<string, RespuestaPuente?> buscarGuardada, Func<string, RespuestaPuente?> buscarPorReferencia)
    {
        _buscarGuardada = buscarGuardada;
        _buscarPorReferencia = buscarPorReferencia;
    }

    public string Tipo => "simulador";
    public bool Simulado => true;
    public bool Disponible => true;
    public string? Error => null;

    public RespuestaPuente Ejecutar(SolicitudTransaccion s, ConfiguracionBanorte cfg)
    {
        var fechaSolicitud = Ahora();
        if (cfg.RetardoSimuladorMs > 0) Thread.Sleep(cfg.RetardoSimuladorMs);

        RespuestaPuente Base(string resultado) => new()
        {
            Comando = s.Comando!,
            NumeroControl = s.NumeroControl!,
            Resultado = resultado,
            Modo = cfg.Modo,
            Simulado = true,
            FechaSolicitud = fechaSolicitud,
            FechaRespuesta = Ahora(),
        };

        if (cfg.Modo == "PRD")
        {
            var e = Base("E");
            e.Codigo = "SIMULADOR";
            e.Texto = "El simulador no cobra en modo PRD";
            return e;
        }

        if (s.Comando == Comandos.Verificacion)
        {
            var original = _buscarGuardada(s.NumeroControl!)
                           ?? (s.Referencia is null ? null : _buscarPorReferencia(s.Referencia));
            if (original is not null && original.Comando != Comandos.Verificacion)
            {
                var r = original.Clonar();
                r.Comando = Comandos.Verificacion;
                r.NumeroControl = s.NumeroControl!;
                r.Simulado = true;
                return r;
            }
            var no = Base("R");
            no.Codigo = "PAYW-3012";
            no.Texto = "La transacción referenciada no existe";
            return no;
        }

        // Montos especiales para que el equipo web pruebe los caminos de error.
        if (s.Monto is decimal monto)
        {
            var centavos = (int)(decimal.Round(monto * 100m) % 100m);
            switch (centavos)
            {
                case 66:
                {
                    var t = Base("T");
                    t.Texto = "Sin respuesta del autorizador (simulador)";
                    return t;
                }
                case 77:
                {
                    var f = Base("F");
                    f.Codigo = "-2006";
                    f.Texto = "CANCELADO POR EL USUARIO";
                    return f;
                }
                case 88:
                    return Declinada(Base("D"));
            }
        }

        if (s.Comando == Comandos.ObtenerLlave)
        {
            var k = Base("A");
            k.Texto = "Llave cargada (simulador)";
            return k;
        }

        var aprobar = cfg.Modo switch
        {
            "AUT" => true,
            "DEC" => false,
            _ => RandomNumberGenerator.GetInt32(2) == 0, // RND
        };
        if (!aprobar) return Declinada(Base("D"));

        var a = Base("A");
        var credito = RandomNumberGenerator.GetInt32(2) == 0;
        var visa = RandomNumberGenerator.GetInt32(2) == 0;
        a.Codigo = "00";
        a.Texto = s.Comando switch
        {
            Comandos.Venta => "Aprobada (simulador)",
            Comandos.Cancelacion or Comandos.Devolucion or Comandos.Reversa =>
                $"{s.Comando} aprobada (simulador) sobre la referencia {s.Referencia ?? s.NumeroControl}",
            _ => "Aprobada (simulador)",
        };
        a.Autorizacion = Digitos(6);
        a.Referencia = Digitos(12);
        a.Afiliacion = "9862356";
        a.TipoTarjeta = credito ? "CREDITO" : "DEBITO";
        a.Marca = visa ? "VISA" : "MASTERCARD";
        a.Banco = "BANORTE";
        a.Bin = "545608";
        a.Ultimos4 = Digitos(4);
        a.ModoEntrada = "CONTACTLESSCHIP";
        a.PinValidado = false;
        a.ResultadoAutorizador = "A";
        a.Aid = "A0000000041010";
        a.Tvr = "0000008001";
        a.AppPrefName = "MASTERCARD";
        a.AppLabel = "MASTERCARD";
        return a;
    }

    private static RespuestaPuente Declinada(RespuestaPuente r)
    {
        r.Codigo = "05";
        r.Texto = "Declinada (modo prueba)";
        r.ResultadoAutorizador = "D";
        return r;
    }

    private static string Ahora() => DateTime.Now.ToString("yyyyMMdd HH:mm:ss.fff");

    private static string Digitos(int n)
    {
        var c = new char[n];
        for (var i = 0; i < n; i++) c[i] = (char)('0' + RandomNumberGenerator.GetInt32(10));
        return new string(c);
    }
}
