'use client';

import Link from "next/link";
import { useState, useEffect } from "react";
import type { ComponentType, SVGProps } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { signOut, onAuthStateChanged, User } from "firebase/auth";
import {
  HomeIcon,
  UserIcon,
  CalculatorIcon,
  ClipboardIcon,
  ChartBarIcon,
  ArrowRightOnRectangleIcon,
  Bars3Icon,
  XMarkIcon,
  ArchiveBoxIcon,
  CheckCircleIcon, // opcional
} from "@heroicons/react/24/outline";

type LoggedUserLocal = {
  id: string;
  uid: string;
  nome: string;
  email: string;
  discord?: string;
  passaport?: string;
  roleLevel: number;
  pasta?: string;
};

type MenuItem = {
  name: string;
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  accentGrad: string;
  activeRing: string;
  activeBorder: string;
};

export default function Sidebar({
  activePage,
  setActivePage,
}: {
  activePage: string;
  setActivePage: (page: string) => void;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);      // desktop hover
  const [mobileOpen, setMobileOpen] = useState(false);  // mobile drawer
  const [user, setUser] = useState<User | null>(null);
  const [roleLevel, setRoleLevel] = useState<number | null>(null);
  const [authReady, setAuthReady] = useState(false);    // evita "flash" de Logout

  // ===== Regras de acesso =====
  const PAGE_ACCESS: Record<string, number[]> = {
    Dashboard:          [1,2,3,4,5,6,7,8],
    Inicial:            [1,2,3,4,5,6,7,8],

    Admin:              [1,2,3,4,5,6,7,8,9],
    "Registro Bau":     [1,2,3,4,5,6,7,8,9],
    "Calculadora Farm": [1,2,3,4,5,6,7,8,9],
    "Registro Farm":    [1,2,3,5],
    "Ações":            [1,2,3,4,5,6,7,8,9],
    "Registro Ações":   [1,2,3,4],
    "Registro Vendas":  [1,2,3,6],
    Estoque:            [1,2,3,5,6],
    Caixa:              [1,2],
    PLR:                [1,2,3,4,5,6,7,8],
    Meta:               [1,2,3,4,5,6,7,8,9],
  };

  const canView = (label: string, role: number | null): boolean => {
    if (role == null) return label === "Dashboard" || label === "Inicial";
    const allowed = PAGE_ACCESS[label];
    return Array.isArray(allowed) && allowed.includes(role);
  };

  const menuItems: MenuItem[] = [
    { name: "Dashboard",        href: "/dashboard",        icon: HomeIcon,       accentGrad: "from-slate-700 to-slate-500",   activeRing: "ring-slate-300",   activeBorder: "border-slate-400" },
    { name: "Admin",            href: "/admin",            icon: UserIcon,       accentGrad: "from-blue-700 to-sky-500",      activeRing: "ring-sky-300",     activeBorder: "border-sky-400" },
    { name: "Registro Bau",     href: "/registro-bau",     icon: ArchiveBoxIcon, accentGrad: "from-emerald-700 to-teal-500",   activeRing: "ring-emerald-300", activeBorder: "border-emerald-400" },
    { name: "Calculadora Farm", href: "/calculadora-farm", icon: CalculatorIcon, accentGrad: "from-lime-700 to-green-500",    activeRing: "ring-lime-300",    activeBorder: "border-lime-400" },
    { name: "Registro Farm",    href: "/registro-farm",    icon: HomeIcon,       accentGrad: "from-rose-700 to-pink-500",      activeRing: "ring-rose-300",    activeBorder: "border-rose-400" },
    { name: "Ações",            href: "/acoes",            icon: ClipboardIcon,  accentGrad: "from-violet-700 to-purple-500",  activeRing: "ring-violet-300",  activeBorder: "border-violet-400" },
    { name: "Registro Ações",   href: "/registro-acoes",   icon: ClipboardIcon,  accentGrad: "from-amber-700 to-yellow-500",   activeRing: "ring-amber-300",   activeBorder: "border-amber-400" },
    { name: "Registro Vendas",  href: "/registro-vendas",  icon: ChartBarIcon,   accentGrad: "from-orange-700 to-red-500",     activeRing: "ring-orange-300",  activeBorder: "border-orange-400" },
    { name: "Estoque",          href: "/estoque",          icon: ChartBarIcon,   accentGrad: "from-indigo-700 to-cyan-500",    activeRing: "ring-cyan-300",    activeBorder: "border-cyan-400" },
    { name: "Caixa",            href: "/caixa",            icon: ChartBarIcon,   accentGrad: "from-green-700 to-emerald-500",  activeRing: "ring-emerald-300", activeBorder: "border-emerald-400" },
    { name: "PLR",              href: "/plr",              icon: ClipboardIcon,  accentGrad: "from-fuchsia-700 to-pink-500",   activeRing: "ring-fuchsia-300", activeBorder: "border-fuchsia-400" },
    { name: "Meta",             href: "/meta",             icon: ClipboardIcon,  accentGrad: "from-teal-700 to-cyan-500",      activeRing: "ring-teal-300",    activeBorder: "border-teal-400" },
  ];

  // Auth state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        try { localStorage.removeItem("loggedUser"); } catch {}
        setRoleLevel(null);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // Lê role do cache local
  useEffect(() => {
    try {
      const saved = localStorage.getItem("loggedUser");
      if (saved) {
        const parsed: LoggedUserLocal = JSON.parse(saved);
        setRoleLevel(Number(parsed.roleLevel));
      } else {
        setRoleLevel(null);
      }
    } catch {
      setRoleLevel(null);
    }
  }, [user]);

  const handleLogout = async () => {
    try { localStorage.removeItem("loggedUser"); } catch {}
    await signOut(auth);
    setRoleLevel(null);
    router.push("/dashboard");
  };

  const MenuRow = ({
    item,
    isActive,
    isMobile,
    collapsed,
  }: {
    item: MenuItem;
    isActive: boolean;
    isMobile: boolean;
    collapsed: boolean;
  }) => {
    const Icon = item.icon;

    const rowBase =
      "group flex items-center rounded-xl cursor-pointer transition-all duration-300";
    const rowPadding = collapsed ? "p-1.5" : (isMobile ? "p-2.5" : "p-3");
    const rowJustify  = collapsed ? "justify-center" : "justify-start";
    const rowGap = collapsed ? "gap-0" : (isMobile ? "gap-2" : "gap-3");
    const rowHover = collapsed ? "hover:translate-x-0" : "hover:translate-x-1";
    const rowActive = isActive
      ? (collapsed
          ? "bg-transparent"
          : `bg-white/80 dark:bg-gray-700/70 border-l-4 ${item.activeBorder} ring-1 ${item.activeRing}`)
      : "bg-transparent";

    const iconBoxSize = collapsed ? "w-7 h-7" : (isMobile ? "w-8 h-8" : "w-9 h-9");

    return (
      <Link
        href={item.href}
        onClick={() => {
          setActivePage(item.name);
          if (isMobile) setMobileOpen(false);
        }}
        className={[rowBase, rowPadding, rowJustify, rowGap, rowHover, rowActive].join(" ")}
      >
        <div
          className={[
            "relative flex items-center justify-center rounded-lg text-white",
            "bg-gradient-to-tr shadow-sm",
            iconBoxSize,
            item.accentGrad,
            "ring-1 ring-white/20",
          ].join(" ")}
        >
          <Icon className="w-5 h-5 drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]" />
          <span className="pointer-events-none absolute inset-0 rounded-lg opacity-0 group-hover:opacity-20 transition-opacity bg-white" />
        </div>

        {!collapsed && (
          <span className={isMobile ? "ml-0.5 font-medium" : "ml-2 font-semibold"}>
            {item.name}
          </span>
        )}
      </Link>
    );
  };

  const renderMenu = (isMobile = false) =>
    menuItems
      .filter((it) => canView(it.name, roleLevel))
      .map((it) => {
        const isActive =
          activePage === it.name ||
          (it.name === "Dashboard" && activePage === "Inicial");
        const collapsed = !isMobile && !expanded;
        return (
          <MenuRow
            key={it.name}
            item={it}
            isActive={isActive}
            isMobile={isMobile}
            collapsed={collapsed}
          />
        );
      });

  return (
    <>
      {/* Desktop Sidebar */}
      <div
        className="hidden md:flex flex-col justify-between transition-all duration-500 ease-in-out relative overflow-hidden"
        style={{
          width: expanded ? "16rem" : "4.25rem",
          background: "#f5f7fb",
          boxShadow: "8px 0 16px rgba(0,0,0,0.05), inset -2px 0 4px rgba(255,255,255,0.7)",
          borderRadius: "1rem 0 0 1rem",
        }}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
      >
        <div className="p-6">
          {/* Top Login/Logout */}
          <div className="mb-6 flex justify-center md:justify-start">
            {!authReady ? (
              <Link href="/login">
                <button className="flex items-center justify-center p-2 rounded-md bg-green-500 text-white hover:bg-green-600 transition">
                  <ArrowRightOnRectangleIcon className="w-5 h-5" />
                  {expanded && <span className="ml-2 text-sm font-medium">Login</span>}
                </button>
              </Link>
            ) : user ? (
              <button
                onClick={handleLogout}
                className="flex items-center justify-center p-2 rounded-md bg-red-500 text-white hover:bg-red-600 transition"
              >
                <ArrowRightOnRectangleIcon className="w-5 h-5" />
                {expanded && <span className="ml-2 text-sm font-medium">Logout</span>}
              </button>
            ) : (
              <Link href="/login">
                <button className="flex items-center justify-center p-2 rounded-md bg-green-500 text-white hover:bg-green-600 transition">
                  <ArrowRightOnRectangleIcon className="w-5 h-5" />
                  {expanded && <span className="ml-2 text-sm font-medium">Login</span>}
                </button>
              </Link>
            )}
          </div>

          <nav className="space-y-2">{renderMenu(false)}</nav>
        </div>

        {/* 🔥 Removido o bloco de versão do rodapé do sidebar */}
      </div>

      {/* Mobile Sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/40 z-30" onClick={() => setMobileOpen(false)} />
      )}
      <div className="md:hidden">
        <button
          className="p-4 fixed z-50 rounded-full shadow-lg top-4 left-4 bg-white dark:bg-gray-800 transition-all duration-300"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Abrir menu"
        >
          {mobileOpen ? (
            <XMarkIcon className="w-6 h-6 text-gray-900 dark:text-gray-100" />
          ) : (
            <Bars3Icon className="w-6 h-6 text-gray-900 dark:text-gray-100" />
          )}
        </button>

        <div
          className="fixed top-0 left-0 h-full transition-transform duration-500 z-40"
          style={{
            width: "16rem",
            background: "#f5f7fb",
            transform: mobileOpen ? "translateX(0)" : "translateX(-100%)",
            boxShadow: "8px 0 16px rgba(0,0,0,0.05), inset -2px 0 4px rgba(255,255,255,0.7)",
            borderRadius: "0 1rem 1rem 0",
          }}
        >
          <div className="p-6 flex flex-col gap-3 h-full">
            {/* Login/Logout em mobile */}
            <div className="flex justify-start">
              {!authReady ? (
                <Link href="/login" onClick={() => setMobileOpen(false)}>
                  <div className="flex items-center gap-2 p-2 rounded-md bg-green-500 text-white hover:bg-green-600 transition w-full justify-center">
                    <ArrowRightOnRectangleIcon className="w-5 h-5" />
                    <span className="text-sm font-medium">Login</span>
                  </div>
                </Link>
              ) : user ? (
                <button
                  onClick={() => { handleLogout(); setMobileOpen(false); }}
                  className="flex items-center gap-2 p-2 rounded-md bg-red-500 text-white hover:bg-red-600 transition w-full justify-center"
                >
                  <ArrowRightOnRectangleIcon className="w-5 h-5" />
                  <span className="text-sm font-medium">Logout</span>
                </button>
              ) : (
                <Link href="/login" onClick={() => setMobileOpen(false)}>
                  <div className="flex items-center gap-2 p-2 rounded-md bg-green-500 text-white hover:bg-green-600 transition w-full justify-center">
                    <ArrowRightOnRectangleIcon className="w-5 h-5" />
                    <span className="text-sm font-medium">Login</span>
                  </div>
                </Link>
              )}
            </div>

            <nav className="space-y-1 overflow-auto pr-1">
              {menuItems
                .filter((it) => canView(it.name, roleLevel))
                .map((it) => {
                  const isActive =
                    activePage === it.name ||
                    (it.name === "Dashboard" && activePage === "Inicial");
                  return (
                    <MenuRow
                      key={it.name}
                      item={it}
                      isActive={isActive}
                      isMobile
                      collapsed={false}
                    />
                  );
                })}
            </nav>
          </div>
        </div>
      </div>
    </>
  );
}
