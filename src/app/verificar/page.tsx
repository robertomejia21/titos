"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function VerificarContenido() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [estado, setEstado] = useState<"cargando" | "ok" | "error">("cargando");
  const [mensaje, setMensaje] = useState("");
  const [nombre, setNombre] = useState("");

  useEffect(() => {
    if (!token) {
      setEstado("error");
      setMensaje("Enlace de verificación inválido.");
      return;
    }

    fetch(`/api/verificar-whatsapp?token=${token}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok) {
          setEstado("ok");
          setMensaje(data.mensaje);
          setNombre(data.nombre ?? "");
        } else {
          setEstado("error");
          setMensaje(data.error ?? "No se pudo verificar la cuenta.");
        }
      })
      .catch(() => {
        setEstado("error");
        setMensaje("Error de conexión. Intenta de nuevo.");
      });
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-8 text-center shadow-lg">
        {estado === "cargando" && (
          <p className="text-gray-600">Verificando tu cuenta…</p>
        )}
        {estado === "ok" && (
          <>
            <div className="mb-4 text-5xl">✅</div>
            <h1 className="mb-2 text-xl font-bold text-gray-900">
              {nombre ? `¡Bienvenido, ${nombre}!` : "¡Cuenta verificada!"}
            </h1>
            <p className="mb-6 text-gray-600">{mensaje}</p>
            <a
              href="/login"
              className="inline-block rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700"
            >
              Iniciar sesión
            </a>
          </>
        )}
        {estado === "error" && (
          <>
            <div className="mb-4 text-5xl">❌</div>
            <h1 className="mb-2 text-xl font-bold text-gray-900">
              Verificación fallida
            </h1>
            <p className="text-gray-600">{mensaje}</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerificarPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><p>Cargando…</p></div>}>
      <VerificarContenido />
    </Suspense>
  );
}
