"use client";

import { useState } from "react";
import CountUp from "react-countup";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
// 🔹 agora com s minúsculo
import Sidebar from "@/components/ui/sidebar";

export default function Dashboard() {
  const [activePage, setActivePage] = useState("Inicial");

  const dataAtividades = [
    { dia: "Seg", acoes: 12 },
    { dia: "Ter", acoes: 19 },
    { dia: "Qua", acoes: 8 },
    { dia: "Qui", acoes: 15 },
    { dia: "Sex", acoes: 10 },
  ];

  return (
    <div className="flex min-h-screen font-sans bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-100 transition-colors duration-300">
      <Sidebar activePage={activePage} setActivePage={setActivePage} />

      <div className="flex-1 p-10 flex flex-col gap-6 relative">
        <span className="absolute top-4 right-4 text-gray-400 dark:text-gray-300 text-sm font-semibold">
          V1.7
        </span>

        <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 shadow-xl transition-colors duration-300 text-center">
          <h1 className="text-4xl font-bold mb-2">Bem-vindo, Kitobiten!</h1>
          <p className="text-gray-500 dark:text-gray-300 text-lg">Painel de controle da sua farm</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-md hover:scale-105 transform">
            <h2 className="text-xl font-semibold mb-2">Usuários Ativos</h2>
            <p className="text-3xl font-bold text-blue-500">
              <CountUp end={128} duration={2} separator="," />
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-md hover:scale-105 transform">
            <h2 className="text-xl font-semibold mb-2">Ações Registradas</h2>
            <p className="text-3xl font-bold text-purple-500">
              <CountUp end={74} duration={2} separator="," />
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-md hover:shadow-xl transform hover:scale-[1.02]">
          <h2 className="text-xl font-semibold mb-4">Ações por Dia</h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={dataAtividades} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <XAxis dataKey="dia" stroke="#8884d8" />
              <YAxis stroke="#8884d8" />
              <Tooltip />
              <Line type="monotone" dataKey="acoes" stroke="#4ade80" strokeWidth={3} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
