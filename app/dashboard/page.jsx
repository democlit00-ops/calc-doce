"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import Sidebar from "@/components/ui/sidebar";

export default function Dashboard() {
  const [activePage, setActivePage] = useState("Inicial");

  return (
    <div className="flex min-h-screen font-sans bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <Sidebar activePage={activePage} setActivePage={setActivePage} />

      <main className="flex-1 p-4 md:p-6 relative">
        <span className="absolute top-3 right-3 text-gray-400 dark:text-gray-300 text-xs font-semibold">
          V1.6
        </span>

        <section className="mx-auto max-w-3xl bg-white dark:bg-gray-800 rounded-2xl p-5 md:p-6 shadow-xl border border-gray-200/60 dark:border-gray-700/40">
          <div className="flex flex-col items-center text-center gap-4">
            {/* LOGO — mais compacta */}
            <div className="relative w-28 h-28 md:w-36 md:h-36">
              <Image
                src="/logo-fac.png"
                alt="Logo TROPA DO CARECA"
                fill
                priority
                className="object-contain drop-shadow-[0_0_18px_rgba(132,255,0,0.28)]"
              />
            </div>

            {/* Título menor */}
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
              Painel TROPA DO CARECA
            </h1>

            {/* Texto mais enxuto */}
            <div className="space-y-2 text-gray-700 dark:text-gray-300 text-base leading-relaxed">
              <p>Sejam bem-vindos ao painel da Tropa do Careca.</p>
              <p>
                Aqui você pode <b>calcular seu farm</b>, <b>ver suas ações</b> e{" "}
                <b>registrar o seu baú</b>. Tudo vai para <b>sua pasta</b> criada no Discord.
              </p>
              <p>
                Sem acesso? <b>Solicite aos líderes</b> no nosso servidor:
              </p>
            </div>

            {/* Botão do Discord — compacto */}
            <a
              href="https://discord.gg/XJaq7v5AES"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2 px-4 py-2 rounded-lg font-semibold
                         bg-[#111] text-white border border-lime-400/60
                         shadow-[0_0_16px_rgba(163,255,0,0.28)]
                         hover:shadow-[0_0_26px_rgba(163,255,0,0.48)]
                         transition"
              aria-label="Entrar no Discord"
            >
              <MessageCircle className="w-4 h-4" />
              Entrar no Discord
            </a>
            <p className="text-xs text-gray-500 dark:text-gray-400 -mt-1">
              Ou abra: <span className="underline">https://discord.gg/XJaq7v5AES</span>
            </p>

            {/* Login — visível sem rolagem */}
            <div className="mt-1">
              <Link
                href="/login"
                className="px-5 py-2 rounded-lg bg-black text-white hover:opacity-90 transition shadow-md text-sm md:text-base"
              >
                Login
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
