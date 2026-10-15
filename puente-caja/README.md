# Puente de caja Titos

Programa pequeño para Windows que corre en la **PC de caja** y conecta el punto de venta web de Titos
(https://titos.da-vinci.ai) con la **terminal Banorte** (PinPad PAX A920Pro, Payworks "Interredes Remoto").

```
Navegador (punto de venta)  ──HTTP local──►  Puente de caja  ──DLL PINPAD.TPV──►  PinPad A920Pro  ──►  Banorte
```

- El navegador **no** habla con la terminal ni con Banorte; le pide al puente que cobre.
- El usuario y la contraseña de Payworks **solo** viven en esta PC (archivo `puente-caja.json`). Nunca se suben a la nube.
- El puente **nunca** devuelve ni guarda el número completo de la tarjeta: solo los últimos 4 dígitos y el BIN (máx. 8 dígitos). Tampoco la vigencia.
- Solo acepta conexiones desde la misma PC (`localhost` / `127.0.0.1`) y solo de las páginas listadas en `origenesPermitidos`.
- Mientras no tengamos la DLL de Banorte se puede usar con el **simulador** integrado (no cobra nada).

---

## 1. Requisitos

- Windows 10 u 11.
- La PC de caja y la PinPad en la **misma red** (la PinPad debe mostrar *"Esperando comando · Vía red"*).
- La DLL de Banorte `PINPAD.TPV` (la entrega Banorte junto con usuario y contraseña de Payworks).
- Para compilar o usar `dotnet run`: el **SDK de .NET 9**. Como el programa es de 32 bits (x86), `dotnet run` necesita también el
  *runtime* de .NET 9 x86 (normalmente ya se instala con el SDK; si no, descargue ".NET Runtime 9 – Windows x86").
  El ejecutable publicado (sección 5) **no** necesita nada instalado.

## 2. Dónde poner `PINPAD.TPV`

Copie `PINPAD.TPV` (y cualquier otro archivo que venga con ella, por ejemplo otras DLL) **en la misma carpeta que `PuenteCaja.exe`**.
Si prefiere otra carpeta, ponga la ruta completa en `banorte.rutaDll`.

> La DLL **no** se sube al repositorio (`.gitignore` la excluye).

## 3. Configurar `puente-caja.json`

Copie `puente-caja.ejemplo.json` como `puente-caja.json` en la carpeta del exe (o en la carpeta del proyecto si usa `dotnet run`) y llénelo:

```json
{
  "puerto": 8091,
  "origenesPermitidos": ["https://titos.da-vinci.ai", "http://localhost:3000"],
  "banorte": {
    "usarSimulador": false,
    "rutaDll": "PINPAD.TPV",
    "ipPinpad": "192.168.100.44",
    "puertoPinpad": "1818",
    "usuario": "USUARIO_PAYWORKS",
    "password": "CONTRASEÑA_PAYWORKS",
    "modo": "AUT",
    "timeoutSegundos": 90,
    "retardoSimuladorMs": 2000
  }
}
```

| Campo | Qué es |
|---|---|
| `puerto` | Puerto local donde escucha el puente. El punto de venta debe usar el mismo. |
| `origenesPermitidos` | Páginas que pueden usar el puente. Cualquier otra recibe 403. |
| `usarSimulador` | `true` = simulador (no cobra). `false` = DLL real de Banorte. |
| `rutaDll` | Ruta a `PINPAD.TPV` (relativa a la carpeta del exe o absoluta). |
| `ipPinpad` / `puertoPinpad` | IP y puerto que muestra la PinPad en *"Esperando comando · Vía red"*. |
| `usuario` / `password` | Credenciales del Motor Payworks. **Se quedan solo en esta PC.** La contraseña nunca se muestra ni se escribe en los logs. |
| `modo` | `PRD` producción (cobros reales), `AUT` pruebas siempre aprobadas, `DEC` pruebas siempre declinadas, `RND` pruebas al azar. |
| `timeoutSegundos` | Cuánto espera la DLL a la PinPad (por omisión 90). |
| `retardoSimuladorMs` | Solo simulador: cuánto "tarda" en pasar la tarjeta. |

Variables de entorno opcionales (tienen prioridad sobre el archivo): `BANORTE_PAYWORKS_USUARIO`, `BANORTE_PAYWORKS_PASSWORD`,
`BANORTE_PINPAD_IP`, `BANORTE_PINPAD_PUERTO`, `BANORTE_MODO`.

> **Importante:** si `usarSimulador` es `false` y la DLL no se puede cargar, el puente arranca igual pero **no** cae al simulador:
> `/estado` muestra `dllCargada: false` (con el motivo en `errorDll`) y cada transacción responde un error claro. Así un cajero nunca cree
> que se cobró cuando no fue así.

## 4. Ejecutar

Desde la carpeta `puente-caja`:

```powershell
dotnet run
```

Al arrancar muestra la versión, la dirección, si usa DLL o simulador, la IP:puerto de la PinPad, el modo Payworks y los orígenes
permitidos. Si el modo es **PRD** aparece un aviso en rojo: las ventas aprobadas son cobros **reales**.

Deje la ventana abierta mientras se cobra. **Ctrl+C** la cierra.

Opciones: `--config ruta\archivo.json`, `--puerto 8092`, `--probar` (autoprueba con el simulador; termina con código 0 si todo salió bien):

```powershell
dotnet run -- --probar
```

## 5. Publicar un solo `.exe`

```powershell
dotnet publish -c Release -r win-x86 --self-contained true -p:PublishSingleFile=true
```

El resultado queda en `bin\Release\net9.0\win-x86\publish\`. Copie a la PC de caja, en una carpeta como `C:\PuenteCaja\`:

- `PuenteCaja.exe`
- `puente-caja.json` (lleno)
- `PINPAD.TPV`

No necesita instalar .NET en esa PC. Los registros se guardan en `C:\PuenteCaja\logs\`.

## 6. Que arranque con Windows

**Opción A – Acceso directo (más sencilla):**
1. `Win + R`, escriba `shell:startup` y Enter.
2. Clic derecho → Nuevo → Acceso directo → seleccione `C:\PuenteCaja\PuenteCaja.exe`.
3. En las propiedades del acceso directo, en "Iniciar en" ponga `C:\PuenteCaja`.

**Opción B – Programador de tareas:**
1. Abra "Programador de tareas" → "Crear tarea básica".
2. Desencadenador: "Al iniciar sesión".
3. Acción: "Iniciar un programa" → `C:\PuenteCaja\PuenteCaja.exe`, "Iniciar en": `C:\PuenteCaja`.
4. En la pestaña General, deje "Ejecutar solo cuando el usuario haya iniciado sesión" (así se ve la ventana).

## 7. Probar con curl

```powershell
# Estado
curl http://localhost:8091/estado

# Venta de prueba (en modo AUT, o con el simulador)
curl -X POST http://localhost:8091/banorte/transaccion -H "Content-Type: application/json" -d "{\"comando\":\"VENTA\",\"numeroControl\":\"PRUEBA001\",\"monto\":10.50}"

# Recuperar la respuesta de una transacción
curl http://localhost:8091/banorte/resultado/PRUEBA001
```

### API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/estado` | `{ ok, version, pinpad: "dll"\|"simulador", dllCargada, ip, puerto, modo, ocupado, credenciales, errorDll? }` |
| POST | `/banorte/transaccion` | Ejecuta `OBTENER_LLAVE`, `VENTA`, `CANCELACION`, `DEVOLUCION`, `REVERSA` o `VERIFICACION`. Bloquea hasta que la PinPad contesta. |
| GET | `/banorte/resultado/{numeroControl}` | Última respuesta guardada para ese número de control (404 si no hay). |

Cuerpo de `POST /banorte/transaccion`: `{ comando, numeroControl, monto?, referencia?, autorizacion? }`.
- `numeroControl`: obligatorio, solo letras y números, máx. 30 (Payworks rechaza `-` y `_` con -1006).
- `monto`: obligatorio y mayor a 0 en VENTA, CANCELACION y DEVOLUCION (máx. 2 decimales).
- `referencia`: obligatoria en CANCELACION y DEVOLUCION (referencia Payworks de la original).

Códigos HTTP: 200 respuesta de la terminal (ver `resultado`), 400 datos inválidos, 403 origen no permitido, 409 terminal ocupada,
503 DLL no cargada (no se cobró nada).

`resultado`: `A` aprobada, `D` declinada, `R` rechazada, `T` sin respuesta (hay que verificar), `F` error de la PinPad, `E` error de la DLL o del puente.

## 8. Montos especiales del simulador

Con `usarSimulador: true` el resultado depende del modo y del monto:

| Caso | Resultado |
|---|---|
| Modo `AUT` | `A` aprobada |
| Modo `DEC` | `D` "Declinada (modo prueba)" |
| Modo `RND` | `A` o `D` al azar |
| Modo `PRD` | `E` "El simulador no cobra en modo PRD" |
| Monto terminado en **.66** (ej. 10.66) | `T` sin respuesta |
| Monto terminado en **.77** | `F`, código `-2006`, "CANCELADO POR EL USUARIO" |
| Monto terminado en **.88** | `D` declinada |
| `OBTENER_LLAVE` | `A` "Llave cargada (simulador)" |
| `VERIFICACION` de un número de control ya enviado | La respuesta original con `comando: "VERIFICACION"` |
| `VERIFICACION` de algo que no existe | `R`, código `PAYW-3012` |
| `CANCELACION` / `DEVOLUCION` / `REVERSA` | `A` con nueva referencia |

Todas las respuestas del simulador llevan `"simulado": true`.

## 9. Problemas comunes

| Código | Qué pasa | Qué hacer |
|---|---|---|
| `-1001`, `-1003` | No se pudo conectar con la terminal. | Revise que la PinPad esté encendida, en la misma red, y que `ipPinpad`/`puertoPinpad` coincidan con lo que muestra en *"Esperando comando · Vía red"*. Pruebe `ping 192.168.100.44`. Revise el firewall. |
| `-2020`, `PAYW-2019` | La terminal no tiene llaves cargadas. | Ejecute `OBTENER_LLAVE` (desde el punto de venta o con curl) y vuelva a intentar. |
| `PAYW-3003` | Usuario o contraseña de Payworks incorrectos. | Revise `usuario` y `password` en `puente-caja.json` (o las variables de entorno) y reinicie el puente. |
| `-1006` | Número de control inválido. | Solo letras y números. |
| `-2006` | El cliente canceló en la PinPad. | Volver a cobrar. |
| `T` | Payworks no supo si se cobró. | Hacer `VERIFICACION` con el mismo número de control antes de volver a cobrar. |
| `dllCargada: false` | No se encontró o no se pudo abrir `PINPAD.TPV`. | Revise que esté junto al exe. Si el mensaje habla de "formato incorrecto", vea la sección 10. |
| "No se pudo abrir el puerto" | Ya hay otro puente abierto o el puerto está ocupado. | Cierre la otra ventana o cambie `puerto` (y también en el punto de venta). |
| "Origen no permitido" (403) | La página que llama no está en `origenesPermitidos`. | Agréguela al archivo y reinicie. |

Los registros de cada transacción están en `logs\transacciones-AAAA-MM-DD.log` (sin número de tarjeta ni contraseña).

## 10. 32 bits (x86) o 64 bits (x64)

Las DLL de Banorte suelen ser de **32 bits**, por eso el puente se compila como x86. Si al arrancar aparece un error de
*"formato incorrecto"* / `BadImageFormatException`, la DLL es de 64 bits:

1. En `PuenteCaja.csproj` cambie `<PlatformTarget>x86</PlatformTarget>` por `<PlatformTarget>x64</PlatformTarget>`.
2. Publique con `-r win-x64` en lugar de `-r win-x86`:
   ```powershell
   dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true
   ```

## 11. Nota sobre 127.0.0.1

El puente escucha en `http://localhost:{puerto}/` y `http://127.0.0.1:{puerto}/`. Si Windows no permite registrar `127.0.0.1` sin
permisos de administrador, el puente sigue funcionando solo con `localhost` y muestra un aviso. Para habilitarlo, en una consola de
administrador:

```powershell
netsh http add urlacl url=http://127.0.0.1:8091/ user=%USERNAME%
```
