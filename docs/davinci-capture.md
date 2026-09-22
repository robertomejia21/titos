# Captura directa para el timeline

La integración solo carga al abrir el ERP dentro de un iframe. El archivo público davinci-capture.v1.js dibuja el viewport después de recibir una solicitud del portal Da Vinci autorizado; no captura escritorio, no modifica datos ni evita la autenticación.

Orígenes admitidos: https://interno.da-vinci.ai, https://portal.da-vinci.ai y https://iagent.base44.app. Se verifica además que el remitente sea la ventana padre. No se transmiten capturas espontáneamente.

Un formulario de contraseña visible impide capturar. Marca áreas sensibles con data-capture-private para ocultarlas en las imágenes sin alterar su posición. Imágenes de terceros sin CORS pueden quedar en blanco. El cliente siempre revisa la imagen antes de adjuntarla.

Bundle generado con html2canvas-pro 1.6.7 y esbuild; conserva avisos de licencia al final. Fuente: jonahgrca/Davinci-WebBrain, src/capture-bridge.js y src/lib/installCaptureBridge.js. Para regenerar desde ese repositorio: node tools/build-capture-bridge.mjs /ruta/a/este/ERP/public/davinci-capture.v1.js.

Revertir el commit de integración devuelve el comportamiento anterior sin cambios de base de datos.
