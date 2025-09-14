"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import Sidebar from "@/components/ui/sidebar"; // use a versão atualizada do sidebar

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [activePage, setActivePage] = useState("Login");

  const handleLogin = async () => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.push("/dashboard"); // redireciona após login
    } catch (err) {
      setError("Email ou senha inválidos!");
    }
  };

  return (
    <div className="flex min-h-screen">
      <Sidebar activePage={activePage} setActivePage={setActivePage} />

      <div className="flex-1 flex flex-col justify-center items-center p-10 relative">
        <div className="absolute top-4 right-4 text-gray-500 text-sm">v1.3</div>

        <div className="w-full max-w-md bg-white dark:bg-gray-800 p-8 rounded-xl shadow-md">
          <h1 className="text-3xl font-bold mb-6 text-center">Login</h1>

          {error && <p className="text-red-500 mb-4">{error}</p>}

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full mb-4 p-3 rounded-lg border border-gray-300"
          />
          <input
            type="password"
            placeholder="Senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full mb-4 p-3 rounded-lg border border-gray-300"
          />

          <button
            onClick={handleLogin}
            className="w-full bg-green-500 text-white py-3 rounded-lg hover:bg-green-600 transition"
          >
            Entrar
          </button>

          <button
            onClick={() => router.push("/dashboard")}
            className="mt-3 w-full bg-gray-300 dark:bg-gray-700 text-black py-3 rounded-lg hover:bg-gray-400 transition"
          >
            Voltar para Inicial
          </button>
        </div>
      </div>
    </div>
  );
}
