import { forwardRef, type ReactNode } from "react";
import { type LucideIcon } from "lucide-react";

export { Modal } from "./Modal";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-black/5 bg-white p-5 shadow-sm ${className}`}>{children}</div>
  );
}

export function PageHeader({
  title,
  description,
  action,
  icon: Icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {Icon ? (
          <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-titos-green-100 text-titos-green-700">
            <Icon className="h-5.5 w-5.5" />
          </span>
        ) : null}
        <div>
          <h1 className="font-display text-2xl font-bold text-titos-green-900">{title}</h1>
          {description ? <p className="mt-1 text-sm text-black/60">{description}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

const ESTADO_STYLES: Record<string, string> = {
  pendiente: "bg-amber-100 text-amber-800",
  nivelado: "bg-sky-100 text-sky-800",
  surtido: "bg-titos-orange-100 text-titos-orange-700",
  recibido: "bg-titos-green-100 text-titos-green-700",
  borrador: "bg-black/5 text-black/60",
  solicitada: "bg-sky-100 text-sky-800",
  recibida: "bg-titos-green-100 text-titos-green-700",
  completada: "bg-titos-green-100 text-titos-green-700",
  cancelada: "bg-red-100 text-red-700",
  asignada: "bg-sky-100 text-sky-800",
  convertida: "bg-titos-green-100 text-titos-green-700",
};

export function EstadoBadge({ estado }: { estado: string }) {
  const style = ESTADO_STYLES[estado] ?? "bg-black/5 text-black/70";
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${style}`}>
      {estado.replaceAll("_", " ")}
    </span>
  );
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const variants: Record<string, string> = {
    primary: "bg-titos-green-600 text-white hover:bg-titos-green-700",
    secondary: "bg-titos-orange-600 text-white hover:bg-titos-orange-700",
    danger: "bg-red-600 text-white hover:bg-red-700",
    ghost: "bg-transparent text-titos-green-700 hover:bg-titos-green-100",
  };
  // "sm" es para acciones dentro de tablas, donde el tamaño normal domina la fila.
  const sizes: Record<string, string> = {
    sm: "rounded-md px-2.5 py-1 text-xs",
    md: "rounded-lg px-4 py-2 text-sm",
  };
  return (
    <button
      className={`font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${sizes[size]} ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { icon?: LucideIcon }>(
  function Input({ icon: Icon, className = "", ...props }, ref) {
    const input = (
      <input
        ref={ref}
        {...props}
        className={`w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-titos-green-500 focus:ring-2 focus:ring-titos-green-100 ${Icon ? "pl-9" : ""} ${className}`}
      />
    );
    if (!Icon) return input;
    return (
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/30" />
        {input}
      </div>
    );
  }
);

export function Select({
  icon: Icon,
  className = "",
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { icon?: LucideIcon }) {
  const select = (
    <select
      {...props}
      className={`w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm outline-none focus:border-titos-green-500 focus:ring-2 focus:ring-titos-green-100 ${Icon ? "pl-9" : ""} ${className}`}
    />
  );
  if (!Icon) return select;
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/30" />
      {select}
    </div>
  );
}

export function FormField({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label className="mb-1 block text-sm font-medium text-black/70">{label}</label>
      {children}
    </div>
  );
}

export function FormGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`grid grid-cols-1 gap-3.5 sm:grid-cols-2 ${className}`}>{children}</div>;
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(value);
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-black/10 bg-black/[0.02] p-8 text-center text-sm text-black/50">
      {message}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  onChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalItems);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-black/5 pt-3 text-sm">
      <p className="text-black/50">
        Mostrando {from}–{to} de {totalItems}
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          className="rounded-lg px-3 py-1.5 font-medium text-titos-green-700 hover:bg-titos-green-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Anterior
        </button>
        <span className="px-2 text-black/50">
          Página {page} de {totalPages}
        </span>
        <button
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          className="rounded-lg px-3 py-1.5 font-medium text-titos-green-700 hover:bg-titos-green-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Siguiente
        </button>
      </div>
      <details className="w-full text-xs text-titos-green-900">
        <summary className="list-item min-h-11 py-3 focus-visible:outline">Ayuda de navegación</summary>
        <div>Usa Anterior y Siguiente para recorrer los registros de esta lista.</div>
      </details>
    </div>
  );
}
