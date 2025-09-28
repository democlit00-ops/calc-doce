'use client';

import { useEffect, useMemo, useState } from 'react';
import Sidebar from '@/components/ui/sidebar';
import { auth, db } from '@/lib/firebase';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  getDocs,
  limit as fsLimit,
} from 'firebase/firestore';
import {
  PlusIcon,
  TrashIcon,
  ArrowDownCircleIcon,
  ArrowUpCircleIcon,
  ClipboardDocumentListIcon,
  ArrowsRightLeftIcon,
} from '@heroicons/react/24/outline';

/* ======================= Tipos ======================= */
type LoggedUserLocal = {
  id: string;
  uid: string;
  nome: string;
  email: string;
  discord?: string;
  passaport?: string;
  roleLevel: number; // 1..5
  pasta?: string;
};

type Produto = {
  id: string;
  nome: string;
};

type Bau = {
  id: string;
  name: string;
  createdAt?: any;
};

type Movement = {
  id: string;
  type: 'in' | 'out';
  reason: 'deposit' | 'production' | 'sale' | 'admin' | 'transfer';
  quantity: number;
  bauId?: string | null;
  bauName?: string | null;
  createdByUid: string;
  createdByName: string; // ex.: "Nome - 01"
  roleLevel: number;
  note?: string;
  createdAt?: any;

  // podem não existir em docs antigos
  produtoId?: string;
  produtoNome?: string;
};

