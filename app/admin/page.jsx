"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/ui/sidebar"; // s minúsculo
import { db } from "@/lib/firebase";
import { collection, getDocs, addDoc, updateDoc, doc } from "firebase/firestore";
import { PlusIcon, PencilSquareIcon } from "@heroicons/react/24/outline";

export default function AdminPage() {
  const [materiais, setMateriais] = useState([]);
  const [nome, setNome] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [activePage, setActivePage] = useState("Admin");

  // Carrega materiais
  useEffect(() => {
    const fetchMateriais = async () => {
      const querySnapshot = await getDocs(collection(db, "materiais"));
      setMateriais(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    };
    fetchMateriais();
  }, []);

  // Adiciona novo material
  const handleAddMaterial = async () => {
    if (!nome || !quantidade) return;
    await addDoc(collection(db, "materiais"), {
      nome,
      quantidade: parseInt(quantidade),
    });
    setNome("");
    setQuantidade("");
    // recarrega lista
    const querySnapshot = await getDocs(collection(db, "materiais"));
    setMateriais(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  };

  // Atualiza material existente
  const handleUpdateMaterial = async (id, newQuantidade) => {
    const docRef = doc(db, "materiais", id);
    await updateDoc(docRef, { quantidade: parseInt(newQuantidade) });
    // recarrega lista
    const querySnapshot = await getDocs(collection(db, "materiais"));
    setMateriais(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  };

  return (
    <div className="flex min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      {/* Sidebar */}
      <Sidebar activePage={activePage} setActivePage={setActivePage} />

      {/* Conteúdo Principal */}
      <div className="flex-1 p-10 relative">
        {/* Versão no canto direito */}
        <span className="absolute top-4 right-4 text-gray-400 dark:text-gray-300 text-sm font-semibold">
          V1.6
        </span>

        <h1 className="text-3xl font-bold mb-6">Administração de Materiais</h1>

        <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-md transition-colors duration-300">
          <h2 className="text-xl font-semibold mb-4">Adicionar Material</h2>
          <div className="flex gap-4 mb-4">
            <input
              type="text"
              placeholder="Nome"
              value={nome}
              onChange={e => setNome(e.target.value)}
              className="flex-1 p-2 border rounded-lg dark:bg-gray-700"
            />
            <input
              type="number"
              placeholder="Quantidade"
              value={quantidade}
              onChange={e => setQuantidade(e.target.value)}
              className="w-32 p-2 border rounded-lg dark:bg-gray-700"
            />
            <button
              onClick={handleAddMaterial}
              className="flex items-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600"
            >
              <PlusIcon className="w-5 h-5" />
              Adicionar
            </button>
          </div>
        </div>

        <div className="mt-6 bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-md transition-colors duration-300">
          <h2 className="text-xl font-semibold mb-4">Materiais Cadastrados</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border-b p-2 text-left">Nome</th>
                <th className="border-b p-2 text-left">Quantidade</th>
                <th className="border-b p-2 text-left">Ação</th>
              </tr>
            </thead>
            <tbody>
              {materiais.map(m => (
                <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="p-2">{m.nome}</td>
                  <td className="p-2">{m.quantidade}</td>
                  <td className="p-2">
                    <button
                      onClick={() => {
                        const newQuantidade = prompt("Nova quantidade:", m.quantidade);
                        if (newQuantidade !== null) handleUpdateMaterial(m.id, newQuantidade);
                      }}
                      className="flex items-center gap-2 px-3 py-1 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                    >
                      <PencilSquareIcon className="w-5 h-5" />
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
