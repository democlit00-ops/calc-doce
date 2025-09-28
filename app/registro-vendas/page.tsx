"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/ui/sidebar";
import { Input, Button } from "@/components/ui";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  addDoc,
  deleteDoc,
  Timestamp,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";
import { TrashIcon } from "@heroicons/react/24/outline";

/* ======================= Tipos ======================= */
type LoggedUserLocal = {
  id: string;
  uid: string;
  nome: string;
  email: string;
  roleLevel: number;
};

type Produto = {
  id: string;
  nome: string;
  imagemUrl?: string;
};

type Bau = {
  id: string;
  name: string;
  createdAt?: any;
};

type Venda = {
  id: string;
  createdAt?: any;
  createdByUid: string;
  createdByNome: string;
  produtoId?: string | null;
  produtoNome?: string | null;
  bauId?: string | null;
  bauNome?: string | null;
  quantidade: number;
  valorTotal: number;
  valorPorUnidade: number;
  cliente?: string;
};

type Movement = {
  id: string;
  type: "in" | "out";
  reason: "deposit" | "production" | "sale" | "admin" | "transfer";
  quantity: number;
  bauId?: string | null;
  bauName?: string | null;
  createdByUid: string;
  createdByName: string;
  roleLevel: number;
  note?: string;
  createdAt?: any;
  produtoId?: string | null;
  produtoNome?: string | null;
};

/* ======================= Helpers ======================= */
function formatMoneyNoCents(n: number) {
  const inteiro = Math.round(n || 0);
  return `$ ${inteiro.toLocaleString("pt-BR")}`;
}

function formatDateTime(ts?: any) {
  if (!ts) return "-";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("pt-BR", { timeZone: "America/Bahia" });
}

