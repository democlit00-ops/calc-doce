'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Sidebar from '@/components/ui/sidebar';
import {
  auth,
  db,
  collection,
  getDocs,
  doc,
  getDoc,
} from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import {
  PlusIcon,
  MinusIcon,
  PhotoIcon,
  ArrowRightIcon,
  CurrencyDollarIcon,
  ScaleIcon,
  CubeIcon,
  PencilSquareIcon,
  ClipboardDocumentCheckIcon,
  XMarkIcon,
  ArchiveBoxIcon,
  ShoppingBagIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
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
  quantidade: number;   // unidades (base)
  peso: number;         // kg (base, para aquela quantidade base)
  imagemUrl?: string;
}

interface ProdutoFarm {
  id?: string;
  nome: string;
  peso: number;         // peso do produto (base)
  quantidade: number;   // quantidade base (passo)
  valor: number;
  ativo: boolean;
  imagemUrl?: string;
  ingredientes: IngredienteItem[];
}

/* ===== formatação ===== */
const fmtMoney0 = (n: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(n) || 0);
const fmtNum = (n: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(n) || 0);

/* ===== Toast ===== */
type ToastType = 'success' | 'error' | 'info';
interface ToastState { open: boolean; type: ToastType; msg: string; }
const useToast = () => {
  const [toast, setToast] = useState<ToastState>({ open: false, type: 'info', msg: '' });
  const show = (msg: string, type: ToastType = 'info') => {
    setToast({ open: true, type, msg });
    setTimeout(() => setToast(prev => ({ ...prev, open: false })), 2500);
  };
  return { toast, show };
};
const ToastView: React.FC<{ toast: ToastState }> = ({ toast }) => {
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

/* ===== Helpers ===== */
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

/* ===== Skeleton ===== */
const Skeleton = ({ className='' }: { className?: string }) => (
  <div className={`animate-pulse rounded bg-gray-200 dark:bg-gray-700 ${className}`} />
);

export default function CalculadoraFarmPage() {
  const [activePage, setActivePage] = useState('Calculadora Farm');
  const [loading, setLoading] = useState(true);
  const [produto, setProduto] = useState<ProdutoFarm | null>(null);

  const [hierarquia, setHierarquia] = useState<Hierarquia>('3');
  const [permitidoEditar, setPermitidoEditar] = useState(false);

  const [quantAtual, setQuantAtual] = useState<number>(0);

  // estoque por ingrediente: mochila + baú (em UNIDADES)
  const [stock, setStock] = useState<{ mochila: number; bau: number }[]>([]);

  const router = useRouter();
  const { toast, show } = useToast();

  /* --- Auth & role --- */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setHierarquia('3');
        setPermitidoEditar(false);
        return;
      }
      try {
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        const data = userSnap.exists() ? (userSnap.data() as any) : {};
        const raw = data.roleLevel ?? data.hierarquia ?? data.role ?? '3';
        const norm = normalizeRole(raw);
        setHierarquia(norm);
        setPermitidoEditar(['1','2','4'].includes(norm));
      } catch {
        setHierarquia('3');
        setPermitidoEditar(false);
      }
    });
    return () => unsub();
  }, []);

  /* --- Buscar produto ativo --- */
  const fetchAtivo = async () => {
    const snap = await getDocs(collection(db, 'produtosFarm'));
    const list: ProdutoFarm[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ProdutoFarm[];
    const ativo = list.find(p => p.ativo) ?? null;
    setProduto(ativo);
    if (ativo) {
      setQuantAtual(ativo.quantidade);
      setStock(ativo.ingredientes.map(() => ({ mochila: 0, bau: 0 })));
    }
    setLoading(false);
  };
  useEffect(() => {
    fetchAtivo();
  }, []);

  // se mudar o ativo, ressincroniza o array de estoque
  useEffect(() => {
    if (!produto) return;
    setStock(produto.ingredientes.map(() => ({ mochila: 0, bau: 0 })));
  }, [produto?.id]);

  /* --- Cálculo --- */
  const fator = useMemo(() => {
    if (!produto || produto.quantidade <= 0 || quantAtual <= 0) return 0;
    return quantAtual / produto.quantidade;
  }, [produto, quantAtual]);

  const calculo = useMemo(() => {
    if (!produto || fator <= 0) return null;

    const itens = (produto.ingredientes || []).map((i, idx) => {
      const quantidadeCalc = i.quantidade * fator;    // unidades necessárias
      const pesoCalc = i.peso * fator;                // kg necessários (total)
      const perUnitWeight = i.quantidade > 0 ? i.peso / i.quantidade : 0; // kg por unidade (base)
      const disponivelUni = (stock[idx]?.mochila || 0) + (stock[idx]?.bau || 0);
      const faltandoUni = Math.max(0, quantidadeCalc - disponivelUni);

      const pesoDisponivel = disponivelUni * perUnitWeight;  // kg disponível
      const pesoFaltando = Math.max(0, faltandoUni * perUnitWeight); // kg faltante

      return {
        ...i,
        quantidadeCalc,
        pesoCalc,
        perUnitWeight,
        disponivelUni,
        faltandoUni,
        pesoDisponivel,
        pesoFaltando,
      };
    });

    const valorTotal = produto.valor * fator;
    const pesoTotalIngredientes = itens.reduce((acc, i) => acc + (i.pesoCalc || 0), 0);
    const pesoTotalProduto = (produto.peso || 0) * fator;

    const faltantes = itens.filter(i => i.faltandoUni > 0).length;
    const totalUnidadesFaltando = itens.reduce((acc, i) => acc + i.faltandoUni, 0);

    const totalPesoDisponivel = itens.reduce((acc, i) => acc + i.pesoDisponivel, 0);
    const totalPesoFaltando = itens.reduce((acc, i) => acc + i.pesoFaltando, 0);

    return {
      itens,
      valorTotal,
      pesoTotalIngredientes,
      pesoTotalProduto,
      faltantes,
      totalUnidadesFaltando,
      totalPesoDisponivel,
      totalPesoFaltando,
    };
  }, [produto, fator, stock]);

  /* --- Controles --- */
  const step = produto?.quantidade || 50;
  const diminuir = () => setQuantAtual(q => Math.max(step, q - step));
  const aumentar = () => setQuantAtual(q => q + step);
  const onChangeLivre = (v: number) => {
    if (!produto) return;
    if (v <= 0) { setQuantAtual(step); return; }
    const mult = Math.round(v / step);
    setQuantAtual(Math.max(step, mult * step));
  };

  const setMochila = (idx: number, v: number) => {
    setStock(prev => {
      const arr = [...prev];
      arr[idx] = { ...(arr[idx] ?? { mochila: 0, bau: 0 }), mochila: Math.max(0, v || 0) };
      return arr;
    });
  };
  const setBau = (idx: number, v: number) => {
    setStock(prev => {
      const arr = [...prev];
      arr[idx] = { ...(arr[idx] ?? { mochila: 0, bau: 0 }), bau: Math.max(0, v || 0) };
      return arr;
    });
  };
  const zerarEstoques = () => {
    setStock(produto?.ingredientes.map(() => ({ mochila: 0, bau: 0 })) ?? []);
  };

  /* --- Copiar resumo (inclui faltas e pesos) --- */
  const copiarResumo = async () => {
    if (!produto || !calculo) return;
    const linhas: string[] = [];
    linhas.push(`Produto: ${produto.nome}`);
    linhas.push(`Unidades: ${fmtNum(quantAtual)}`);
    linhas.push(`Valor total: R$ ${fmtMoney0(calculo.valorTotal)}`);
    linhas.push(`Peso total (ingredientes): ${fmtNum(calculo.pesoTotalIngredientes)} kg`);
    linhas.push(`Peso total (produto): ${fmtNum(calculo.pesoTotalProduto)} kg`);
    linhas.push(`Disponível (peso): ${fmtNum(calculo.totalPesoDisponivel)} kg • Faltando (peso): ${fmtNum(calculo.totalPesoFaltando)} kg`);
    linhas.push(`Faltando em ${calculo.faltantes} ingredientes (total: ${fmtNum(calculo.totalUnidadesFaltando)} uni)`);
    linhas.push('--- Ingredientes ---');
    calculo.itens.forEach((ing, idx) => {
      linhas.push(
        `${ing.nome}: ` +
        `${fmtNum(ing.quantidadeCalc)} uni • ${fmtNum(ing.pesoCalc)} kg ` +
        `(Disp: ${fmtNum(ing.disponivelUni)} uni / ${fmtNum(ing.pesoDisponivel)} kg → ` +
        `Falta: ${fmtNum(ing.faltandoUni)} uni / ${fmtNum(ing.pesoFaltando)} kg)`
      );
    });
    try {
      await navigator.clipboard.writeText(linhas.join('\n'));
      show('Resumo copiado!', 'success');
    } catch {
      show('Não consegui copiar. Tente novamente.', 'error');
    }
  };

  /* =========================
     UI
  ======================== */
  if (loading) {
    return (
      <div className="flex min-h-screen">
        <Sidebar activePage={activePage} setActivePage={setActivePage} />
        <main className="flex-1 p-6">
          <div className="flex items-center gap-3 mb-6">
            <Skeleton className="w-14 h-14 rounded-xl" />
            <div className="flex-1">
              <Skeleton className="h-4 w-56 mb-2" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-[360px,1fr] gap-6">
            <section className="rounded-2xl p-5 bg-white dark:bg-gray-800">
              <Skeleton className="h-5 w-24 mb-4" />
              <Skeleton className="h-10 w-full" />
            </section>
            <section className="rounded-2xl p-5 bg-white dark:bg-gray-800">
              <Skeleton className="h-5 w-24 mb-4" />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            </section>
          </div>
        </main>
      </div>
    );
  }

  if (!produto) {
    return (
      <div className="flex min-h-screen bg-gray-50 dark:bg-gray-900">
        <Sidebar activePage={activePage} setActivePage={setActivePage} />
        <main className="flex-1 p-6 grid place-items-center">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-6 max-w-md text-center">
            <h2 className="text-xl font-semibold mb-2">Nenhum produto ativo</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Cadastre um produto e marque como <strong>Ativo</strong> em <em>Registro de Farm</em>.
            </p>
            <div className="mt-4">
              <a
                href="/registro-farm"
                className="inline-flex items-center gap-2 px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
              >
                <ArrowRightIcon className="w-5 h-5" />
                Ir para Registro de Farm
              </a>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-950 text-gray-800 dark:text-gray-100">
      <Sidebar activePage={activePage} setActivePage={setActivePage} />

      <main className="flex-1 p-5 md:p-8">
        {/* Cabeçalho com nome/infos centralizados */}
        <div className="relative rounded-2xl overflow-hidden shadow mb-6">
          <div className="h-2 bg-blue-500/40" />
          <div className="bg-white dark:bg-gray-800 p-4">
            {permitidoEditar && (
              <a
                href="/registro-farm"
                className="absolute top-3 right-3 inline-flex items-center gap-2 px-3 py-2 rounded-lg text-white bg-blue-600 hover:bg-blue-700 transition"
              >
                <PencilSquareIcon className="w-5 h-5" />
                Editar
              </a>
            )}

            <div className="flex flex-col items-center text-center gap-3">
              {produto.imagemUrl ? (
                <img
                  src={produto.imagemUrl}
                  alt={produto.nome}
                  className="w-16 h-16 rounded-xl object-cover border shadow-sm"
                />
              ) : (
                <div className="w-16 h-16 rounded-xl bg-gray-200 dark:bg-gray-700 grid place-items-center">
                  <PhotoIcon className="w-7 h-7 text-gray-500" />
                </div>
              )}

              <h1 className="text-2xl md:text-3xl font-bold leading-tight">{produto.nome}</h1>

              <div className="text-xs text-gray-500 flex flex-wrap items-center justify-center gap-3">
                <span className="inline-flex items-center gap-1">
                  <CubeIcon className="w-4 h-4" /> Base {fmtNum(produto.quantidade)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <CurrencyDollarIcon className="w-4 h-4" /> R$ {fmtMoney0(produto.valor)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <ScaleIcon className="w-4 h-4" /> {fmtNum(produto.peso)} kg
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Conteúdo principal */}
        <div className="grid grid-cols-1 xl:grid-cols-[360px,1fr] gap-6">
          {/* Controles (centralizados) */}
          <section className="rounded-2xl border border-white/40 dark:border-white/10 bg-white/60 dark:bg-gray-800/60 backdrop-blur shadow p-5 h-fit">
            <h2 className="text-lg font-semibold mb-3 text-center">Quantidade</h2>

            <div className="flex items-center justify-center gap-3">
              <button
                onClick={diminuir}
                className="p-2 rounded-xl border hover:bg-gray-50 dark:hover:bg-gray-700 active:scale-95 transition"
                aria-label="Diminuir"
                title={`Diminuir ${produto.quantidade}`}
              >
                <MinusIcon className="w-5 h-5" />
              </button>

              <input
                type="number"
                className="w-full max-w-[200px] text-center p-2 rounded-lg border dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={quantAtual}
                onChange={(e) => onChangeLivre(Number(e.target.value))}
                min={produto.quantidade}
                step={produto.quantidade}
              />

              <button
                onClick={aumentar}
                className="p-2 rounded-xl border hover:bg-gray-50 dark:hover:bg-gray-700 active:scale-95 transition"
                aria-label="Aumentar"
                title={`Aumentar ${produto.quantidade}`}
              >
                <PlusIcon className="w-5 h-5" />
              </button>
            </div>

            {calculo && (
              <>
                <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-900/40 border dark:border-gray-700 text-center">
                    <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
                      <CubeIcon className="w-4 h-4" /> Unidades
                    </div>
                    <div className="text-xl font-semibold">{fmtNum(quantAtual)}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-900/40 border dark:border-gray-700 text-center">
                    <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
                      <CurrencyDollarIcon className="w-4 h-4" /> Valor total
                    </div>
                    <div className="text-xl font-semibold">R$ {fmtMoney0(calculo.valorTotal)}</div>
                  </div>
                  <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-900/40 border dark:border-gray-700 text-center">
                    <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
                      <ScaleIcon className="w-4 h-4" /> Peso do produto
                    </div>
                    <div className="text-xl font-semibold">{fmtNum(calculo.pesoTotalProduto)} kg</div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 justify-center">
                  <button
                    onClick={copiarResumo}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-white transition bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98]"
                  >
                    <ClipboardDocumentCheckIcon className="w-5 h-5" />
                    Copiar resumo
                  </button>
                  <button
                    onClick={zerarEstoques}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border hover:bg-gray-50 dark:hover:bg-gray-700 active:scale-[0.98]"
                  >
                    Zerar estoques
                  </button>
                </div>
              </>
            )}
          </section>

          {/* Resultado com resumo SEPARADO */}
          <section className="bg-white dark:bg-gray-800 rounded-2xl shadow p-0 overflow-hidden">
            {calculo && (
              <div className="sticky top-0 z-10 px-5 py-3 bg-white/80 dark:bg-gray-800/80 backdrop-blur border-b dark:border-gray-700">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  {/* Resumo total */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">Resumo total</span>
                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
                      R$ {fmtMoney0(calculo.valorTotal)}
                    </span>
                    <span className="px-2 py-1 rounded-full text-xs bg-gray-100 dark:bg-gray-700">
                      {fmtNum(calculo.pesoTotalIngredientes)} kg (ingredientes)
                    </span>
                    <span className="px-2 py-1 rounded-full text-xs bg-gray-100 dark:bg-gray-700">
                      {fmtNum(calculo.pesoTotalProduto)} kg (produto)
                    </span>
                    <span className="px-2 py-1 rounded-full text-xs bg-gray-100 dark:bg-gray-700">
                      Disp.: {fmtNum(calculo.totalPesoDisponivel)} kg
                    </span>
                  </div>

                  {/* Faltando */}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">Faltando</span>
                    <span className="px-2 py-1 rounded-full text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200">
                      {fmtNum(calculo.totalPesoFaltando)} kg
                    </span>
                    {calculo.totalUnidadesFaltando > 0 ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200">
                        <ExclamationTriangleIcon className="w-4 h-4" />
                        {fmtNum(calculo.totalUnidadesFaltando)} uni
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">
                        <CheckCircleIcon className="w-4 h-4" />
                        Sem faltas
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="p-5">
              <h2 className="text-lg font-semibold mb-4">Resultado</h2>

              {!calculo ? (
                <p className="text-sm text-gray-500">Defina a quantidade para ver os cálculos.</p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {calculo.itens.map((ing, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl border dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 hover:shadow-sm transition"
                    >
                      <div className="flex items-center gap-3">
                        {ing.imagemUrl ? (
                          <img src={ing.imagemUrl} alt={ing.nome} className="w-10 h-10 rounded object-cover border" />
                        ) : (
                          <div className="w-10 h-10 rounded bg-gray-200 dark:bg-gray-700 grid place-items-center">
                            <PhotoIcon className="w-6 h-6 text-gray-500" />
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <div className="text-[15px] font-semibold truncate">{ing.nome || 'Ingrediente'}</div>
                          <div className="text-[11px] text-gray-500 truncate">
                            Base: {fmtNum(ing.quantidade)} uni • {fmtNum(ing.peso)} kg
                          </div>
                        </div>

                        <div className="text-right leading-tight">
                          <div className="text-sm font-semibold">
                            {fmtNum(ing.quantidadeCalc)} <span className="text-xs font-normal">uni</span>
                          </div>
                          <div className="text-[11px] text-gray-500">
                            {fmtNum(ing.pesoCalc)} kg
                          </div>
                        </div>
                      </div>

                      {/* Estoque: mochila + baú */}
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[11px] text-gray-600 flex items-center gap-1">
                            <ShoppingBagIcon className="w-4 h-4" /> Mochila (uni)
                          </label>
                          <input
                            type="number"
                            className="mt-1 w-full p-2 rounded border dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={stock[idx]?.mochila ?? 0}
                            min={0}
                            onChange={(e) => setMochila(idx, Number(e.target.value))}
                          />
                        </div>
                        <div>
                          <label className="text-[11px] text-gray-600 flex items-center gap-1">
                            <ArchiveBoxIcon className="w-4 h-4" /> Baú (uni)
                          </label>
                          <input
                            type="number"
                            className="mt-1 w-full p-2 rounded border dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            value={stock[idx]?.bau ?? 0}
                            min={0}
                            onChange={(e) => setBau(idx, Number(e.target.value))}
                          />
                        </div>
                      </div>

                      {/* Status (unidades e pesos) */}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {ing.faltandoUni > 0 ? (
                          <>
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200">
                              <ExclamationTriangleIcon className="w-4 h-4" />
                              Falta {fmtNum(ing.faltandoUni)} uni
                            </span>
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200">
                              <ScaleIcon className="w-4 h-4" />
                              {fmtNum(ing.pesoFaltando)} kg
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">
                              <CheckCircleIcon className="w-4 h-4" />
                              Ok — suficiente
                            </span>
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-gray-100 dark:bg-gray-700">
                              <ScaleIcon className="w-4 h-4" />
                              Disp.: {fmtNum(ing.pesoDisponivel)} kg
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Toast */}
      <ToastView toast={toast} />
    </div>
  );
}
