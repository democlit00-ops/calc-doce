"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { signOut, onAuthStateChanged } from "firebase/auth";
import {
  HomeIcon,
  UserIcon,
  CalculatorIcon,
  ClipboardIcon,
  ChartBarIcon,
  ArrowRightOnRectangleIcon,
  Bars3Icon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

export default function Sidebar({ activePage, setActivePage }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState(null);

  const menuItems = [
    { name: "Inicial", href: "/dashboard", icon: <HomeIcon className="w-6 h-6" /> },
    { name: "Admin", href: "/admin", icon: <UserIcon className="w-6 h-6 text-blue-500" /> },
    { name: "Ações", href: "/acoes", icon: <ClipboardIcon className="w-6 h-6 text-purple-500" /> },
    { name: "Calculadora Farm", href: "/calculadora-farm", icon: <CalculatorIcon className="w-6 h-6 text-green-500" /> },
    { name: "Registro Ações", href: "/registro-acoes", icon: <ClipboardIcon className="w-6 h-6 text-yellow-500" /> },
    { name: "Registro Farm", href: "/registro-farm", icon: <HomeIcon className="w-6 h-6 text-pink-500" /> },
    { name: "Registro Vendas", href: "/registro-vendas", icon: <ChartBarIcon className="w-6 h-6 text-red-500" /> },
    { name: "Registro Vendas Adm", href: "/registro-vendas-adm", icon: <ChartBarIcon className="w-6 h-6 text-indigo-500" /> },
  ];

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    router.push("/dashboard");
  };

  const handleClick = (item) => {
    setActivePage(item.name);
    router.push(item.href);
  };

  const renderMenu = (isMobile = false) =>
    menuItems.map((item) => {
      const isActive = activePage === item.name;
      return (
        <div
          key={item.name}
          onClick={() => {
            if (isMobile) setMobileOpen(false);
            handleClick(item);
          }}
          className={`flex items-center justify-center md:justify-start gap-3 p-3 rounded-xl cursor-pointer transition-all duration-300 hover:shadow-md hover:translate-x-1 ${
            isActive ? "bg-gray-200 dark:bg-gray-700" : ""
          }`}
        >
          <div
            className={`p-1 rounded-md transition-all duration-300 ${isActive && !expanded ? "bg-blue-500 shadow-lg" : ""}`}
          >
            {item.icon}
          </div>
          <span className={`transition-opacity duration-300 ${expanded ? "opacity-100 ml-2 font-semibold" : "opacity-0"}`}>
            {item.name}
          </span>
        </div>
      );
    });

  return (
    <>
      {/* Desktop Sidebar */}
      <div
        className="hidden md:flex flex-col justify-between transition-all duration-500 ease-in-out relative"
        style={{
          width: expanded ? "16rem" : "5rem",
          background: "#f0f0f3",
          boxShadow: "8px 0 16px rgba(0,0,0,0.05), inset -2px 0 4px rgba(255,255,255,0.7)",
          borderRadius: "1rem 0 0 1rem",
        }}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
      >
        <div className="p-6">
          {/* Top Login/Logout acima de Inicial */}
          <div className="mb-6 flex justify-center md:justify-start">
            {user ? (
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

          <nav className="space-y-3">{renderMenu()}</nav>
        </div>

        {expanded && (
          <div className="absolute bottom-10 left-0 w-full text-center text-gray-500 text-xs">
            Versão 2.4
          </div>
        )}
      </div>

      {/* Mobile Sidebar */}
      {mobileOpen && <div className="fixed inset-0 bg-black bg-opacity-30 z-30" onClick={() => setMobileOpen(false)}></div>}
      <div className="md:hidden">
        <button
          className="p-4 fixed z-50 rounded-full shadow-lg top-4 left-4 bg-white dark:bg-gray-800 transition-all duration-300"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <XMarkIcon className="w-6 h-6 text-gray-900 dark:text-gray-100" /> : <Bars3Icon className="w-6 h-6 text-gray-900 dark:text-gray-100" />}
        </button>
        <div
          className={`fixed top-0 left-0 h-full transition-transform duration-500 z-40`}
          style={{
            width: "16rem",
            background: "#f0f0f3",
            transform: mobileOpen ? "translateX(0)" : "translateX(-100%)",
            boxShadow: "8px 0 16px rgba(0,0,0,0.05), inset -2px 0 4px rgba(255,255,255,0.7)",
            borderRadius: "0 1rem 1rem 0",
          }}
        >
          <div className="p-6">
            <nav className="space-y-3">{renderMenu(true)}</nav>
          </div>
        </div>
      </div>
    </>
  );
}
