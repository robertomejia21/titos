# Exportación a Excel de reportes

Solicitud: botones de Excel en reportes, ventas, cortes de caja y facturas de Titos. Alcance confirmado en el chat el 21 de septiembre de 2026.

Criterios de aceptación:
- Descargar .xlsx real con números utilizables en Excel, hojas de detalle, resumen y filtros.
- Incluir los registros consultados de todas las páginas de la tabla, respetando sucursal, fechas, búsqueda y estado.
- Identificar los límites de consulta y no presentar un subconjunto como si fuera el total de la base.
- Mantener cancelaciones separadas de importes vigentes, MXN separado de USD, y documentos internos separados del timbrado fiscal.
- Bloquear la exportación durante carga, error o datos desactualizados por un cambio de filtro.
- Conservar permisos y consultas existentes. Sin escrituras de datos comerciales.

Diseño: misma tipografía, colores y distribución de Titos. Botón secundario junto a las acciones del reporte, con etiqueta explícita, foco visible y área táctil de 44 px. Icono de hoja de cálculo para identificar el formato. ENERGY/RHYTHM/MOTION: 1/1/1; sin animación nueva.

Entrega: verificar libros y descargas, probar en navegador, conservar captura real y texto de WhatsApp. Adjuntar al punto correspondiente del timeline cuando exista una petición identificable para este cambio.

Verificación local:
- TypeScript, ESLint de archivos modificados, `git diff --check` y compilación de producción: aprobados.
- `npx tsx scripts/check-exportaciones-excel.ts`: seis libros serializados y leídos de nuevo, números y centavos, cancelaciones, fechas locales, ceros iniciales y texto que empieza con `=` sin fórmulas.
- Navegador contra compilación de producción con MongoDB aislada: ocho descargas reales, incluidos todos los botones y una segunda descarga de ventas filtrada por tienda. Comparativo: 18 registros aunque la página presenta 15; ventas: 31 sin filtro y 15 con una tienda; por facturar: 30; global: 30 pendientes y una individual.
- Arqueos sin coincidencias deshabilita Excel. Consola sin errores ni advertencias en el flujo de QA.
- Revisión a 390 px: botón visible, campos apilados, ancho del documento sin desbordamiento; navegación por teclado comprobada.
- React: biblioteca XLSX cargada bajo demanda, datos del reporte capturados antes de la descarga, exclusión de respuestas antiguas y bloqueo de exportación con filtros todavía no consultados.

Alcance de las descargas: las consultas existentes conservan sus límites (ventas 2,000; cortes 300; facturas 500; ventas elegibles por facturar 600; arqueos 1,000). El libro identifica el alcance y la interfaz informa cómo reducir el periodo. La global mantiene su consulta actual sin estos límites.

No se modifican esquema, datos, permisos ni cobros. Reversión: revertir el commit de esta funcionalidad y desplegar la versión anterior.
