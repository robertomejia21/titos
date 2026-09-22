"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Button, Input } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usuario, password }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo iniciar sesión");
      return;
    }

    const data = await res.json();
    const next = searchParams.get("next");
    const destino = next || (data.role === "matriz" ? "/matriz" : "/sucursal");
    router.push(destino);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-titos-cream px-4 py-10">
      <div className="w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-xl">
        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className="relative flex flex-col justify-between overflow-hidden bg-linear-to-br from-titos-green-700 via-titos-green-600 to-titos-green-500 p-10 text-white">
            <div className="pointer-events-none absolute -top-16 -left-16 h-56 w-56 rounded-full bg-white/10" />
            <div className="pointer-events-none absolute top-1/3 right-8 h-24 w-24 rounded-full bg-white/10" />
            <div className="pointer-events-none absolute -bottom-10 -right-10 h-48 w-48 rounded-full bg-titos-orange-500/40 blur-md" />

            <div className="relative w-fit rounded-2xl bg-white p-5 shadow-lg">
              <Image
                src="/media/logo.png"
                alt="Mercados Titos"
                width={512}
                height={184}
                priority
                className="h-auto w-48"
              />
            </div>

            <div className="relative mt-16">
              <h1 className="text-3xl font-black leading-tight text-balance">
                Lleva el control de tu almacén con Titos
              </h1>
              <p className="mt-4 max-w-xs text-sm text-white/80">
                Recibe, registra y distribuye mercancía a todas tus sucursales desde un solo lugar.
              </p>
            </div>
          </div>

          <div className="flex flex-col justify-center p-8 sm:p-12">
            <p className="text-xs font-semibold uppercase tracking-wide text-titos-green-600">Almacén Central</p>
            <h2 className="mt-1 text-2xl font-bold text-titos-green-900">Inicia sesión</h2>
            <p className="mt-1 text-sm text-black/50">Accede con tu cuenta de matriz o sucursal.</p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-black/70">Usuario</label>
                <Input
                  type="text"
                  required
                  value={usuario}
                  onChange={(e) => setUsuario(e.target.value)}
                  placeholder="tu usuario"
                  autoComplete="username"
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-black/70">Contraseña</label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-black/40 hover:text-black/60"
                  >
                    {showPassword ? (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5 1.06 0 2.08-.157 3.04-.448M6.228 6.228A10.45 10.45 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.5a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <Button type="submit" disabled={loading} className="w-full justify-center">
                {loading ? "Entrando..." : "Iniciar sesión"}
              </Button>
            </form>

            <p className="mt-10 text-center text-xs text-black/30">
              © {new Date().getFullYear()} Mercados Titos. Todos los derechos reservados.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
