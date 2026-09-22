export type PuertoSerial = {
  open(options: OpcionesSerial): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  close(): Promise<void>;
};
export type OpcionesSerial = { baudRate: number; dataBits: 7 | 8; stopBits: 1 | 2; parity: "none" | "even" | "odd"; flowControl: "none" | "hardware" };
export type SerialApi = { requestPort(): Promise<PuertoSerial> };

// Solo diagnóstico de recepción. No envía comandos, interpreta kilos ni autoriza ventas.
export async function leerPuertoDiagnostico(serial: SerialApi, options: OpcionesSerial, signal: AbortSignal, timeoutMs = 8000): Promise<number[]> {
  const port = await serial.requestPort();
  if (signal.aborted) return [];
  let opened = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { void reader?.cancel().catch(() => {}); };
  try {
    await port.open(options);
    opened = true;
    if (signal.aborted) return [];
    if (!port.readable) throw new Error("El puerto no permite recibir datos");
    reader = port.readable.getReader();
    signal.addEventListener("abort", stop, { once: true });
    timer = setTimeout(stop, timeoutMs);
    const bytes: number[] = [];
    while (!signal.aborted && bytes.length < 4096) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) bytes.push(...value.slice(0, 4096 - bytes.length));
    }
    return bytes;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
    if (reader) await reader.cancel().catch(() => {});
    reader?.releaseLock();
    if (opened) await port.close();
  }
}
