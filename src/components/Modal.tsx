"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X, type LucideIcon } from "lucide-react";

const MODAL_SIZES = {
  md: "max-w-2xl",
  lg: "max-w-3xl",
  xl: "max-w-6xl",
};

export function Modal({
  open,
  onClose,
  title,
  icon: Icon,
  size = "md",
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: LucideIcon;
  size?: keyof typeof MODAL_SIZES;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const mouseDownOnBackdrop = useRef(false);

  // Esc cierra: en el mostrador se opera con teclado y buscar la X con el mouse
  // cuesta más que la operación misma.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        mouseDownOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (mouseDownOnBackdrop.current && e.target === e.currentTarget) onClose();
        mouseDownOnBackdrop.current = false;
      }}
    >
      <div
        className={`max-h-[85vh] w-full ${MODAL_SIZES[size]} overflow-y-auto rounded-2xl bg-white p-6 shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="flex items-center gap-2.5 font-display text-lg font-bold text-titos-green-900">
            {Icon ? (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-titos-green-100 text-titos-green-700">
                <Icon className="h-4.5 w-4.5" />
              </span>
            ) : null}
            {title}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-black/40 hover:bg-black/5 hover:text-black/60">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
        {footer ? <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-black/5 pt-4">{footer}</div> : null}
      </div>
    </div>
  );
}
