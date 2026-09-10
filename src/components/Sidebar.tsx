"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutDashboard,
  Package,
  Warehouse,
  Store,
  CreditCard,
  Ticket,
  ScrollText,
  UserCog,
  ClipboardList,
  ShoppingCart,
  Truck,
  Users,
  Settings,
  BarChart3,
  PlusCircle,
  LogOut,
  ChevronsLeft,
  ChevronsRight,
  ChevronDown,
  ChevronRight,
  Menu,
  X,
  FileText,
  Wrench,
  Receipt,
  ReceiptText,
  Tags,
  Tag,
  Ban,
  TrendingUp,
  Banknote,
  BadgeDollarSign,
  RotateCcw,
  ArrowLeftRight,
  ClipboardCheck,
  Presentation,
  Search,
  type LucideIcon,
} from "lucide-react";
import { opcionesBusqueda, type ResultadoBusqueda } from "@/lib/busqueda";
import { permisoDeRuta, tienePermiso } from "@/lib/permisos";

// "exact" es para las rutas que son padre de otras (el punto de venta del
// mostrador) y no deben marcarse activas mientras se navega en sus hijas.
type NavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean };
type NavCategory = { label: string; icon: LucideIcon; items: NavItem[] };

const MATRIZ_NAV: NavCategory[] = [
  {
    label: "Central",
    icon: LayoutDashboard,
    items: [{ href: "/matriz", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Mostrador",
    icon: ShoppingCart,
    items: [
      { href: "/matriz/mostrador", label: "Punto de venta", icon: ShoppingCart, exact: true },
      { href: "/matriz/mostrador/ventas", label: "Historial de ventas", icon: Receipt },
      { href: "/matriz/mostrador/clientes", label: "Clientes", icon: Users },
      { href: "/matriz/mostrador/devoluciones", label: "Devoluciones", icon: RotateCcw },
    ],
  },
  {
    label: "Reportes",
    icon: FileText,
    items: [
      { href: "/matriz/reportes", label: "Reportes", icon: BarChart3, exact: true },
      { href: "/matriz/reportes/productos", label: "Comparación por producto", icon: BarChart3 },
      { href: "/matriz/reportes/ventas", label: "Ventas por sucursal", icon: TrendingUp },
      { href: "/matriz/cancelaciones", label: "Cancelaciones", icon: Ban },
      { href: "/matriz/cortes", label: "Corte global", icon: ClipboardCheck },
      { href: "/matriz/notas-de-venta", label: "Notas de venta", icon: Banknote },
      { href: "/matriz/actualizacion-precios", label: "Actualización de precios", icon: BadgeDollarSign },
    ],
  },
  {
    label: "Productos",
    icon: Package,
    items: [{ href: "/matriz/productos", label: "Productos", icon: Package }],
  },
  {
    label: "Servicios",
    icon: Wrench,
    items: [],
  },
  {
    label: "Catálogos",
    icon: ClipboardList,
    items: [
      { href: "/matriz/sucursales", label: "Sucursales", icon: Store },
      { href: "/matriz/proveedores", label: "Proveedores", icon: Truck },
      { href: "/matriz/personal", label: "Personal", icon: Users },
      { href: "/matriz/terminales", label: "Terminales de pago", icon: CreditCard },
      { href: "/matriz/vales", label: "Vales de despensa", icon: Ticket },
      { href: "/matriz/lineas", label: "Líneas", icon: Tags },
      { href: "/matriz/categorias", label: "Categorías", icon: Tag },
    ],
  },
  {
    label: "Orden de Compra",
    icon: ShoppingCart,
    items: [{ href: "/matriz/ordenes-compra", label: "Órdenes de compra", icon: ShoppingCart }],
  },
  {
    label: "Configuraciones",
    icon: Settings,
    items: [
      { href: "/matriz/configuracion", label: "Configuración", icon: Settings },
      { href: "/matriz/usuarios", label: "Usuarios y roles", icon: UserCog },
      { href: "/matriz/bitacora", label: "Bitácora", icon: ScrollText },
    ],
  },
  {
    label: "Inventario",
    icon: Warehouse,
    items: [
      { href: "/matriz/inventario", label: "Inventario", icon: Warehouse },
      { href: "/matriz/pedidos", label: "Pedidos", icon: ClipboardList },
    ],
  },
  {
    label: "Facturación",
    icon: Receipt,
    items: [{ href: "/matriz/facturas", label: "Facturas", icon: ReceiptText }],
  },
];

const SUCURSAL_NAV: NavItem[] = [
  { href: "/sucursal", label: "Punto de venta", icon: ShoppingCart },
  { href: "/sucursal/productos", label: "Productos", icon: Package },
  { href: "/sucursal/clientes", label: "Clientes", icon: Users },
  { href: "/sucursal/ventas", label: "Historial de ventas", icon: Receipt },
  { href: "/sucursal/devoluciones", label: "Devoluciones", icon: RotateCcw },
  { href: "/sucursal/notas-de-venta", label: "Notas de venta", icon: Banknote },
  { href: "/sucursal/prestamos", label: "Préstamos", icon: ArrowLeftRight },
  { href: "/sucursal/nuevo-pedido", label: "Nuevo pedido", icon: PlusCircle },
  { href: "/sucursal/pedidos", label: "Mis pedidos", icon: ClipboardList },
  { href: "/sucursal/usuarios", label: "Usuarios", icon: Users },
  { href: "/sucursal/ajustes", label: "Ajustes", icon: Settings },
];


const STORAGE_KEY = "titos-sidebar-collapsed";

/**
 * Sin acentos y en minúsculas: en el mostrador se teclea rápido y nadie va a
 * poner la tilde de "Actualización" para llegar a esa pantalla.
 */
function normalizar(texto: string) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** ¿El texto del menú contiene lo que se escribió? Se exigen todas las palabras. */
function coincide(item: NavItem, categoria: string, consulta: string) {
  if (!consulta) return true;
  // Se busca contra la etiqueta y contra su categoría, para que "catalogos"
  // liste todo lo que cuelga de Catálogos aunque ninguna entrada se llame así.
  const heno = normalizar(`${item.label} ${categoria}`);
  return normalizar(consulta)
    .split(/\s+/)
    .filter(Boolean)
    .every((palabra) => heno.includes(palabra));
}

function isNavItemActive(pathname: string, role: string, item: NavItem) {
  if (pathname === item.href) return true;
  if (item.exact || item.href === `/${role}`) return false;
  return pathname.startsWith(item.href);
}

function initials(nombre: string) {
  return nombre
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function Sidebar({
  role,
  nombre,
  sucursalNombre,
  sucursalRol = "admin",
  permisos = [],
}: {
  role: "matriz" | "sucursal";
  nombre: string;
  sucursalNombre?: string;
  sucursalRol?: "admin" | "ventas";
  /** Permisos efectivos de la sesión; el menú solo muestra lo que se puede abrir. */
  permisos?: string[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const soloVentas = role === "sucursal" && sucursalRol === "ventas";

  // Una entrada se muestra si su ruta no exige permiso, o si la sesión lo tiene.
  const visible = useCallback(
    (href: string) => {
      const permiso = permisoDeRuta(href);
      return !permiso || tienePermiso({ permisos }, permiso);
    },
    [permisos]
  );

  const [busqueda, setBusqueda] = useState("");

  const [productosEncontrados, setProductosEncontrados] = useState<{consulta: string; items: ResultadoBusqueda[]}>({consulta: "", items: []});
  const [errorBusqueda, setErrorBusqueda] = useState("");
  const opciones = useMemo(() => opcionesBusqueda(busqueda, role, visible), [busqueda, role, visible]);
  const productos = useMemo(() => productosEncontrados.consulta === busqueda ? productosEncontrados.items : [], [productosEncontrados, busqueda]);
  useEffect(() => {
    if (busqueda.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setErrorBusqueda("");
        const res = await fetch(`/api/busqueda?q=${encodeURIComponent(busqueda)}`, {signal: controller.signal});
        if (!res.ok) throw new Error("No se pudieron buscar productos");
        const data = await res.json();
        setProductosEncontrados({consulta: busqueda, items: data.productos});
      } catch (error) {
        if (!controller.signal.aborted) setErrorBusqueda((error as Error).message);
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [busqueda]);

  const categoriasVisibles = useMemo(
    () =>
      MATRIZ_NAV.map((categoria) => ({
        ...categoria,
        items: categoria.items.filter(
          (item) => visible(item.href) && coincide(item, categoria.label, busqueda)
        ),
      })).filter((categoria) => categoria.items.length > 0),
    [visible, busqueda]
  );

  const itemsSucursalVisibles = useMemo(
    () => SUCURSAL_NAV.filter((item) => visible(item.href) && coincide(item, "", busqueda)),
    [visible, busqueda]
  );

  const buscando = busqueda.trim().length > 0;
  const buscandoProductos = busqueda.trim().length >= 2 && productosEncontrados.consulta !== busqueda && !errorBusqueda;
  const sinResultados =
    buscando && !buscandoProductos && opciones.length === 0 && productos.length === 0 && (role === "matriz" ? categoriasVisibles.length === 0 : itemsSucursalVisibles.length === 0);

  /** Primera entrada de la lista filtrada: es a la que lleva Enter. */
  const primerResultado = useMemo(() => {
    if (!buscando) return null;
    const lista =
      role === "matriz" ? categoriasVisibles.flatMap((c) => c.items) : itemsSucursalVisibles;
    return opciones[0] ?? productos[0] ?? lista[0] ?? null;
  }, [buscando, role, categoriasVisibles, itemsSucursalVisibles, opciones, productos]);
  // El rol de ventas arranca con el menú compacto para maximizar el punto de venta
  const [collapsed, setCollapsed] = useState(soloVentas);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const mouseDownOnOverlay = useRef(false);
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const category of MATRIZ_NAV) {
      initial[category.label] = category.items.some((item) => isNavItemActive(pathname, role, item));
    }
    return initial;
  });

  const roleLabel = role === "matriz" ? "Almacén Central" : "Sucursal";

  useEffect(() => {
    if (soloVentas) return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lee preferencia persistida al montar
    if (stored === "1") setCollapsed(true);
  }, [soloVentas]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- cierra el drawer móvil al navegar
    setMobileOpen(false);
    // La búsqueda es para llegar, no para quedarse: ya que se llegó, el menú
    // vuelve completo para poder moverse a otra parte.
    setBusqueda("");
  }, [pathname]);

  useEffect(() => {
    const activeCategory = MATRIZ_NAV.find((category) =>
      category.items.some((item) => isNavItemActive(pathname, role, item))
    );
    if (!activeCategory) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- abre la categoría de la ruta activa al navegar
    setOpenCategories((prev) => (prev[activeCategory.label] ? prev : { ...prev, [activeCategory.label]: true }));
  }, [pathname, role]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  function abrirPresentacion() {
    window.open("/presentacion/index.html", "presentacion-davinci", "noopener,noreferrer");
  }

  function toggleCategory(label: string) {
    setOpenCategories((prev) => ({ ...prev, [label]: !prev[label] }));
  }

  async function handleLogout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-between border-b border-black/5 bg-white px-4 py-3 md:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="rounded-lg p-2 text-titos-green-900 hover:bg-titos-green-100"
          aria-label="Abrir menú"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Image src="/media/logo.png" alt="Mercados Titos" width={512} height={184} className="h-7 w-auto" />
        <span className="w-9" />
      </div>

      {mobileOpen ? (
        <div
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onMouseDown={(e) => {
            mouseDownOnOverlay.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (mouseDownOnOverlay.current && e.target === e.currentTarget) setMobileOpen(false);
            mouseDownOnOverlay.current = false;
          }}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-black/5 bg-white transition-all duration-200 ease-in-out md:sticky md:top-0 md:z-auto md:h-screen md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "w-64 md:w-20" : "w-64"}`}
      >
        <div className={`flex items-center gap-2 border-b border-black/5 px-4 py-4 ${collapsed ? "md:justify-center md:px-0" : ""}`}>
          {collapsed ? (
            <Image
              src="/media/favicon.png"
              alt="Mercados Titos"
              width={904}
              height={904}
              className="hidden h-9 w-9 shrink-0 md:block"
            />
          ) : (
            <Image src="/media/logo.png" alt="Mercados Titos" width={512} height={184} className="h-8 w-auto md:h-9" />
          )}
          <button
            onClick={() => setMobileOpen(false)}
            className="ml-auto rounded-lg p-1.5 text-black/40 hover:bg-titos-green-100 hover:text-black/60 md:hidden"
            aria-label="Cerrar menú"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {!collapsed ? (
          <div className="px-5 pt-4 pb-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-black/35">{roleLabel}</p>
            {role === "sucursal" && sucursalNombre ? (
              <p className="truncate text-sm font-semibold text-titos-green-900">{sucursalNombre}</p>
            ) : null}
          </div>
        ) : null}

        {/* Buscador del menú: arriba de las entradas, para llegar tecleando en
            vez de recorrer categorías. Colapsado no cabe, así que no se pinta. */}
        {!collapsed ? (
          <div className="px-3 pt-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-black/30" />
              <input
                type="search"
                value={busqueda}
                onChange={(e) => {setBusqueda(e.target.value); setErrorBusqueda("");}}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setBusqueda("");
                    return;
                  }
                  // Enter va directo al primer resultado: escribir "punto" y
                  // Enter debe bastar para abrir el punto de venta.
                  if (e.key === "Enter" && primerResultado) {
                    e.preventDefault();
                    router.push(primerResultado.href);
                    setBusqueda("");
                    setMobileOpen(false);
                  }
                }}
                placeholder="Buscar opciones o productos..."
                aria-label="Buscar opciones o productos"
                className="w-full rounded-lg border border-black/10 bg-black/2 py-2 pl-8 pr-2.5 text-sm text-titos-green-900 outline-none placeholder:text-black/30 focus:border-titos-green-500 focus:bg-white"
              />
            </div>
          </div>
        ) : null}

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
          {buscando ? <div aria-live="polite">
            {[...opciones, ...productos].map((resultado) => <Link key={resultado.href} href={resultado.href}
              onClick={() => {setBusqueda(""); setMobileOpen(false);}}
              className="block rounded-lg px-3 py-2.5 text-sm text-titos-green-900 hover:bg-titos-green-100 focus-visible:outline-2 focus-visible:outline-titos-green-600">
              <span className="block text-xs text-black/60">{resultado.grupo}</span>{resultado.label}
            </Link>)}
            {buscandoProductos ? <p className="px-3 text-sm text-black/60">Buscando productos…</p> : null}
            {errorBusqueda ? <p role="status" className="px-3 text-sm text-red-700">{errorBusqueda}</p> : null}
          </div> : null}
          {sinResultados ? (
            <p className="px-3 py-6 text-center text-sm text-black/40">
              Nada coincide con &quot;{busqueda.trim()}&quot;.
            </p>
          ) : null}
          {role === "matriz" && collapsed
            ? // Colapsado en escritorio: los encabezados de categoría no caben, así
              // que se muestra una sola columna de iconos con el nombre en el tooltip.
              categoriasVisibles.flatMap((category) => category.items).map((item) => {
                const active = isNavItemActive(pathname, role, item);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={item.label}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors md:justify-center md:px-0 ${
                      active
                        ? "bg-titos-green-600 text-white shadow-sm"
                        : "text-titos-green-900/70 hover:bg-titos-green-100"
                    }`}
                  >
                    <Icon className="h-4.5 w-4.5 shrink-0" />
                    <span className="md:hidden">{item.label}</span>
                  </Link>
                );
              })
            : role === "matriz"
            ? categoriasVisibles.map((category) => {
                const CategoryIcon = category.icon;
                const hasItems = category.items.length > 0;
                // Buscando no tiene sentido esconder resultados detrás de una
                // categoría cerrada: si algo coincidió, se ve.
                const isOpen = buscando || !!openCategories[category.label];
                return (
                  <div key={category.label} className="space-y-1">
                    <button
                      type="button"
                      onClick={hasItems ? () => toggleCategory(category.label) : undefined}
                      disabled={!hasItems}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                        hasItems
                          ? "text-titos-green-900/70 hover:bg-titos-green-100"
                          : "cursor-default text-titos-green-900/30"
                      }`}
                    >
                      <CategoryIcon className="h-4.5 w-4.5 shrink-0" />
                      <span className="flex-1 text-left">{category.label}</span>
                      {hasItems ? (
                        isOpen ? (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                        )
                      ) : null}
                    </button>

                    {hasItems && isOpen ? (
                      <div className="space-y-1 pl-4">
                        {category.items.map((item) => {
                          const active = isNavItemActive(pathname, role, item);
                          const Icon = item.icon;
                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                                active
                                  ? "bg-titos-green-600 text-white shadow-sm"
                                  : "text-titos-green-900/70 hover:bg-titos-green-100"
                              }`}
                            >
                              <Icon className="h-4.5 w-4.5 shrink-0" />
                              <span>{item.label}</span>
                            </Link>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })
            : itemsSucursalVisibles.map((item) => {
                const active = isNavItemActive(pathname, role, item);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                      collapsed ? "md:justify-center md:px-0" : ""
                    } ${
                      active
                        ? "bg-titos-green-600 text-white shadow-sm"
                        : "text-titos-green-900/70 hover:bg-titos-green-100"
                    }`}
                  >
                    <Icon className="h-4.5 w-4.5 shrink-0" />
                    <span className={collapsed ? "md:hidden" : ""}>{item.label}</span>
                  </Link>
                );
              })}
        </nav>

        {/* Presentación de avances para el cliente; abre en una ventana aparte
            para no perder la pantalla en la que se está trabajando. */}
        {role === "matriz" ? (
          <button
            onClick={abrirPresentacion}
            title={collapsed ? "Presentación de avances" : undefined}
            className={`flex items-center gap-2 border-t border-black/5 bg-titos-orange-100/50 px-5 py-3 text-xs font-semibold text-titos-orange-700 transition-colors hover:bg-titos-orange-100 ${
              collapsed ? "md:justify-center md:px-0" : ""
            }`}
          >
            <Presentation className="h-4 w-4 shrink-0" />
            <span className={collapsed ? "md:hidden" : ""}>Presentación de avances</span>
          </button>
        ) : null}

        <button
          onClick={toggleCollapsed}
          title={collapsed ? "Expandir menú" : "Contraer menú"}
          className={`hidden items-center gap-2 border-t border-black/5 px-5 py-3 text-xs font-medium text-black/40 hover:bg-titos-green-100 hover:text-black/60 md:flex ${
            collapsed ? "md:justify-center md:px-0" : ""
          }`}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          <span className={collapsed ? "md:hidden" : ""}>Contraer menú</span>
        </button>

        <div className={`flex items-center gap-2.5 border-t border-black/5 p-4 ${collapsed ? "md:justify-center md:px-2" : ""}`}>
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-titos-green-100 text-xs font-bold text-titos-green-700 ${collapsed ? "md:hidden" : ""}`}>
            {initials(nombre)}
          </span>
          <div className={`min-w-0 flex-1 ${collapsed ? "md:hidden" : ""}`}>
            <p className="truncate text-sm font-semibold text-titos-green-900">{nombre}</p>
            <p className="truncate text-xs text-black/40 capitalize">{soloVentas ? "ventas" : role}</p>
          </div>
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            title="Cerrar sesión"
            className="shrink-0 rounded-lg p-2 text-black/40 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>
    </>
  );
}
