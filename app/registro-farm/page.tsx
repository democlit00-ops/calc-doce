'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Sidebar from '@/components/ui/sidebar';
import {
  auth,
  db,
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
} from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import {
  PlusIcon,
  PencilSquareIcon,
  CheckCircleIcon,
  StarIcon,
  PhotoIcon,
  ArrowUpOnSquareIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

/* =========================
   Tipos & helpers
========================= */
type Hierarquia = '1'|'2'|'3'|'4'|'5'|'6';

const HIERARCHY_LABELS: Record<Hierarquia, string> = {
  '1': 'Admin Geral',
  '2': 'Admin',
  '3': 'Usuário',
  '4': 'Gerente de Farm',
  '5': 'Supervisor',
  '6': 'Convidado',
};

interface IngredienteItem {
  nome: string;
  quantidade: number;
  peso: number;
  imagemUrl?: string;
}

interface ProdutoFarm {
  id?: string;
  nome: string;
  peso: number;        // peso do produto (base)
  quantidade: number;  // quantidade base (passo)
  valor: number;
  ativo: boolean;
  imagemUrl?: string;  // URL pública
  ingredientes: IngredienteItem[];
}

const emptyProduto = (): ProdutoFarm => ({
  nome: '',
  peso: 0,
  quantidade: 50,
  valor: 0,
  ativo: false,
  imagemUrl: '',
  ingredientes: [
    { nome: '', quantidade: 0, peso: 0, imagemUrl: '' },
  ],
});

/** Normaliza qualquer formato de role/hierarquia vindo do Firestore. */
function normalizeRole(input: unknown): Hierarquia {
  if (typeof input === 'number') {
    const s = String(input) as Hierarquia;
    if (['1','2','3','4','5','6'].includes(s)) return s;
  }
  if (typeof input === 'string') {
    const t = input.trim().toLowerCase();
    if (['1','2','3','4','5','6'].includes(t)) return t as Hierarquia;
    if (['admin geral','admingeral','owner','root'].includes(t)) return '1';
    if (['admin','administrador'].includes(t)) return '2';
    if (['gerente','gerente de farm','manager'].includes(t)) return '4';
    if (['supervisor'].includes(t)) return '5';
    if (['guest','convidado'].includes(t)) return '6';
    if (['usuario','usuário','user'].includes(t)) return '3';
  }
  return '3';
}

/* ========= helpers de formatação ========= */
const fmtMoney0 = (n: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n) || 0);
const fmtNum = (n: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(n) || 0);
/* ======================================== */

/* =========================
   Toasts simples (inline)
========================= */
type ToastType = 'success' | 'error' | 'info';
interface ToastState { open: boolean; type: ToastType; msg: string; }
const useToast = () => {
  const [toast, setToast] = useState<ToastState>({ open: false, type: 'info', msg: '' });
  const show = (msg: string, type: ToastType = 'info') => {
    setToast({ open: true, type, msg });
    setTimeout(() => setToast(prev => ({ ...prev, open: false })), 2500);
  };
  return { toast, show, close: () => setToast(prev => ({ ...prev, open: false })) };
};

/* =========================
   Modal de confirmação
========================= */
const ConfirmModal: React.FC<{
  open: boolean;
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ open, title = 'Confirmar', message, confirmText = 'Confirmar', cancelText = 'Cancelar', onConfirm, onCancel }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-[95%] max-w-md p-5">
        <div className="flex items-center gap-3 mb-3">
          <ExclamationTriangleIcon className="w-6 h-6 text-amber-500" />
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onCancel} className="ml-auto p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
        {message && <p className="text-sm text-gray-600 dark:text-gray-300">{message}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-2 rounded border hover:bg-gray-50 dark:hover:bg-gray-700">{cancelText}</button>
          <button onClick={onConfirm} className="px-3 py-2 rounded bg-red-600 text-white hover:bg-red-700">{confirmText}</button>
        </div>
      </div>
    </div>
  );
};