/* ======================= Página ======================= */
export default function EstoquePage() {
  const [activePage, setActivePage] = useState('Estoque');

  const [user, setUser] = useState<LoggedUserLocal | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [baus, setBaus] = useState<Bau[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);

  // Produtos
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [selectedProdId, setSelectedProdId] = useState<string>('');

  // ===== Forms
  const [newBauName, setNewBauName] = useState('');
  const [fabricacaoQty, setFabricacaoQty] = useState<number>(0);
  const [fabricacaoBauId, setFabricacaoBauId] = useState<string>('');
  const [retiradaQty, setRetiradaQty] = useState<number>(0);
  const [retiradaBauId, setRetiradaBauId] = useState<string>(''); // opcional
  const [retiradaObs, setRetiradaObs] = useState<string>('');
  // transferência
  const [transfFromId, setTransfFromId] = useState<string>('');
  const [transfToId, setTransfToId] = useState<string>('');
  const [transfQty, setTransfQty] = useState<number>(0);

  // ===== Filtros (histórico)
  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<'' | 'in' | 'out'>('');
  const [filtroMotivo, setFiltroMotivo] = useState<'' | Movement['reason']>('');
  const [filtroBau, setFiltroBau] = useState('');
  const [filtroProdutoId, setFiltroProdutoId] = useState<string>(''); // filtro por produto
  const [filtroInicio, setFiltroInicio] = useState<string>(''); // yyyy-mm-dd
  const [filtroFim, setFiltroFim] = useState<string>(''); // yyyy-mm-dd
  const [limiteLista, setLimiteLista] = useState<number>(20);
  const [expand, setExpand] = useState<Record<string, boolean>>({});

  // ===== Apagar tudo
  const [confirmAllOpen, setConfirmAllOpen] = useState(false);
  const [confirmWord, setConfirmWord] = useState('');

  /* ================= Auth boot ================= */
  useEffect(() => {
    const local = typeof window !== 'undefined' ? localStorage.getItem('loggedUser') : null;
    if (local) {
      try {
        const parsed = JSON.parse(local) as LoggedUserLocal;
        setUser(parsed);
      } catch {
        setUser(null);
      }
    }
    const unsub = auth.onAuthStateChanged((u) => {
      if (!u) {
        setUser(null);
        setAuthReady(true);
        return;
      }
      if (!local) {
        setUser({
          id: u.uid,
          uid: u.uid,
          nome: u.displayName || u.email || 'Usuário',
          email: u.email || '',
          roleLevel: 5,
        } as LoggedUserLocal);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // helpers de acesso
  const role = user?.roleLevel ?? 5;
  const canAccess = role >= 1 && role <= 5;
  const canManageBaus = role <= 2; // criar/deletar baús
  const canFabricar = role <= 5; // 1..5
  const canRetirarAdm = role <= 2; // retirada ADM
  const canTransferir = role <= 5; // 1..5
  const canDeleteMov = role <= 2; // excluir individual
  const canWipeAll = role <= 2; // apagar tudo

  /* ================= Streams Firestore ================= */
  useEffect(() => {
    if (!authReady || !user || !canAccess) return;

    // Baús
    const qBaus = query(collection(db, 'baus'), orderBy('createdAt', 'asc'));
    const unsubBaus = onSnapshot(
      qBaus,
      (snap) => {
        const items: Bau[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          items.push({ id: d.id, name: data.name, createdAt: data.createdAt });
        });
        setBaus(items);
        // defaults para selects
        if (!fabricacaoBauId && items.length > 0) setFabricacaoBauId(items[0].id);
        if (!transfFromId && items.length > 0) setTransfFromId(items[0].id);
        if (!transfToId && items.length > 1) setTransfToId(items[1].id);
      },
      (err) => console.error('baus stream error:', err)
    );

    // Movimentos
    const qMov = query(collection(db, 'stock_movements'), orderBy('createdAt', 'desc'));
    const unsubMov = onSnapshot(
      qMov,
      (snap) => {
        const items: Movement[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          items.push({
            id: d.id,
            type: data.type,
            reason: data.reason,
            quantity: Number(data.quantity || 0),
            bauId: data.bauId ?? null,
            bauName: data.bauName ?? null,
            createdByUid: data.createdByUid,
            createdByName: data.createdByName,
            roleLevel: Number(data.roleLevel || 5),
            note: data.note || '',
            createdAt: data.createdAt,
            produtoId: data.produtoId || undefined,
            produtoNome: data.produtoNome || undefined,
          });
        });
        setMovements(items);
      },
      (err) => console.error('stock_movements stream error:', err)
    );

    // Produtos (tenta em 'produtos', depois 'produtosFarm'; se vazio, deriva de movimentos)
    (async () => {
      const uniq: Record<string, Produto> = {};

      // 1) produtos
      try {
        const snap = await getDocs(collection(db, 'produtos'));
        snap.forEach((d) => {
          const data = d.data() as any;
          if (data?.nome) uniq[d.id] = { id: d.id, nome: data.nome };
        });
      } catch {}

      // 2) produtosFarm (fallback)
      if (Object.keys(uniq).length === 0) {
        try {
          const snap = await getDocs(collection(db, 'produtosFarm'));
          snap.forEach((d) => {
            const data = d.data() as any;
            if (data?.nome) uniq[d.id] = { id: d.id, nome: data.nome };
          });
        } catch {}
      }

      // 3) derivar de movimentos (último fallback)
      if (Object.keys(uniq).length === 0) {
        const nomes = new Set<string>();
        movements.forEach((m) => {
          if (m.produtoNome) nomes.add(m.produtoNome);
        });
        Array.from(nomes).forEach((nome) => {
          const fakeId = `nome:${nome}`;
          uniq[fakeId] = { id: fakeId, nome };
        });
      }

      const arr = Object.values(uniq);
      setProdutos(arr);
      if (!selectedProdId && arr.length > 0) setSelectedProdId(arr[0].id);
      if (!filtroProdutoId && arr.length > 0) setFiltroProdutoId(arr[0].id);
    })();

    return () => {
      unsubBaus();
      unsubMov();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, user, canAccess]);

  const selectedProduto = useMemo(
    () => produtos.find((p) => p.id === selectedProdId) || null,
    [produtos, selectedProdId]
  );

  /* ================= Totais POR PRODUTO ================= */
  const movsDoProduto = useMemo(() => {
    if (!selectedProdId) return [] as Movement[];
    if (selectedProdId.startsWith('nome:')) {
      const nome = selectedProdId.slice(5);
      return (Array.isArray(movements) ? movements : []).filter((m) => (m.produtoNome || '') === nome);
    }
    return (Array.isArray(movements) ? movements : []).filter((m) => m.produtoId === selectedProdId);
  }, [movements, selectedProdId]);

  const prodIn = useMemo(
    () => movsDoProduto.filter((m) => m.type === 'in').reduce((acc, m) => acc + Number(m.quantity || 0), 0),
    [movsDoProduto]
  );

  const prodOut = useMemo(
    () => movsDoProduto.filter((m) => m.type === 'out').reduce((acc, m) => acc + Number(m.quantity || 0), 0),
    [movsDoProduto]
  );

  // Tabela "Baús" — por produto (ins/outs/saldo por baú)
  const saldoProdutoPorBau = useMemo(() => {
    const map = new Map<string, { name: string; ins: number; outs: number; saldo: number }>();
    baus.forEach((b) => map.set(b.id, { name: b.name, ins: 0, outs: 0, saldo: 0 }));
    movsDoProduto.forEach((m) => {
      if (!m.bauId) return;
      const rec = map.get(m.bauId);
      if (!rec) return;
      // contabiliza normalmente no saldo
      if (m.type === 'in') {
        rec.ins += Number(m.quantity || 0);
        rec.saldo += Number(m.quantity || 0);
      } else {
        rec.outs += Number(m.quantity || 0);
        rec.saldo -= Number(m.quantity || 0);
      }
    });
    return Array.from(map.entries()).map(([id, v]) => ({ id, ...v }));
  }, [baus, movsDoProduto]);

  const produtoTotalNoSistema = useMemo(
    () => saldoProdutoPorBau.reduce((acc, b) => acc + Number(b.saldo || 0), 0),
    [saldoProdutoPorBau]
  );

  const prodSaldo = produtoTotalNoSistema;

  // Saldos de origem/destino para a transferência
  const originSaldo = useMemo(() => {
    const rec = saldoProdutoPorBau.find((x) => x.id === transfFromId);
    return Number(rec?.saldo || 0);
  }, [saldoProdutoPorBau, transfFromId]);

  const destSaldo = useMemo(() => {
    const rec = saldoProdutoPorBau.find((x) => x.id === transfToId);
    return Number(rec?.saldo || 0);
  }, [saldoProdutoPorBau, transfToId]);

  // Contagem de movimentos por baú (para travar delete do baú)
  const movimentosPorBau = useMemo(() => {
    const map = new Map<string, number>();
    (Array.isArray(movements) ? movements : []).forEach((m) => {
      if (m.bauId) map.set(m.bauId, (map.get(m.bauId) || 0) + 1);
    });
    return map;
  }, [movements]);

  /* ================= Ações ================= */

  const selectedNomeForWrite = useMemo(() => {
    if (!selectedProdId) return { produtoId: '', produtoNome: '' };
    if (selectedProdId.startsWith('nome:')) {
      const nome = selectedProdId.slice(5);
      return { produtoId: '', produtoNome: nome };
    }
    const p = produtos.find((x) => x.id === selectedProdId);
    return { produtoId: selectedProdId, produtoNome: p?.nome || '' };
  }, [selectedProdId, produtos]);

  const handleCreateBau = async () => {
    if (!canManageBaus) return;
    const name = newBauName.trim();
    if (!name) return;
    await addDoc(collection(db, 'baus'), {
      name,
      createdAt: serverTimestamp(),
    });
    setNewBauName('');
  };

  const handleDeleteBau = async (bauId: string) => {
    if (!canManageBaus) return;
    const hasMovs = (movimentosPorBau.get(bauId) || 0) > 0;
    if (hasMovs) {
      alert('Não é possível excluir: este baú já possui movimentos no histórico.');
      return;
    }
    await deleteDoc(doc(db, 'baus', bauId));
    if (fabricacaoBauId === bauId) setFabricacaoBauId('');
    if (retiradaBauId === bauId) setRetiradaBauId('');
    if (transfFromId === bauId) setTransfFromId('');
    if (transfToId === bauId) setTransfToId('');
  };

  const handleFabricar = async () => {
    if (!canFabricar || !user) return;
    if (!selectedProdId) return alert('Selecione um produto.');
    const qty = Number(fabricacaoQty);
    if (!qty || qty <= 0) return alert('Informe uma quantidade válida.');
    if (!fabricacaoBauId) return alert('Selecione um baú.');

    const bau = baus.find((b) => b.id === fabricacaoBauId);
    const { produtoId, produtoNome } = selectedNomeForWrite;

    await addDoc(collection(db, 'stock_movements'), {
      type: 'in',
      reason: 'production',
      quantity: Number(qty),
      bauId: fabricacaoBauId,
      bauName: bau?.name || null,
      createdByUid: user.uid,
      createdByName: user.nome,
      roleLevel: role,
      createdAt: serverTimestamp(),
      produtoId: produtoId || null,
      produtoNome: produtoNome || null,
    });
    setFabricacaoQty(0);
  };

  const handleRetiradaAdm = async () => {
    if (!canRetirarAdm || !user) return;
    if (!selectedProdId) return alert('Selecione um produto.');
    const qty = Number(retiradaQty);
    if (!qty || qty <= 0) return alert('Informe uma quantidade válida.');
    const bau = retiradaBauId ? baus.find((b) => b.id === retiradaBauId) : null;
    const { produtoId, produtoNome } = selectedNomeForWrite;

    await addDoc(collection(db, 'stock_movements'), {
      type: 'out',
      reason: 'admin',
      quantity: Number(qty),
      bauId: retiradaBauId || null,
      bauName: bau?.name || null,
      note: (retiradaObs || '').trim(),
      createdByUid: user.uid,
      createdByName: user.nome,
      roleLevel: role,
      createdAt: serverTimestamp(),
      produtoId: produtoId || null,
      produtoNome: produtoNome || null,
    });
    setRetiradaQty(0);
    setRetiradaObs('');
  };

  const handleTransfer = async () => {
    if (!canTransferir || !user) return;
    if (!selectedProdId) return alert('Selecione um produto.');
    const qty = Number(transfQty);
    if (!qty || qty <= 0) return alert('Informe uma quantidade válida.');
    if (!transfFromId || !transfToId) return alert('Selecione origem e destino.');
    if (transfFromId === transfToId) return alert('Origem e destino devem ser diferentes.');

    // Regra: não permitir acima do saldo da origem
    if (qty > originSaldo) {
      return alert(`Quantidade maior que o saldo da origem. Saldo disponível: ${originSaldo}.`);
    }

    const from = baus.find((b) => b.id === transfFromId);
    const to = baus.find((b) => b.id === transfToId);
    const { produtoId, produtoNome } = selectedNomeForWrite;

    // OUT no origem
    await addDoc(collection(db, 'stock_movements'), {
      type: 'out',
      reason: 'transfer',
      quantity: Number(qty),
      bauId: transfFromId,
      bauName: from?.name || null,
      createdByUid: user.uid,
      createdByName: user.nome,
      roleLevel: role,
      note: `Transferência para: ${to?.name || transfToId}`,
      createdAt: serverTimestamp(),
      produtoId: produtoId || null,
      produtoNome: produtoNome || null,
    });

    // IN no destino
    await addDoc(collection(db, 'stock_movements'), {
      type: 'in',
      reason: 'transfer',
      quantity: Number(qty),
      bauId: transfToId,
      bauName: to?.name || null,
      createdByUid: user.uid,
      createdByName: user.nome,
      roleLevel: role,
      note: `Transferência de: ${from?.name || transfFromId}`,
      createdAt: serverTimestamp(),
      produtoId: produtoId || null,
      produtoNome: produtoNome || null,
    });

    setTransfQty(0);
  };

  const handleDeleteMovement = async (mov: Movement) => {
    if (!canDeleteMov) return;
    if (!confirm('Excluir este movimento?')) return;
    await deleteDoc(doc(db, 'stock_movements', mov.id));
  };

  const handleWipeAll = async () => {
    if (!canWipeAll) return;
    setConfirmAllOpen(true);
    setConfirmWord('');
  };

  const performWipeAll = async () => {
    if (!canWipeAll) return;
    if (confirmWord.trim().toLowerCase() !== 'confirma') {
      alert('Digite "confirma" para confirmar.');
      return;
    }
    const batchSize = 200;
    let fetched = 0;
    do {
      const q = query(collection(db, 'stock_movements'), orderBy('createdAt', 'desc'), fsLimit(batchSize));
      const snap = await getDocs(q);
      fetched = snap.size;
      const promises: Promise<any>[] = [];
      snap.forEach((d) => promises.push(deleteDoc(doc(db, 'stock_movements', d.id))));
      if (promises.length) await Promise.all(promises);
    } while (fetched === batchSize);

    setConfirmAllOpen(false);
    setConfirmWord('');
  };

  /* ================= Filtros e lista ================= */

  const movimentosFiltrados = useMemo(() => {
    let arr = Array.isArray(movements) ? [...movements] : [];

    // Filtro por produto no histórico (opcional)
    if (filtroProdutoId) {
      if (filtroProdutoId.startsWith('nome:')) {
        const nome = filtroProdutoId.slice(5);
        arr = arr.filter((m) => (m.produtoNome || '') === nome);
      } else {
        arr = arr.filter((m) => m.produtoId === filtroProdutoId);
      }
    }

    // data
    if (filtroInicio) {
      const d0 = new Date(`${filtroInicio}T00:00:00`);
      arr = arr.filter((m) => {
        const dt = m.createdAt?.toDate?.() ? (m.createdAt.toDate() as Date) : new Date(0);
        return dt >= d0;
      });
    }
    if (filtroFim) {
      const d1 = new Date(`${filtroFim}T23:59:59.999`);
      arr = arr.filter((m) => {
        const dt = m.createdAt?.toDate?.() ? (m.createdAt.toDate() as Date) : new Date(0);
        return dt <= d1;
      });
    }
    // tipo
    if (filtroTipo) arr = arr.filter((m) => m.type === filtroTipo);
    // motivo
    if (filtroMotivo) arr = arr.filter((m) => m.reason === filtroMotivo);
    // baú
    if (filtroBau) arr = arr.filter((m) => (m.bauId || '') === filtroBau);
    // texto (nome ou "Nome - 01")
    if (filtroTexto.trim()) {
      const t = filtroTexto.toLowerCase();
      arr = arr.filter((m) => (m.createdByName || '').toLowerCase().includes(t));
    }

    return arr.slice(0, Number(limiteLista) || 20);
  }, [movements, filtroProdutoId, filtroInicio, filtroFim, filtroTipo, filtroMotivo, filtroBau, filtroTexto, limiteLista]);

  const toggleExpand = (id: string) => setExpand((p) => ({ ...p, [id]: !p[id] }));

  const fmtDateTime = (ts: any) => {
    try {
      const d = ts?.toDate ? (ts.toDate() as Date) : new Date(ts);
      if (isNaN(d.getTime())) return '—';
      return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    } catch {
      return '—';
    }
  };

  /* ================= Render ================= */

  if (!authReady) {
    return (
      <div className="flex min-h-screen">
        <Sidebar activePage={activePage} setActivePage={setActivePage} />
        <main className="flex-1 grid place-items-center p-6">Carregando…</main>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex min-h-screen">
        <Sidebar activePage={activePage} setActivePage={setActivePage} />
        <main className="flex-1 grid place-items-center p-6">
          <div className="text-center text-sm text-gray-600">
            Você precisa entrar para acessar o Estoque. Faça login e volte aqui.
          </div>
        </main>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="flex min-h-screen">
        <Sidebar activePage={activePage} setActivePage={setActivePage} />
        <main className="flex-1 grid place-items-center p-6">
          <div className="text-center text-sm text-gray-600">Acesso restrito.</div>
        </main>
      </div>
    );
  }

  const atingiuMax = transfQty > 0 && transfQty === originSaldo;
  const ultrapassou = transfQty > originSaldo;

  return (
    <div className="flex min-h-screen bg-[#f5f7fb]">
      <Sidebar activePage={activePage} setActivePage={setActivePage} />

      <main className="flex-1 p-4 md:p-6 space-y-6 max-w-6xl mx-auto w-full">
        {/* Cabeçalho + seletor de produto */}
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold">Estoque</h1>
            <p className="text-sm text-gray-600 mt-1">
              Selecione um produto para ver os saldos por baú e registrar movimentos.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm">
              Produto
              <select
                className="ml-2 border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white"
                value={selectedProdId}
                onChange={(e) => {
                  setSelectedProdId(e.target.value);
                  setFiltroProdutoId(e.target.value);
                }}
              >
                {produtos.length === 0 && <option value="">— Nenhum —</option>}
                {produtos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}
                  </option>
                ))}
              </select>
            </label>

            {canWipeAll && (
              <button
                onClick={handleWipeAll}
                className="rounded-xl px-3 py-2 border border-red-300 bg-white hover:bg-red-50 text-sm inline-flex items-center gap-2 text-red-700"
                title='Apagar TODO o histórico e zerar o estoque (digite "confirma" para confirmar)'
              >
                <TrashIcon className="w-4 h-4" />
                Apagar tudo
              </button>
            )}
          </div>
        </header>

        {/* Cards de totais (APENAS do produto selecionado) */}
        {selectedProdId ? (
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <ArrowUpCircleIcon className="w-6 h-6" />
                <h3 className="font-medium">Entradas — {selectedProduto?.nome}</h3>
              </div>
              <p className="mt-2 text-2xl font-semibold">{Number(prodIn).toLocaleString()}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <ArrowDownCircleIcon className="w-6 h-6" />
                <h3 className="font-medium">Saídas — {selectedProduto?.nome}</h3>
              </div>
              <p className="mt-2 text-2xl font-semibold">{Number(prodOut).toLocaleString()}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl p-4">
              <div className="flex items-center gap-3">
                <ClipboardDocumentListIcon className="w-6 h-6" />
                <h3 className="font-medium">Saldo — {selectedProduto?.nome}</h3>
              </div>
              <p className="mt-2 text-2xl font-semibold">{Number(prodSaldo).toLocaleString()}</p>
            </div>
          </section>
        ) : (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4">
            Selecione um produto para visualizar os totais e saldos.
          </div>
        )}

        {/* Gestão de Baús (por produto) */}
        <section className="bg-white border border-gray-200 rounded-2xl p-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="text-xl font-semibold">Baús</h2>
            {canManageBaus && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newBauName}
                  onChange={(e) => setNewBauName(e.target.value)}
                  placeholder="Nome do baú (ex.: Baú Gerente)"
                  className="border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                />
                <button
                  onClick={handleCreateBau}
                  className="inline-flex items-center gap-2 rounded-xl px-3 py-2 border border-gray-300 bg-white hover:bg-gray-50 text-sm"
                >
                  <PlusIcon className="w-4 h-4" />
                  Criar
                </button>
              </div>
            )}
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="p-2">Nome</th>
                  <th className="p-2">Entradas ({selectedProduto?.nome || 'Produto'})</th>
                  <th className="p-2">Saídas ({selectedProduto?.nome || 'Produto'})</th>
                  <th className="p-2">Saldo ({selectedProduto?.nome || 'Produto'})</th>
                  {canManageBaus && <th className="p-2">Ações</th>}
                </tr>
              </thead>
              <tbody>
                {saldoProdutoPorBau.length === 0 && (
                  <tr>
                    <td className="p-3 text-gray-500" colSpan={canManageBaus ? 5 : 4}>
                      Nenhum baú encontrado.
                    </td>
                  </tr>
                )}
                {saldoProdutoPorBau.map((b) => {
                  const movCount = movimentosPorBau.get(b.id) || 0;
                  return (
                    <tr key={b.id} className="border-t">
                      <td className="p-2">{b.name}</td>
                      <td className="p-2">{Number(b.ins).toLocaleString()}</td>
                      <td className="p-2">{Number(b.outs).toLocaleString()}</td>
                      <td className="p-2 font-semibold">{Number(b.saldo).toLocaleString()}</td>
                      {canManageBaus && (
                        <td className="p-2">
                          <button
                            onClick={() => handleDeleteBau(b.id)}
                            disabled={movCount > 0}
                            className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 border text-xs ${
                              movCount > 0
                                ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                                : 'border-red-300 text-red-600 hover:bg-red-50'
                            }`}
                            title={
                              movCount > 0 ? 'Há movimentos vinculados a este baú' : 'Excluir baú'
                            }
                          >
                            <TrashIcon className="w-4 h-4" />
                            Excluir
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Vendas registradas sem baú reduzem somente o <b>Saldo do Produto</b> global, não o saldo por baú.
          </p>
        </section>

        {/* Operações */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Fabricação */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <h2 className="text-lg font-semibold">Registrar Fabricação (Entrada)</h2>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <div className="text-xs text-gray-600">
                Produto: <b>{selectedProduto?.nome || '—'}</b>
              </div>

              <label className="text-sm">
                Baú
                <select
                  className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                  value={fabricacaoBauId}
                  onChange={(e) => setFabricacaoBauId(e.target.value)}
                  disabled={!canFabricar}
                >
                  <option value="" disabled>
                    Selecione...
                  </option>
                  {saldoProdutoPorBau.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} — saldo: {Number(b.saldo).toLocaleString()}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm">
                Quantidade
                <input
                  type="number"
                  inputMode="numeric"
                  className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                  value={fabricacaoQty}
                  onChange={(e) => setFabricacaoQty(Number(e.target.value))}
                  placeholder="Ex.: 1500"
                  disabled={!canFabricar}
                />
              </label>

              <button
                onClick={handleFabricar}
                disabled={!canFabricar || !selectedProdId}
                className="rounded-xl px-4 py-2 border border-gray-300 bg-white hover:bg-gray-50 text-sm inline-flex items-center gap-2"
              >
                <PlusIcon className="w-4 h-4" />
                Adicionar ao Estoque
              </button>
            </div>
          </div>

          {/* Retirada ADM */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4">
            <h2 className="text-lg font-semibold">Retirada ADM (Saída)</h2>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <div className="text-xs text-gray-600">
                Produto: <b>{selectedProduto?.nome || '—'}</b>
              </div>

              <label className="text-sm">
                Baú (opcional)
                <select
                  className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                  value={retiradaBauId}
                  onChange={(e) => setRetiradaBauId(e.target.value)}
                  disabled={!canRetirarAdm}
                >
                  <option value="">Global</option>
                  {saldoProdutoPorBau.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} — saldo: {Number(b.saldo).toLocaleString()}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm">
                Quantidade
                <input
                  type="number"
                  inputMode="numeric"
                  className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                  value={retiradaQty}
                  onChange={(e) => setRetiradaQty(Number(e.target.value))}
                  placeholder="Ex.: 500"
                  disabled={!canRetirarAdm}
                />
              </label>

              <label className="text-sm">
                Observação
                <input
                  type="text"
                  className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                  value={retiradaObs}
                  onChange={(e) => setRetiradaObs(e.target.value)}
                  placeholder="Motivo/Contexto da retirada"
                  disabled={!canRetirarAdm}
                />
              </label>

              <button
                onClick={handleRetiradaAdm}
                disabled={!canRetirarAdm || !selectedProdId}
                className="rounded-xl px-4 py-2 border border-gray-300 bg-white hover:bg-gray-50 text-sm inline-flex items-center gap-2"
              >
                <TrashIcon className="w-4 h-4" />
                Registrar Saída ADM
              </button>
            </div>
          </div>
        </section>

        {/* Transferência */}
        <section className="bg-white border border-gray-200 rounded-2xl p-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ArrowsRightLeftIcon className="w-5 h-5" /> Transferência entre Baús
          </h2>
          <div className="mt-3 text-xs text-gray-600">
            Produto: <b>{selectedProduto?.nome || '—'}</b>
          </div>
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-sm">
              Origem
              <select
                className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                value={transfFromId}
                onChange={(e) => {
                  setTransfFromId(e.target.value);
                  const saldo = saldoProdutoPorBau.find((x) => x.id === e.target.value)?.saldo || 0;
                  setTransfQty((prev) => Math.max(0, Math.min(prev || 0, Number(saldo) || 0)));
                }}
                disabled={!canTransferir}
              >
                <option value="">Selecione...</option>
                {saldoProdutoPorBau.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} — saldo: {Number(b.saldo).toLocaleString()}
                  </option>
                ))}
              </select>
              {transfFromId && (
                <div className="text-xs text-gray-500 mt-1">
                  Saldo origem: <b>{originSaldo.toLocaleString()}</b>
                </div>
              )}
            </label>

            <label className="text-sm">
              Destino
              <select
                className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
                value={transfToId}
                onChange={(e) => setTransfToId(e.target.value)}
                disabled={!canTransferir}
              >
                <option value="">Selecione...</option>
                {saldoProdutoPorBau.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} — saldo: {Number(b.saldo).toLocaleString()}
                  </option>
                ))}
              </select>
              {transfToId && (
                <div className="text-xs text-gray-500 mt-1">
                  Saldo destino: <b>{destSaldo.toLocaleString()}</b>
                </div>
              )}
            </label>

            <label className="text-sm">
              Quantidade
              <div className="relative">
                <input
                  type="number"
                  inputMode="numeric"
                  className={
                    'mt-1 w-full rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 ' +
                    (ultrapassou
                      ? 'border-red-400 focus:ring-red-200 border'
                      : atingiuMax
                      ? 'border-amber-400 focus:ring-amber-200 border'
                      : 'border border-gray-300 focus:ring-indigo-200')
                  }
                  value={transfQty}
                  onChange={(e) => {
                    const val = Number(e.target.value) || 0;
                    setTransfQty(Math.max(0, Math.min(val, originSaldo)));
                  }}
                  placeholder={`Máx: ${originSaldo.toLocaleString()}`}
                  disabled={!canTransferir}
                />
                {atingiuMax && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300">
                    Máximo
                  </span>
                )}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                Máximo permitido é o saldo da origem ({originSaldo.toLocaleString()}).
              </div>
            </label>
          </div>

          <div className="mt-3">
            <button
              onClick={handleTransfer}
              disabled={!canTransferir || !selectedProdId || !transfFromId || !transfToId || transfQty <= 0}
              className="rounded-xl px-4 py-2 border border-gray-300 bg-white hover:bg-gray-50 text-sm inline-flex items-center gap-2"
            >
              <ArrowsRightLeftIcon className="w-4 h-4" />
              Executar Transferência
            </button>
          </div>
        </section>

        {/* Filtros e Lista (Histórico) */}
        <section className="bg-white border border-gray-200 rounded-2xl p-4">
          <h2 className="text-lg font-semibold">Histórico</h2>

          <div className="mt-3 grid grid-cols-1 lg:grid-cols-7 gap-3">
            <label className="text-sm">
              Texto (nome ou “Nome - 01”)
              <input
                value={filtroTexto}
                onChange={(e) => setFiltroTexto(e.target.value)}
                className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
                placeholder="Ex.: Kito ou 'Kito - 01'"
              />
            </label>

            <label className="text-sm">
              Produto
              <select
                value={filtroProdutoId}
                onChange={(e) => setFiltroProdutoId(e.target.value)}
                className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white"
              >
                <option value="">Todos</option>
                {produtos.map((p) => (
                  <option key={p.id} value={p.id}>{p.nome}</option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              Tipo
              <select
                value={filtroTipo}
                onChange={(e) => setFiltroTipo(e.target.value as any)}
                className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white"
              >
                <option value="">Todos</option>
                <option value="in">Entrada</option>
                <option value="out">Saída</option>
              </select>
            </label>

            <label className="text-sm">
              Motivo
              <select
                value={filtroMotivo}
                onChange={(e) => setFiltroMotivo(e.target.value as any)}
                className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white"
              >
                <option value="">Todos</option>
                <option value="deposit">Depósito</option>
                <option value="production">Fabricação</option>
                <option value="sale">Venda</option>
                <option value="admin">Retirada ADM</option>
                <option value="transfer">Transferência</option>
              </select>
            </label>

            <label className="text-sm">
              Baú
              <select
                value={filtroBau}
                onChange={(e) => setFiltroBau(e.target.value)}
                className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white"
              >
                <option value="">Todos</option>
                {baus.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              Início
              <input
                type="date"
                value={filtroInicio}
                onChange={(e) => setFiltroInicio(e.target.value)}
                className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
              />
            </label>

            <label className="text-sm">
              Fim
              <input
                type="date"
                value={filtroFim}
                onChange={(e) => setFiltroFim(e.target.value)}
                className="mt-1 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <label className="text-sm">
              Mostrar
              <select
                value={limiteLista}
                onChange={(e) => setLimiteLista(Number(e.target.value))}
                className="ml-2 border border-gray-300 rounded-xl px-3 py-2 text-sm bg-white"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="p-2">Data/Hora</th>
                  <th className="p-2">Tipo</th>
                  <th className="p-2">Motivo</th>
                  <th className="p-2">Produto</th>
                  <th className="p-2">Quantidade</th>
                  <th className="p-2">Baú</th>
                  <th className="p-2">Por</th>
                  {canDeleteMov && <th className="p-2">Ações</th>}
                </tr>
              </thead>
              <tbody>
                {movimentosFiltrados.length === 0 && (
                  <tr>
                    <td className="p-3 text-gray-500" colSpan={canDeleteMov ? 8 : 7}>
                      Nenhum movimento.
                    </td>
                  </tr>
                )}
                {movimentosFiltrados.map((m) => {
                  const dt = m.createdAt?.toDate?.() ? (m.createdAt.toDate() as Date) : new Date(0);
                  const expanded = !!expand[m.id];
                  const isTransfer = m.reason === 'transfer';
                  return (
                    <tr key={m.id} className="border-t align-top">
                      <td className="p-2 whitespace-nowrap">
                        <button className="underline underline-offset-2" onClick={() => toggleExpand(m.id)}>
                          {dt.getTime() > 0 ? fmtDateTime(m.createdAt) : '—'}
                        </button>
                        {expanded && m.reason === 'admin' && (
                          <div className="mt-2 text-xs text-gray-600">
                            <div className="font-medium">Obs:</div>
                            <div>{m.note || '—'}</div>
                          </div>
                        )}
                      </td>

                      {/* Tipo: Transferência recebe cor conforme origem/destino */}
                      <td className="p-2">
                        {isTransfer ? (
                          m.type === 'in' ? (
                            <span className="inline-block rounded-lg px-2 py-0.5 border border-green-300 text-green-700">
                              Transferência (destino)
                            </span>
                          ) : (
                            <span className="inline-block rounded-lg px-2 py-0.5 border border-red-300 text-red-700">
                              Transferência (origem)
                            </span>
                          )
                        ) : m.type === 'in' ? (
                          <span className="inline-block rounded-lg px-2 py-0.5 border border-green-300 text-green-700">
                            Entrada
                          </span>
                        ) : (
                          <span className="inline-block rounded-lg px-2 py-0.5 border border-red-300 text-red-700">
                            Saída
                          </span>
                        )}
                      </td>

                      <td className="p-2 capitalize">{m.reason}</td>
                      <td className="p-2">{m.produtoNome || '—'}</td>
                      <td className="p-2 font-semibold">{Number(m.quantity || 0).toLocaleString()}</td>
                      <td className="p-2">{m.bauName || '—'}</td>
                      <td className="p-2">{m.createdByName}</td>
                      {canDeleteMov && (
                        <td className="p-2">
                          <button
                            onClick={() => handleDeleteMovement(m)}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 border text-xs border-red-300 text-red-700 hover:bg-red-50"
                          >
                            <TrashIcon className="w-4 h-4" />
                            Excluir
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* Modal Apagar Tudo */}
      {confirmAllOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmAllOpen(false)} />
          <div className="relative max-w-md w-[95%] mx-auto mt-24 bg-white rounded-xl p-5 shadow-xl">
            <h3 className="text-lg font-semibold">Apagar TUDO</h3>
            <p className="text-sm text-gray-600 mt-2">
              Esta ação irá remover <b>todo o histórico</b> e zerar o estoque. Digite <b>confirma</b> no campo abaixo para confirmar.
            </p>
            <input
              value={confirmWord}
              onChange={(e) => setConfirmWord(e.target.value)}
              className="mt-3 w-full border border-gray-300 rounded-xl px-3 py-2 text-sm"
              placeholder='Digite "confirma"'
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmAllOpen(false)}
                className="px-3 py-2 rounded border hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={performWipeAll}
                className="px-3 py-2 rounded bg-red-600 text-white hover:bg-red-700"
              >
                Apagar tudo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
