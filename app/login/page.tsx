"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { doc, getDoc } from "firebase/firestore";
import Sidebar from "@/components/ui/sidebar";
import { Toaster, toast } from "react-hot-toast";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [activePage, setActivePage] = useState("Login");

  const handleLogin = async () => {
    setError("");
    setLoading(true);

    try {
      // 1) Autentica
      const cred = await signInWithEmailAndPassword(auth, email, password);

      // 2) Perfil em /users/{uid}
      const uid = cred.user.uid;
      const snap = await getDoc(doc(db, "users", uid));

      let userData: any;
      if (snap.exists()) {
        const d = snap.data() as any;
        userData = {
          id: uid,
          uid,
          nome: d.nome ?? cred.user.email ?? "User",
          email: cred.user.email ?? "",
          roleLevel: Number(d.roleLevel ?? 6),
          pasta: d.pasta ?? "",
        };
      } else {
        // Sem perfil ainda → entra como 6 (soldado)
        userData = {
          id: uid,
          uid,
          nome: cred.user.email ?? "User",
          email: cred.user.email ?? "",
          roleLevel: 6,
        };
      }

      // 3) Salva cache local (Sidebar usa isso)
      localStorage.setItem("loggedUser", JSON.stringify(userData));

      // 4) Feedback e redireciona
      const role = Number(userData.roleLevel);
      toast.success("Login realizado!", { duration: 1500 });

      if ([1, 2, 3, 4, 5].includes(role)) {
        router.push("/admin");
      } else {
        router.push("/calculadora-farm");
      }
    } catch (err) {
      console.error(err);
      setError("Email ou senha inválidos!");
      toast.error("Email ou senha inválidos!");
    } finally {
      setLoading(false);
    }
  };

  // Enter para enviar
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !loading) handleLogin();
  };

  return (
    <div className="flex min-h-screen">
      {/* Toaster local (remova se já tiver Toaster global no layout) */}
      <Toaster position="top-center" />

      <Sidebar activePage={activePage} setActivePage={setActivePage} />

      <div className="flex-1 flex flex-col justify-center items-center p-10 relative">
        <div className="absolute top-4 right-4 text-gray-500 text-sm">v2.8.6</div>

        <div className="w-full max-w-md bg-white dark:bg-gray-800 p-8 rounded-xl shadow-md">
          <h1 className="text-3xl font-bold mb-6 text-center">Login</h1>

          {error && <p className="text-red-500 mb-4">{error}</p>}

          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={onKeyDown}
            className="w-full mb-4 p-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          />
          <input
            type="password"
            placeholder="Senha"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={onKeyDown}
            className="w-full mb-4 p-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
          />

          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-green-500 text-white py-3 rounded-lg hover:bg-green-600 transition disabled:opacity-60"
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>

          <button
            onClick={() => router.push("/dashboard")}
            className="mt-3 w-full bg-gray-300 dark:bg-gray-700 text-black dark:text-white py-3 rounded-lg hover:bg-gray-400 dark:hover:bg-gray-600 transition"
          >
            Voltar para Inicial
          </button>
        </div>
      </div>
    </div>
  );
}
