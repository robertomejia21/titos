import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { connectDB } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
import { fechaEnZona, sumarDias } from "../src/lib/zonasHorarias";
import User from "../src/models/User";
import Sucursal from "../src/models/Sucursal";
import Venta from "../src/models/Venta";
import Pedido from "../src/models/Pedido";
import Factura from "../src/models/Factura";
import CajaSesion from "../src/models/CajaSesion";
import Arqueo from "../src/models/Arqueo";
import MovimientoCaja from "../src/models/MovimientoCaja";

async function main() {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  // Esta vista de QA siempre usa una base nueva en memoria, nunca el URI del entorno.
  process.env.MONGODB_URI = mongo.getUri("excel_qa_aislada");
  process.env.JWT_SECRET = "excel-qa-local-sin-datos-reales";
  let server: ReturnType<typeof spawn> | undefined;
  try {
    await connectDB();
    const admin = await User.create({ nombre: "Administración · PRUEBA", email: "excel@prueba.local", passwordHash: await hashPassword("Excel-local-2026"), role: "matriz" });
    const [norte, sur] = await Sucursal.create([{ nombre: "Tienda Norte · PRUEBA" }, { nombre: "Tienda Sur · PRUEBA" }]);
    const hoy = fechaEnZona(new Date());
    const dia = sumarDias(hoy, -1);
    const ahora = new Date();
    const caja = await CajaSesion.create({ sucursalId: norte._id, usuarioAperturaId: admin._id, usuarioCierreId: admin._id, estado: "cerrada", fechaApertura: ahora, fechaCierre: ahora,
      efectivoInicial: 100, efectivoInicialUsd: 10, totalVentasEfectivo: 20, totalVentasTarjeta: 30, totalVentasTransferencia: 0, totalRetiros: 10, totalRetirosUsd: 2,
      efectivoEsperado: 110, efectivoContado: 105, diferencia: -5, efectivoEsperadoUsd: 8, efectivoContadoUsd: 9, diferenciaUsd: 1 });
    await Arqueo.create({ sucursalId: norte._id, cajaSesionId: caja._id, usuarioId: admin._id, supervisorId: admin._id, supervisorNombre: "Gerente · PRUEBA", tokenHash: "sin-token-valido", estado: "guardado", consultadoEn: ahora, venceEn: ahora, guardadoEn: ahora, resumen: {}, efectivoEsperado: 110, efectivoContado: 105, diferencia: -5, efectivoEsperadoUsd: 8, efectivoContadoUsd: 9, diferenciaUsd: 1 });
    await MovimientoCaja.create({ folio: "RET-PRUEBA", sucursalId: norte._id, cajaSesionId: caja._id, usuarioId: admin._id, usuarioNombre: admin.nombre, moneda: "USD", monto: 2, motivo: "Retiro de prueba", corte: hoy });
    const ventas = await Venta.insertMany(Array.from({ length: 32 }, (_, i) => ({
      folio: `EXCEL-${String(i).padStart(3, "0")}`, sucursalId: i % 2 ? sur._id : norte._id, cajaSesionId: caja._id, usuarioId: admin._id,
      fecha: new Date(`${dia}T20:00:00Z`), corte: dia, estado: i === 31 ? "cancelada" : "completada", total: 10.25,
      clienteNombre: "Cliente · PRUEBA", esVentas2: i === 2, pagos: [{ metodoPago: "efectivo", monto: 10.25 }],
      items: [{ productoId: new mongoose.Types.ObjectId(), sku: "PRUEBA", nombreProducto: "Producto · PRUEBA", unidad: "pieza", cantidad: 1, precioUnitario: 10.25, subtotal: 10.25 }],
    })));
    await Factura.create({ folio: "FAC-PRUEBA", ventaId: ventas[0]._id, ventaFolio: ventas[0].folio, ventaFecha: ventas[0].fecha, sucursalId: norte._id, sucursalNombre: norte.nombre, corte: dia,
      receptor: { razonSocial: "Cliente · PRUEBA", rfc: "XAXX010101000", regimenFiscal: "616", usoCfdi: "S01", codigoPostal: "21100" },
      conceptos: [{ descripcion: "Producto · PRUEBA", cantidad: 1, unidad: "pieza", claveProdServ: "01010101", valorUnitario: 10.25, importe: 10.25 }],
      subtotal: 10.25, iva: 0, total: 10.25, creadoPorId: admin._id, creadoPorNombre: admin.nombre });
    await Pedido.create({ folio: "PED-PRUEBA", sucursalId: norte._id, estado: "nivelado", corte: dia, items: Array.from({ length: 18 }, (_, i) => ({ productoId: new mongoose.Types.ObjectId(), nombreProducto: `Producto ${i + 1} · PRUEBA`, unidad: "pieza", cantidadPedida: 10, cantidadAsignada: 8, cantidadSurtida: 6, cantidadRecibida: 4 })) });
    server = spawn("npm", ["run", "start", "--", "--port", "3100"], { stdio: "inherit", env: process.env });
    await new Promise<void>(resolve => {
      server!.on("exit", resolve);
      process.on("SIGTERM", () => { server?.kill(); resolve(); });
      process.on("SIGINT", () => { server?.kill(); resolve(); });
    });
  } finally {
    server?.kill();
    await mongoose.disconnect();
    await mongo.stop();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