export default function RegistroFarmPage() {
  const [activePage, setActivePage] = useState('Registro Farm');
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [hierarquia, setHierarquia] = useState<Hierarquia>('3');
  const [autorizado, setAutorizado] = useState(false);

  const [produtos, setProdutos] = useState<ProdutoFarm[]>([]);
  const [form, setForm] = useState<ProdutoFarm>(emptyProduto());
  const [editId, setEditId] = useState<string | null>(null);

  // uploads (Vercel Blob via /api/upload)
  const [uploadingProduto, setUploadingProduto] = useState(false);
  const [uploadingIngIdx, setUploadingIngIdx] = useState<number | null>(null);

  // exclusão (modal)
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<ProdutoFarm | null>(null);
  const [deletandoId, setDeletandoId] = useState<string | null>(null);

  const router = useRouter();
  const { toast, show } = useToast();

  // --- Auth + Hierarquia guard ---
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push('/login');
        return;
      }
      try {
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        const data = userSnap.exists() ? (userSnap.data() as any) : {};
        const raw = data.roleLevel ?? data.hierarquia ?? data.role ?? '3';
        const norm = normalizeRole(raw);
        setHierarquia(norm);
        setAutorizado(['1','2','4'].includes(norm));
      } catch {
        setHierarquia('3');
        setAutorizado(false);
      } finally {
        setLoadingAuth(false);
      }
    });
    return () => unsub();
  }, [router]);

  // --- Fetch produtos ---
  const fetchProdutos = async () => {
    const snap = await getDocs(collection(db, 'produtosFarm'));
    const list: ProdutoFarm[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ProdutoFarm[];
    list.sort((a,b) => (b.ativo?1:0) - (a.ativo?1:0)); // ativos primeiro
    setProdutos(list);
  };

  useEffect(() => {
    if (autorizado) fetchProdutos();
  }, [autorizado]);

  const handleNew = () => {
    setForm(emptyProduto());
    setEditId(null);
  };

  const handleSelectToEdit = (p: ProdutoFarm) => {
    setForm({ ...p, ingredientes: p.ingredientes?.length ? p.ingredientes : emptyProduto().ingredientes });
    setEditId(p.id ?? null);
  };

  // --- upload via Vercel Blob (API local /api/upload) ---
  const pickAndUpload = (tipo: 'produto'|'ingrediente', idx?: number) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        if (tipo === 'produto') setUploadingProduto(true);
        if (tipo === 'ingrediente' && typeof idx === 'number') setUploadingIngIdx(idx);

        const formData = new FormData();
        formData.append('file', file);

        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        if (!res.ok) {
          const t = await res.text();
          throw new Error(`Falha no upload: ${t}`);
        }
        const data = await res.json(); // { url: 'https://...' }

        if (tipo === 'produto') {
          setForm(prev => ({ ...prev, imagemUrl: data.url }));
        } else if (typeof idx === 'number') {
          const arr = [...form.ingredientes];
          arr[idx].imagemUrl = data.url;
          setForm(prev => ({ ...prev, ingredientes: arr }));
        }

        show('Imagem enviada!', 'success');
      } catch (e) {
        console.error(e);
        show('Falha ao enviar imagem.', 'error');
      } finally {
        setUploadingProduto(false);
        setUploadingIngIdx(null);
      }
    };
    input.click();
  };

  const removerImagemProduto = () => {
    setForm(prev => ({ ...prev, imagemUrl: '' }));
  };
  const removerImagemIngrediente = (idx: number) => {
    const arr = [...form.ingredientes];
    arr[idx].imagemUrl = '';
    setForm(prev => ({ ...prev, ingredientes: arr }));
  };

  // --- salvar / atualizar ---
  const salvar = async () => {
    if (!form.nome.trim()) return show('Informe o nome do produto.', 'error');
    if (form.quantidade <= 0) return show('Quantidade base deve ser > 0.', 'error');

    try {
      if (editId) {
        await updateDoc(doc(db, 'produtosFarm', editId), form as any);
        show('Produto atualizado!', 'success');
      } else {
        const refDoc = await addDoc(collection(db, 'produtosFarm'), form as any);
        setEditId(refDoc.id);
        show('Produto criado!', 'success');
      }
      await fetchProdutos();
    } catch (e) {
      console.error(e);
      show('Erro ao salvar produto.', 'error');
    }
  };

  // --- definir ativo ---
  const definirAtivo = async (id: string) => {
    try {
      const snap = await getDocs(collection(db, 'produtosFarm'));
      await Promise.all(snap.docs.map(d => updateDoc(d.ref, { ativo: d.id === id })));
      await fetchProdutos();
      show('Produto definido como ativo!', 'success');
    } catch (e) {
      console.error(e);
      show('Erro ao definir ativo.', 'error');
    }
  };

  // --- excluir produto + deletar imagens ---
  const excluirProduto = async (p: ProdutoFarm) => {
    setConfirmOpen(false);
    if (!p.id) return;

    try {
      setDeletandoId(p.id);

      const urls: string[] = [];
      if (p.imagemUrl) urls.push(p.imagemUrl);
      if (p.ingredientes?.length) {
        p.ingredientes.forEach(i => { if (i.imagemUrl) urls.push(i.imagemUrl); });
      }

      if (urls.length > 0) {
        const res = await fetch('/api/blob-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls }),
        });
        if (!res.ok) {
          console.warn('Falha ao deletar blobs (seguindo com a remoção do doc).', await res.text());
        }
      }

      await deleteDoc(doc(db, 'produtosFarm', p.id));

      if (editId === p.id) {
        handleNew();
      }

      await fetchProdutos();
      show('Produto excluído!', 'success');
    } catch (e) {
      console.error(e);
      show('Erro ao excluir produto.', 'error');
    } finally {
      setDeletandoId(null);
      setProductToDelete(null);
    }
  };

  const permitido = useMemo(() => ['1','2','4'].includes(hierarquia), [hierarquia]);

  if (loadingAuth) {
    return (
      <div className="flex min-h-screen">
        <Sidebar activePage={activePage} setActivePage={setActivePage} />
        <main className="flex-1 flex items-center justify-center text-gray-500">
          Carregando...
        </main>
      </div>
    );
  }

  if (!permitido) {
    return (
      <div className="flex min-h-screen bg-gray-100 dark:bg-gray-900">
        <Sidebar activePage={activePage} setActivePage={setActivePage} />
        <main className="flex-1 flex items-center justify-center p-6">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow max-w-md w-full text-center">
            <h2 className="text-xl font-semibold mb-2">Acesso restrito</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Apenas <strong>{HIERARCHY_LABELS['1']}</strong>, <strong>{HIERARCHY_LABELS['2']}</strong> e <strong>{HIERARCHY_LABELS['4']}</strong> podem acessar o Registro de Farm.
            </p>
            <div className="mt-3 text-xs text-gray-500">
              Seu nível atual: <strong>{HIERARCHY_LABELS[hierarquia]}</strong> ({hierarquia})
            </div>
            <a
              href="/calculadora-farm"
              className="inline-block mt-4 px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 transition"
            >
              Voltar para Calculadora
            </a>
          </div>
        </main>
      </div>
    );
  }

  const pesoTotalIngBase = form.ingredientes.reduce((acc, i) => acc + (Number(i.peso) || 0), 0);

  return (
    <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <Sidebar activePage={activePage} setActivePage={setActivePage} />

      <main className="flex-1 p-6">
        {/* Cabeçalho com faixa fixa (azul) */}
        <div className="rounded-2xl overflow-hidden shadow mb-6">
          <div className="h-2 bg-blue-500/40" />
          <div className="bg-white dark:bg-gray-800 p-4 flex items-center justify-between">
            <h1 className="text-2xl md:text-3xl font-bold">Registro de Farm</h1>
            <a
              href="/calculadora-farm"
              className="px-3 py-2 rounded-lg bg-gray-900 text-white hover:brightness-110 transition"
            >
              Ir para Calculadora
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[340px,1fr] gap-6">
          {/* LISTA DE PRODUTOS */}
          <aside className="bg-white/60 dark:bg-gray-800/60 backdrop-blur rounded-xl shadow border border-white/40 dark:border-white/10 p-4 h-fit">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Produtos</h2>
              <button
                onClick={handleNew}
                className="flex items-center gap-1 px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700 transition"
              >
                <PlusIcon className="w-5 h-5" />
                Novo
              </button>
            </div>

            <div className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
              {produtos.map(p => (
                <div
                  key={p.id}
                  className={`p-3 rounded-lg border flex items-center gap-3 hover:shadow transition ${
                    p.ativo ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700'
                  }`}
                >
                  {p.imagemUrl
                    ? <img src={p.imagemUrl} className="w-10 h-10 rounded object-cover" />
                    : <div className="w-10 h-10 rounded bg-gray-200 dark:bg-gray-700 grid place-items-center"><PhotoIcon className="w-6 h-6 text-gray-500" /></div>
                  }

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">{p.nome || 'Sem nome'}</p>
                      {p.ativo && <StarIcon className="w-4 h-4 text-yellow-500" title="Ativo" />}
                    </div>
                    <p className="text-xs text-gray-500">
                      Base {fmtNum(p.quantidade)} • R$ {fmtMoney0(p.valor)} • {fmtNum(p.peso)} kg
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSelectToEdit(p)}
                      className="px-2 py-1 rounded border text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
                      title="Editar"
                    >
                      <PencilSquareIcon className="w-5 h-5" />
                    </button>

                    {!p.ativo && (
                      <button
                        onClick={() => definirAtivo(p.id!)}
                        className="px-2 py-1 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
                        title="Definir como ativo"
                      >
                        <CheckCircleIcon className="w-5 h-5" />
                      </button>
                    )}

                    <button
                      onClick={() => { setProductToDelete(p); setConfirmOpen(true); }}
                      disabled={deletandoId === p.id}
                      className="px-2 py-1 rounded bg-red-600 text-white text-sm hover:bg-red-700 disabled:opacity-60"
                      title="Excluir produto"
                    >
                      <TrashIcon className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              ))}

              {produtos.length === 0 && (
                <p className="text-sm text-gray-500">Nenhum produto cadastrado.</p>
              )}
            </div>
          </aside>

          {/* FORMULÁRIO */}
          <section className="bg-white/60 dark:bg-gray-800/60 backdrop-blur rounded-xl shadow border border-white/40 dark:border-white/10 p-5">
            <h2 className="text-lg font-semibold mb-4">
              {editId ? 'Editar Produto' : 'Novo Produto'}
            </h2>

            {/* imagem do produto + botões */}
            <div className="mb-4 flex items-center gap-4">
              {form.imagemUrl
                ? <img src={form.imagemUrl} alt="Produto" className="w-20 h-20 rounded object-cover border" />
                : <div className="w-20 h-20 rounded bg-gray-200 dark:bg-gray-700 grid place-items-center">
                    <PhotoIcon className="w-8 h-8 text-gray-500" />
                  </div>
              }

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => pickAndUpload('produto')}
                  disabled={uploadingProduto}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60 transition-transform active:scale-[0.98]"
                >
                  <ArrowUpOnSquareIcon className="w-5 h-5" />
                  {uploadingProduto ? 'Enviando...' : 'Enviar imagem do produto'}
                </button>

                {form.imagemUrl && (
                  <button
                    onClick={removerImagemProduto}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded border hover:bg-gray-50 dark:hover:bg-gray-700 transition-transform active:scale-[0.98]"
                  >
                    <TrashIcon className="w-5 h-5" />
                    Remover
                  </button>
                )}
              </div>
            </div>

            {/* preview admin */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border">
                <p className="text-xs text-gray-500">Quantidade base</p>
                <p className="text-lg font-semibold">{fmtNum(form.quantidade)}</p>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border">
                <p className="text-xs text-gray-500">Peso Produto (base)</p>
                <p className="text-lg font-semibold">{fmtNum(form.peso)} kg</p>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-900/40 border">
                <p className="text-xs text-gray-500">Peso Total Ingredientes (base)</p>
                <p className="text-lg font-semibold">
                  {fmtNum(pesoTotalIngBase)} kg
                </p>
              </div>
            </div>

            {/* dados do produto */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
              <div className="md:col-span-2">
                <label className="text-sm text-gray-600">Nome do produto</label>
                <input
                  type="text"
                  className="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.nome}
                  onChange={e => setForm(prev => ({ ...prev, nome: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600">Quantidade base (passo)</label>
                <input
                  type="number"
                  className="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.quantidade}
                  onChange={e => setForm(prev => ({ ...prev, quantidade: Number(e.target.value) }))}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600">Peso do produto (kg)</label>
                <input
                  type="number"
                  className="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.peso}
                  onChange={e => setForm(prev => ({ ...prev, peso: Number(e.target.value) }))}
                />
              </div>
              <div>
                <label className="text-sm text-gray-600">Valor (R$)</label>
                <input
                  type="number"
                  className="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={form.valor}
                  onChange={e => setForm(prev => ({ ...prev, valor: Number(e.target.value) }))}
                />
              </div>
            </div>

            {/* ingredientes */}
            <div className="mb-3">
              <h3 className="font-semibold">Ingredientes</h3>
              <p className="text-xs text-gray-500">Dois blocos por linha em telas largas.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {form.ingredientes.map((ing, idx) => (
                <div key={idx} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900/40">
                  {/* topo: imagem + botões */}
                  <div className="flex items-center gap-3 mb-3">
                    {ing.imagemUrl
                      ? <img src={ing.imagemUrl} className="w-14 h-14 object-cover rounded border" />
                      : <div className="w-14 h-14 rounded bg-gray-200 dark:bg-gray-700 grid place-items-center">
                          <PhotoIcon className="w-6 h-6 text-gray-500" />
                        </div>
                    }
                    <div className="flex gap-2">
                      <button
                        onClick={() => pickAndUpload('ingrediente', idx)}
                        disabled={uploadingIngIdx === idx}
                        className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-60 transition-transform active:scale-[0.98]"
                      >
                        <ArrowUpOnSquareIcon className="w-4 h-4" />
                        {uploadingIngIdx === idx ? 'Enviando...' : 'Enviar imagem'}
                      </button>
                      {ing.imagemUrl && (
                        <button
                          onClick={() => removerImagemIngrediente(idx)}
                          className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded border text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-transform active:scale-[0.98]"
                        >
                          <TrashIcon className="w-4 h-4" />
                          Remover
                        </button>
                      )}
                    </div>
                  </div>

                  {/* campos nome, quantidade, peso */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="text-xs text-gray-600">Nome</label>
                      <input
                        type="text"
                        className="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={ing.nome}
                        onChange={e => {
                          const arr = [...form.ingredientes];
                          arr[idx].nome = e.target.value;
                          setForm(prev => ({ ...prev, ingredientes: arr }));
                        }}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-600">Qtd</label>
                      <input
                        type="number"
                        className="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={ing.quantidade}
                        onChange={e => {
                          const arr = [...form.ingredientes];
                          arr[idx].quantidade = Number(e.target.value);
                          setForm(prev => ({ ...prev, ingredientes: arr }));
                        }}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-600">Peso</label>
                      <input
                        type="number"
                        className="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        value={ing.peso}
                        onChange={e => {
                          const arr = [...form.ingredientes];
                          arr[idx].peso = Number(e.target.value);
                          setForm(prev => ({ ...prev, ingredientes: arr }));
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* botão adicionar ingrediente */}
            <div className="mt-4">
              <button
                onClick={() =>
                  setForm(prev => ({
                    ...prev,
                    ingredientes: [...prev.ingredientes, { nome: '', quantidade: 0, peso: 0, imagemUrl: '' }]
                  }))
                }
                className="inline-flex items-center gap-2 px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700 transition-transform active:scale-[0.98]"
              >
                <PlusIcon className="w-5 h-5" />
                Adicionar ingrediente
              </button>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={salvar}
                className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 transition-transform active:scale-[0.98]"
              >
                Salvar
              </button>

              {editId && (
                <button
                  onClick={() => definirAtivo(editId)}
                  className="px-4 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 flex items-center gap-2 transition-transform active:scale-[0.98]"
                >
                  <CheckCircleIcon className="w-5 h-5" />
                  Definir como ativo
                </button>
              )}

              <button
                onClick={handleNew}
                className="px-4 py-2 rounded border hover:bg-gray-50 dark:hover:bg-gray-700 transition-transform active:scale-[0.98]"
              >
                Limpar / Novo
              </button>
            </div>
          </section>
        </div>
      </main>

      {/* Toast */}
      <ToastView toast={toast} />
      {/* Modal de confirmação para excluir */}
      <ConfirmModal
        open={confirmOpen}
        title="Excluir produto"
        message={`Tem certeza que deseja excluir "${productToDelete?.nome ?? ''}"? Essa ação não pode ser desfeita.`}
        confirmText="Excluir"
        cancelText="Cancelar"
        onCancel={() => { setConfirmOpen(false); setProductToDelete(null); }}
        onConfirm={() => productToDelete && excluirProduto(productToDelete)}
      />
    </div>
  );
}

/* ===== Toast view ===== */
const ToastView: React.FC<{ toast: { open: boolean; type: 'success'|'error'|'info'; msg: string } }> = ({ toast }) => {
  if (!toast.open) return null;
  return (
    <div className="fixed bottom-5 right-5 z-50">
      <div
        className={
          'px-4 py-3 rounded-lg shadow text-white ' +
          (toast.type === 'success'
            ? 'bg-emerald-600'
            : toast.type === 'error'
            ? 'bg-red-600'
            : 'bg-gray-800')
        }
      >
        {toast.msg}
      </div>
    </div>
  );
};