/* ======================= Página ======================= */
export default function RegistroVendasPage() {
  const router = useRouter();
  const [activePage, setActivePage] = useState("registro-vendas");
  const [user, setUser] = useState<LoggedUserLocal | null>(null);

  // Acesso
  const [canAccess, setCanAccess] = useState(false); // roles 1–5
  const [canSeeAll, setCanSeeAll] = useState(false); // roles 1–2
  const [canDelete, setCanDelete] = useState(false); // roles 1–2

  // Produtos / seleção
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [selectedProdId, setSelectedProdId] = useState<string>("");

  // Baus e movimentos (para calcular saldo por baú do produto selecionado)
  const [baus, setBaus] = useState<Bau[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loadingInfra, setLoadingInfra] = useState(true);

  // Form venda
  const [produtoId, setProdutoId] = useState(""); // sincronizado com selectedProdId
  const [bauId, setBauId] = useState("");
  const [quantidade, setQuantidade] = useState<number>(0);
  const [valorTotal, setValorTotal] = useState<number>(0);
  const [cliente, setCliente] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Lista / filtro
  const [vendas, setVendas] = useState<Venda[]>([]);
  const [loadingVendas, setLoadingVendas] = useState(true);
  const [limitRows, setLimitRows] = useState(50);

  /* ======================= Auth + Perfil ======================= */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        router.push("/login");
        return;
      }
      const raw = localStorage.getItem("loggedUser");
      if (raw) {
        const parsed = JSON.parse(raw) as LoggedUserLocal;
        setUser(parsed);
        const role = parsed.roleLevel || 0;
        const access = role >= 1 && role <= 5;
        setCanAccess(access);
        setCanSeeAll(role === 1 || role === 2);
        setCanDelete(role === 1 || role === 2);
      } else {
        const uref = doc(db, "users", fbUser.uid);
        const usnap = await getDoc(uref);
        if (usnap.exists()) {
          const data = usnap.data() as any;
          const parsed: LoggedUserLocal = {
            id: fbUser.uid,
            uid: fbUser.uid,
            nome: data.nome || fbUser.email || "Usuário",
            email: fbUser.email || "",
            roleLevel: data.roleLevel || data.role || 6,
          };
          localStorage.setItem("loggedUser", JSON.stringify(parsed));
          setUser(parsed);
          const role = parsed.roleLevel || 0;
          const access = role >= 1 && role <= 5;
          setCanAccess(access);
          setCanSeeAll(role === 1 || role === 2);
          setCanDelete(role === 1 || role === 2);
        } else {
          setUser(null);
        }
      }
    });
    return () => unsub();
  }, [router]);

  /* ======================= Infraestrutura (baus, movimentos, produtos) ======================= */
  useEffect(() => {
    if (!canAccess) return;

    setLoadingInfra(true);

    const unsubscribers: Array<() => void> = [];

    // Baús (nome e id)
    const unsubBaus = onSnapshot(
      query(collection(db, "baus"), orderBy("createdAt", "asc")),
      (snap) => {
        const list: Bau[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          list.push({ id: d.id, name: data.name, createdAt: data.createdAt });
        });
        setBaus(list);
      }
    );
    unsubscribers.push(unsubBaus);

    // Movimentos (para calcular saldo por baú do produto)
    const unsubMov = onSnapshot(
      query(collection(db, "stock_movements"), orderBy("createdAt", "desc")),
      (snap) => {
        const arr: Movement[] = [];
        snap.forEach((d) => {
          const x = d.data() as any;
          arr.push({
            id: d.id,
            type: x.type,
            reason: x.reason,
            quantity: Number(x.quantity || 0),
            bauId: x.bauId ?? null,
            bauName: x.bauName ?? null,
            createdByUid: x.createdByUid,
            createdByName: x.createdByName,
            roleLevel: Number(x.roleLevel || 5),
            note: x.note || "",
            createdAt: x.createdAt,
            produtoId: x.produtoId ?? null,
            produtoNome: x.produtoNome ?? null,
          });
        });
        setMovements(arr);
        setLoadingInfra(false);
      }
    );
    unsubscribers.push(unsubMov);

    // Produtos:
    (async () => {
      const uniq: Record<string, Produto> = {};

      // 1) 'produtos'
      try {
        const snap = await getDocs(collection(db, "produtos"));
        snap.forEach((d) => {
          const data = d.data() as any;
          if (data?.nome) {
            uniq[d.id] = { id: d.id, nome: data.nome, imagemUrl: data.imagemUrl || "" };
          }
        });
      } catch {}

      // 2) 'produtosFarm' (fallback)
      if (Object.keys(uniq).length === 0) {
        try {
          const snap = await getDocs(collection(db, "produtosFarm"));
          snap.forEach((d) => {
            const data = d.data() as any;
            if (data?.nome) {
              uniq[d.id] = { id: d.id, nome: data.nome, imagemUrl: data.imagemUrl || "" };
            }
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
          uniq[`nome:${nome}`] = { id: `nome:${nome}`, nome };
        });
      }

      const list = Object.values(uniq);
      setProdutos(list);
      if (!selectedProdId && list.length > 0) {
        setSelectedProdId(list[0].id);
        setProdutoId(list[0].id);
      }
    })();

    return () => {
      unsubscribers.forEach((u) => u && u());
    };
  }, [canAccess]); // eslint-disable-line

  const selectedProduto = useMemo(
    () => produtos.find((p) => p.id === selectedProdId) || null,
    [produtos, selectedProdId]
  );

  /* ======================= Saldos por baú do produto selecionado ======================= */
  const movsDoProduto = useMemo(() => {
    if (!selectedProdId) return [] as Movement[];
    if (selectedProdId.startsWith("nome:")) {
      const nome = selectedProdId.slice(5);
      return (Array.isArray(movements) ? movements : []).filter(
        (m) => (m.produtoNome || "") === nome
      );
    }
    return (Array.isArray(movements) ? movements : []).filter(
      (m) => m.produtoId === selectedProdId
    );
  }, [movements, selectedProdId]);

  const saldoProdutoPorBau = useMemo(() => {
    const map = new Map<string, { name: string; saldo: number }>();
    baus.forEach((b) => map.set(b.id, { name: b.name, saldo: 0 }));
    movsDoProduto.forEach((m) => {
      if (!m.bauId) return;
      const rec = map.get(m.bauId);
      if (!rec) return;
      if (m.type === "in") rec.saldo += Number(m.quantity || 0);
      else rec.saldo -= Number(m.quantity || 0);
    });
    return Array.from(map.entries()).map(([id, v]) => ({ id, ...v }));
  }, [baus, movsDoProduto]);

  const estoqueTotalProduto = useMemo(
    () => saldoProdutoPorBau.reduce((acc, b) => acc + Number(b.saldo || 0), 0),
    [saldoProdutoPorBau]
  );

  const saldoBauSelecionado = useMemo(() => {
    const rec = saldoProdutoPorBau.find((x) => x.id === bauId);
    return Number(rec?.saldo || 0);
  }, [saldoProdutoPorBau, bauId]);

  /* ======================= Vendas stream (minhas x todas) ======================= */
  useEffect(() => {
    if (!user || !canAccess) return;

    setLoadingVendas(true);
    const vendasRef = collection(db, "vendas");
    const qAll = query(vendasRef, orderBy("createdAt", "desc"), limit(limitRows));
    const qMine = query(
      vendasRef,
      where("createdByUid", "==", user.uid),
      orderBy("createdAt", "desc"),
      limit(limitRows)
    );

    const unsub = onSnapshot(
      canSeeAll ? qAll : qMine,
      (snap) => {
        const arr: Venda[] = [];
        snap.forEach((d) => {
          const data = d.data() as any;
          arr.push({
            id: d.id,
            createdAt: data.createdAt,
            createdByUid: data.createdByUid,
            createdByNome: data.createdByNome,
            produtoId: data.produtoId ?? null,
            produtoNome: data.produtoNome ?? null,
            bauId: data.bauId ?? null,
            bauNome: data.bauNome ?? null,
            quantidade: Number(data.quantidade || 0),
            valorTotal: Math.round(Number(data.valorTotal || 0)),
            valorPorUnidade: Math.round(Number(data.valorPorUnidade || 0)),
            cliente: data.cliente || "",
          });
        });
        setVendas(arr);
        setLoadingVendas(false);
      },
      (err) => {
        console.error(err);
        setErrorMsg("Falha ao carregar vendas.");
        setLoadingVendas(false);
      }
    );

    return () => unsub();
  }, [user, canAccess, canSeeAll, limitRows]);

  /* ======================= Registrar Venda + Caixa ======================= */
  async function handleRegistrarVenda() {
    try {
      setErrorMsg("");
      if (!user || !canAccess) {
        setErrorMsg("Sem permissão.");
        return;
      }
      if (!selectedProdId) {
        setErrorMsg("Selecione um produto.");
        return;
      }
      if (!bauId) {
        setErrorMsg("Selecione o baú de origem.");
        return;
      }
      if (quantidade <= 0) {
        setErrorMsg("Informe uma quantidade válida.");
        return;
      }
      if (valorTotal <= 0) {
        setErrorMsg("Informe o valor total (inteiro, sem centavos).");
        return;
      }

      // Regra: não permitir vender acima do saldo do BAÚ para o produto selecionado
      if (quantidade > saldoBauSelecionado) {
        setErrorMsg(
          `Quantidade maior que o saldo do baú selecionado. Saldo disponível: ${saldoBauSelecionado}.`
        );
        return;
      }

      setSubmitting(true);

      // Dados consolidados
      const prodInfo = selectedProduto
        ? {
            produtoId: selectedProdId.startsWith("nome:") ? null : selectedProdId,
            produtoNome: selectedProduto.nome,
          }
        : { produtoId: null, produtoNome: null };

      const bau = baus.find((b) => b.id === bauId);

      // 1) Debita o estoque via MOVIMENTO (tipo 'out', motivo 'sale')
      await addDoc(collection(db, "stock_movements"), {
        type: "out",
        reason: "sale",
        quantity: Number(quantidade),
        bauId,
        bauName: bau?.name || null,
        createdByUid: user.uid,
        createdByName: user.nome || "Usuário",
        roleLevel: user.roleLevel || 5,
        createdAt: serverTimestamp(),
        produtoId: prodInfo.produtoId,
        produtoNome: prodInfo.produtoNome,
        note: cliente?.trim() ? `Venda para: ${cliente.trim()}` : "",
      });

      // 2) Registra o documento de venda (histórico de vendas)
      const vpu = Math.floor(Number(valorTotal) / Number(quantidade));
      const vendaRef = await addDoc(collection(db, "vendas"), {
        createdAt: serverTimestamp(),
        createdByUid: user.uid,
        createdByNome: user.nome || "Usuário",
        produtoId: prodInfo.produtoId,
        produtoNome: prodInfo.produtoNome,
        bauId,
        bauNome: bau?.name || bauId,
        quantidade: Number(quantidade),
        valorTotal: Math.round(valorTotal),
        valorPorUnidade: vpu,
        cliente: cliente?.trim() || "",
      });

      // 3) (att para Caixa) — cria ENTRADA no caixaMovimentos
      await addDoc(collection(db, "caixaMovimentos"), {
        origem: "vendas",
        tipo: "entrada",
        valor: Math.round(valorTotal),
        descricao: prodInfo.produtoNome ? `Venda: ${prodInfo.produtoNome}` : "Venda",
        obs: cliente?.trim() ? `Cliente: ${cliente.trim()} | Qtd: ${quantidade}` : `Qtd: ${quantidade}`,
        // Para aparecer no período correto: usa a data do momento da venda
        data: Timestamp.now(),
        createdAt: serverTimestamp(),
        registradorUid: user.uid,
        registradorNome: user.nome || "Usuário",
        registradorRole: user.roleLevel || 5,
        refType: "venda",
        refId: vendaRef.id,
      });

      // Limpa form (mantém produto/baú para várias seguidas)
      setQuantidade(0);
      setValorTotal(0);
      setCliente("");
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message || "Falha ao registrar venda.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExcluirVenda(venda: Venda) {
    if (!canDelete) return;
    const ok = confirm(
      `Excluir a venda de ${venda.quantidade}x ${venda.produtoNome ?? "Produto"} do baú ${
        venda.bauNome ?? "-"
      }?\n\nAtenção: isso NÃO repõe o estoque automaticamente.`
    );
    if (!ok) return;

    try {
      await deleteDoc(doc(db, "vendas", venda.id));
      // 🔒 regra do cliente: NÃO remover do caixa ao excluir a venda
    } catch (e) {
      console.error(e);
      alert("Falha ao excluir a venda.");
    }
  }

  /* ======================= Render ======================= */

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="p-6">Carregando usuário...</div>
      </div>
    );
  }

  if (!canAccess) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Sidebar activePage={activePage} setActivePage={setActivePage} />
        <div className="p-6">
          <h1 className="text-2xl font-semibold mb-2">Registro de Vendas</h1>
          <p className="text-red-600">Seu nível de acesso não permite entrar nesta página.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f7fb] flex">
      <Sidebar activePage={activePage} setActivePage={setActivePage} />
      <main className="flex-1 p-4 md:p-6">
        <div className="max-w-6xl mx-auto">
          {/* Cabeçalho com seletor de produto e imagem */}
          <header className="mb-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              {/* Imagem do produto no título */}
              {selectedProduto?.imagemUrl ? (
                <img
                  src={selectedProduto.imagemUrl}
                  alt={selectedProduto.nome}
                  className="w-10 h-10 rounded-lg object-cover border"
                />
              ) : (
                <div className="w-10 h-10 rounded-lg border bg-gray-100" />
              )}
              <div>
                <h1 className="text-2xl md:text-3xl font-bold">
                  Registro de Vendas — {selectedProduto?.nome || "Selecione um produto"}
                </h1>

                {/* Resumo dos saldos por baú do produto selecionado */}
                {!!selectedProdId && (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {saldoProdutoPorBau.map((b) => (
                      <span
                        key={b.id}
                        className="inline-flex items-center gap-1 rounded-full px-2 py-1 border border-gray-200 bg-white"
                        title={`Saldo de ${selectedProduto?.nome ?? "produto"} em ${b.name}`}
                      >
                        <span className="font-medium">{b.name}:</span>
                        <span>{Number(b.saldo || 0).toLocaleString()}</span>
                      </span>
                    ))}
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-1 border border-gray-200 bg-white">
                      <span className="font-medium">Total:</span>
                      <span>{estoqueTotalProduto.toLocaleString()}</span>
                    </span>
                  </div>
                )}
              </div>
            </div>

            <label className="text-sm">
              Produto
              <select
                className="ml-2 border rounded-lg p-2 bg-white"
                value={selectedProdId}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedProdId(val);
                  setProdutoId(val);
                  // reset de bau/quantidade quando troca de produto
                  setBauId("");
                  setQuantidade(0);
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
          </header>

          {/* Formulário */}
          <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 md:p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Nova venda</h2>

            {errorMsg && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700">
                {errorMsg}
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4">
              {/* Produto (somente leitura, espelhando o seletor) */}
              <div className="col-span-1">
                <label className="block text-sm font-medium mb-1">Produto</label>
                <select
                  className="w-full border rounded-lg p-2 bg-gray-50"
                  value={produtoId}
                  onChange={(e) => {
                    setProdutoId(e.target.value);
                    setSelectedProdId(e.target.value);
                    setBauId("");
                  }}
                >
                  {produtos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Estoque total (todos os baús):{" "}
                  <span className="font-semibold">{estoqueTotalProduto}</span>
                </p>
              </div>

              {/* Baú de origem (com saldo do produto) */}
              <div className="col-span-1">
                <label className="block text-sm font-medium mb-1">Baú de origem</label>
                <select
                  className="w-full border rounded-lg p-2"
                  value={bauId}
                  onChange={(e) => {
                    setBauId(e.target.value);
                    setQuantidade(0); // zera para evitar ficar > saldo
                  }}
                  disabled={!produtoId || loadingInfra}
                >
                  <option value="">{produtoId ? "Selecione" : "Escolha um produto primeiro"}</option>
                  {saldoProdutoPorBau.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} — saldo: {b.saldo.toLocaleString()}
                    </option>
                  ))}
                </select>
                {bauId && (
                  <p className="text-xs text-gray-500 mt-1">
                    Saldo no baú: <b>{saldoBauSelecionado.toLocaleString()}</b>
                  </p>
                )}
              </div>

              {/* Quantidade (clamp no saldo do baú) */}
              <div>
                <label className="block text-sm font-medium mb-1">Quantidade</label>
                <Input
                  type="number"
                  value={quantidade}
                  onChange={(e: any) => {
                    const val = Number(e.target.value || 0);
                    const max = Number(saldoBauSelecionado || 0);
                    setQuantidade(Math.max(0, Math.min(val, max)));
                  }}
                  placeholder="0"
                />
                {bauId && (
                  <p className="text-[11px] text-gray-500 mt-1">
                    Máximo permitido: {saldoBauSelecionado.toLocaleString()}
                  </p>
                )}
              </div>

              {/* Valor total (sem centavos) */}
              <div>
                <label className="block text-sm font-medium mb-1">Valor total (sem centavos)</label>
                <Input
                  type="number"
                  value={valorTotal}
                  onChange={(e: any) =>
                    setValorTotal(Math.max(0, Math.floor(Number(e.target.value || 0))))
                  }
                  placeholder="0"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Formato exibido: <span className="font-semibold">{formatMoneyNoCents(valorTotal)}</span>
                </p>
              </div>

              {/* Cliente (opcional) */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">Cliente (opcional)</label>
                <Input
                  type="text"
                  value={cliente}
                  onChange={(e: any) => setCliente(e.target.value)}
                  placeholder="Nome do cliente"
                />
              </div>
            </div>

            {/* Preview VPU */}
            <div className="mt-3 text-sm text-gray-700">
              {quantidade > 0 && valorTotal > 0 ? (
                <span>
                  Valor por unidade previsto:{" "}
                  <strong>{formatMoneyNoCents(Math.floor(valorTotal / quantidade))}</strong>
                </span>
              ) : (
                <span>Preencha quantidade e valor para ver o valor por unidade.</span>
              )}
            </div>

            <div className="mt-4">
              <Button
                onClick={handleRegistrarVenda}
                disabled={
                  submitting ||
                  loadingInfra ||
                  !produtoId ||
                  !bauId ||
                  quantidade <= 0 ||
                  valorTotal <= 0
                }
              >
                {submitting ? "Registrando..." : "Registrar venda"}
              </Button>
            </div>
          </section>

          {/* Lista / Filtro */}
          <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 md:p-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-semibold">Histórico de vendas {canSeeAll ? "(todas)" : "(minhas)"}</h2>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">Exibir</span>
                <select
                  className="border rounded-lg p-1.5 text-sm"
                  value={limitRows}
                  onChange={(e) => setLimitRows(Number(e.target.value))}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>

            {loadingVendas ? (
              <div className="py-6 text-gray-600">Carregando vendas…</div>
            ) : vendas.length === 0 ? (
              <div className="py-6 text-gray-600">Nenhuma venda encontrada.</div>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left bg-gray-50">
                      <th className="p-2">Data/Hora</th>
                      <th className="p-2">Quem registrou</th>
                      <th className="p-2">Produto</th>
                      <th className="p-2">Baú</th>
                      <th className="p-2">Qtd</th>
                      <th className="p-2">Valor</th>
                      <th className="p-2">Cliente</th>
                      <th className="p-2">Valor/Unid</th>
                      {canDelete && <th className="p-2">Ações</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {vendas.map((v) => (
                      <tr key={v.id} className="border-b last:border-b-0">
                        <td className="p-2 whitespace-nowrap">{formatDateTime(v.createdAt)}</td>
                        <td className="p-2">{v.createdByNome}</td>
                        <td className="p-2">{v.produtoNome || "-"}</td>
                        <td className="p-2">{v.bauNome || "-"}</td>
                        <td className="p-2">{v.quantidade}</td>
                        <td className="p-2">{formatMoneyNoCents(v.valorTotal)}</td>
                        <td className="p-2">{v.cliente || "-"}</td>
                        <td className="p-2">{formatMoneyNoCents(v.valorPorUnidade)}</td>
                        {canDelete && (
                          <td className="p-2">
                            <button
                              onClick={() => handleExcluirVenda(v)}
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 border text-red-600 border-red-300 hover:bg-red-50"
                              title="Excluir venda"
                            >
                              <TrashIcon className="w-4 h-4" />
                              Excluir
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
