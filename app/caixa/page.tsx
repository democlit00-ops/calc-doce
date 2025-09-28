"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/ui/sidebar";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, User as FbUser } from "firebase/auth";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  addDoc,
  serverTimestamp,
  Timestamp,
  deleteDoc,
  doc,
  writeBatch,
  startAfter,
} from "firebase/firestore";
import {
  BanknotesIcon,
  ArrowUpCircleIcon,
  ArrowDownCircleIcon,
  FunnelIcon,
  TrashIcon,
  CheckCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";

/* =========================
   Tipos e helpers
========================= */
type LoggedUserLocal = {
  id: string;
  uid: string;
  nome: string;
  email: string;
  discord?: string;
  passaport?: string;
  roleLevel: number;
  pasta?: string;
};

type Origem = "vendas" | "acoes" | "manual";
type Tipo = "entrada" | "saida";

type Movimento = {
  id: string;
  origem: Origem;
  tipo: Tipo;
  valor: number;
  descricao: string;
  obs?: string | null;
  data: Timestamp;
  createdAt?: Timestamp;
  registradorUid: string;
  registradorNome: string;
  registradorRole: number;
  refType?: "acao" | "venda" | "ajuste" | "outro";
  refId?: string | null;
};

function toDateInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function endOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function fmtMoney(n: number) {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.round(n));
  return `${sign}$ ${abs.toLocaleString("pt-BR")}`;
}

/* =========================
   Página
========================= */
export default function CaixaPage() {
  const router = useRouter();
  const [activePage, setActivePage] = useState("caixa");

  const [fbUser, setFbUser] = useState<FbUser | null>(null);
  const [loggedUser, setLoggedUser] = useState<LoggedUserLocal | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  // form manual
  const [tipo, setTipo] = useState<Tipo>("entrada");
  const [valor, setValor] = useState<string>("");
  const [descricao, setDescricao] = useState<string>("");
  const [obs, setObs] = useState<string>("");
  const [dataStr, setDataStr] = useState<string>(toDateInputValue(new Date()));
  const [refType, setRefType] = useState<"acao" | "venda" | "ajuste" | "outro">("outro");
  const [refId, setRefId] = useState<string>("");

  // filtros
  const hoje = new Date();
  const trintaDiasAtras = new Date(hoje);
  trintaDiasAtras.setDate(hoje.getDate() - 30);

  const [fInicio, setFInicio] = useState<string>(toDateInputValue(trintaDiasAtras));
  const [fFim, setFFim] = useState<string>(toDateInputValue(hoje));
  const [fTipo, setFTipo] = useState<"todos" | Tipo>("todos");
  const [fOrigem, setFOrigem] = useState<"todas" | Origem>("todas");

  const [movs, setMovs] = useState<Movimento[]>([]);
  const [loadingMovs, setLoadingMovs] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // total geral (sem filtro)
  const [totalGeral, setTotalGeral] = useState<number>(0);
  const [loadingTotalGeral, setLoadingTotalGeral] = useState<boolean>(true);

  // zerar caixa
  const [clearingAll, setClearingAll] = useState(false);

  // auth + loggedUser localStorage
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setFbUser(user);
      setLoadingAuth(false);
      if (!user) {
        router.push("/login");
        return;
      }
      try {
        const raw = localStorage.getItem("loggedUser");
        if (raw) {
          const parsed = JSON.parse(raw) as LoggedUserLocal;
          setLoggedUser(parsed);
        } else {
          setLoggedUser({
            id: user.uid,
            uid: user.uid,
            nome: user.displayName || user.email || "Usuário",
            email: user.email || "",
            roleLevel: 9,
          });
        }
      } catch {
        // ignore
      }
    });
    return () => unsub();
  }, [router]);

  // gate de permissão (roles 1 e 2)
  const hasAccess = useMemo(() => {
    if (!loggedUser) return false;
    return loggedUser.roleLevel === 1 || loggedUser.roleLevel === 2;
  }, [loggedUser]);

  // buscar movimentos (período)
  const fetchMovs = async () => {
    if (!hasAccess) return;
    setLoadingMovs(true);
    setErrorMsg(null);
    try {
      const colRef = collection(db, "caixaMovimentos");
      const start = Timestamp.fromDate(startOfDay(new Date(fInicio)));
      const end = Timestamp.fromDate(endOfDay(new Date(fFim)));

      let qRef = query(
        colRef,
        where("data", ">=", start),
        where("data", "<=", end),
        orderBy("data", "desc"),
        limit(300)
      );

      const snap = await getDocs(qRef);
      let rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Movimento[];

      if (fTipo !== "todos") rows = rows.filter((r) => r.tipo === fTipo);
      if (fOrigem !== "todas") rows = rows.filter((r) => r.origem === fOrigem);

      setMovs(rows);
    } catch (e: any) {
      setErrorMsg(e.message || "Falha ao carregar movimentos.");
    } finally {
      setLoadingMovs(false);
    }
  };

  // total geral (sem filtro) paginado
  const fetchTotalGeral = async () => {
    if (!hasAccess) return;
    setLoadingTotalGeral(true);
    try {
      const colRef = collection(db, "caixaMovimentos");
      let soma = 0;
      let lastDoc: any = null;

      // paginação em lotes de 500 por 'data desc'
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const qRef = lastDoc
          ? query(colRef, orderBy("data", "desc"), startAfter(lastDoc), limit(500))
          : query(colRef, orderBy("data", "desc"), limit(500));
        const snap = await getDocs(qRef);
        if (snap.empty) break;

        snap.docs.forEach((d) => {
          const x = d.data() as any;
          const v = Math.round(Number(x?.valor || 0));
          soma += x?.tipo === "saida" ? -v : v;
        });

        lastDoc = snap.docs[snap.docs.length - 1];
        if (snap.size < 500) break;
      }

      setTotalGeral(soma);
    } catch (e: any) {
      setErrorMsg((prev) => prev ?? e?.message ?? "Falha ao calcular Total geral do caixa.");
      setTotalGeral(0);
    } finally {
      setLoadingTotalGeral(false);
    }
  };

  useEffect(() => {
    if (hasAccess) {
      fetchMovs();
      fetchTotalGeral();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAccess]);

  // totais do período filtrado
  const { totalEntradas, totalSaidas, saldo } = useMemo(() => {
    let entradas = 0,
      saidas = 0;
    for (const m of movs) {
      if (m.tipo === "entrada") entradas += m.valor || 0;
      else saidas += m.valor || 0;
    }
    return { totalEntradas: entradas, totalSaidas: saidas, saldo: entradas - saidas };
  }, [movs]);

  // lançamento manual (origem = "manual")
  const handleAddManual = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setOkMsg(null);
    if (!loggedUser || !hasAccess) return;

    const v = parseInt(valor.replace(/\D/g, ""), 10);
    if (!v || v <= 0) {
      setErrorMsg("Informe um valor inteiro maior que zero.");
      return;
    }
    if (!descricao.trim()) {
      setErrorMsg("Descreva o movimento.");
      return;
    }
    try {
      const d = new Date(dataStr);
      await addDoc(collection(db, "caixaMovimentos"), {
        origem: "manual",
        tipo,
        valor: v,
        descricao: descricao.trim(),
        obs: obs.trim() || null,
        data: Timestamp.fromDate(d),
        createdAt: serverTimestamp(),
        registradorUid: loggedUser.uid,
        registradorNome: loggedUser.nome || loggedUser.email || "Usuário",
        registradorRole: loggedUser.roleLevel,
        refType,
        refId: refId.trim() || null,
      });
      setOkMsg("Lançamento manual criado.");
      setValor("");
      setDescricao("");
      setObs("");
      setRefId("");

      await Promise.all([fetchMovs(), fetchTotalGeral()]);
    } catch (e: any) {
      setErrorMsg(e.message || "Erro ao lançar movimento.");
    }
  };

  // excluir (somente role 1)
  const canDelete = loggedUser?.roleLevel === 1;
  const handleDelete = async (id: string) => {
    if (!canDelete) return;
    if (!confirm("Excluir este movimento?")) return;
    try {
      await deleteDoc(doc(db, "caixaMovimentos", id));
      setOkMsg("Movimento excluído.");

      await Promise.all([fetchMovs(), fetchTotalGeral()]);
    } catch (e: any) {
      setErrorMsg(e.message || "Erro ao excluir.");
    }
  };

  // zerar caixa (somente role 1)
  const canClearAll = loggedUser?.roleLevel === 1;
  const handleClearAll = async () => {
    if (!canClearAll) return;
    const step1 = window.confirm(
      "Você está prestes a ZERAR todo o histórico do Caixa.\n\n" +
        "Isso NÃO apaga Vendas/Ações. É irreversível.\n\nDeseja continuar?"
    );
    if (!step1) return;
    const typed = window.prompt("Para confirmar, digite: ZERAR");
    if (typed !== "ZERAR") return;

    setClearingAll(true);
    setErrorMsg(null);
    setOkMsg(null);

    try {
      const colRef = collection(db, "caixaMovimentos");
      // loop em lotes de até 500
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const snap = await getDocs(query(colRef, limit(500)));
        if (snap.empty) break;

        const batch = writeBatch(db);
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }

      setOkMsg("Histórico do Caixa zerado com sucesso.");
      setMovs([]);
      setTotalGeral(0);
    } catch (e: any) {
      setErrorMsg(e?.message || "Falha ao zerar histórico.");
    } finally {
      setClearingAll(false);
      await Promise.all([fetchMovs(), fetchTotalGeral()]);
    }
  };

  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">
        Carregando...
      </div>
    );
  }
  if (!fbUser || !loggedUser) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-500">
        Faça login para acessar.
      </div>
    );
  }
  if (!hasAccess) {
    return (
      <div className="min-h-screen flex">
        <Sidebar activePage={activePage} setActivePage={setActivePage} />
        <main className="flex-1 p-4 md:p-6">
          <div className="max-w-4xl mx-auto">
            <div className="rounded-2xl border bg-white p-6">
              <h1 className="text-lg font-semibold mb-2">Sem permissão</h1>
              <p className="text-sm text-gray-600">
                A página <b>Caixa</b> é restrita às roles <b>1</b> e <b>2</b>.
              </p>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-[#f5f7fb]">
      <Sidebar activePage={activePage} setActivePage={setActivePage} />
      <main className="flex-1 p-4 md:p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Header + botão à direita */}
          <header className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl border bg-white flex items-center justify-center">
                <BanknotesIcon className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-xl md:text-2xl font-bold">Caixa</h1>
                <p className="text-sm text-gray-600">
                  Entradas e saídas de <b>Vendas</b>, <b>Ações</b> e lançamentos <b>Manuais</b>.
                </p>
              </div>
            </div>

            {canClearAll && (
              <button
                onClick={handleClearAll}
                disabled={clearingAll}
                className="rounded-xl border bg-white px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
                title="Zerar todos os lançamentos do Caixa"
              >
                {clearingAll ? "Limpando…" : "Zerar caixa"}
              </button>
            )}
          </header>

          {/* Badge do Total geral (sem filtro) */}
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-sm shadow-sm">
              <BanknotesIcon className="w-4 h-4 text-emerald-700" />
              <span className="text-gray-600">Total geral do caixa:</span>
              <span className={`font-semibold ${totalGeral >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                {loadingTotalGeral ? "calculando..." : fmtMoney(totalGeral)}
              </span>
            </span>
          </div>

          {/* Totais (período) */}
          <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-2xl border bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Entradas (período)</span>
                <ArrowUpCircleIcon className="w-5 h-5" />
              </div>
              <div className="mt-2 text-2xl font-semibold">{fmtMoney(totalEntradas)}</div>
            </div>
            <div className="rounded-2xl border bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Saídas (período)</span>
                <ArrowDownCircleIcon className="w-5 h-5" />
              </div>
              <div className="mt-2 text-2xl font-semibold">{fmtMoney(totalSaidas)}</div>
            </div>
            <div className="rounded-2xl border bg-white p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Saldo (período)</span>
                <CheckCircleIcon className="w-5 h-5" />
              </div>
              <div
                className={`mt-2 text-2xl font-semibold ${
                  saldo >= 0 ? "text-emerald-600" : "text-rose-600"
                }`}
              >
                {fmtMoney(saldo)}
              </div>
            </div>
          </section>

          {/* Alerts */}
          {(errorMsg || okMsg) && (
            <div
              className={`rounded-2xl border p-3 flex items-start gap-2 ${
                errorMsg ? "bg-rose-50 border-rose-200" : "bg-emerald-50 border-emerald-200"
              }`}
            >
              {errorMsg ? (
                <XMarkIcon className="w-5 h-5 mt-0.5" />
              ) : (
                <CheckCircleIcon className="w-5 h-5 mt-0.5" />
              )}
              <div className="text-sm">{errorMsg || okMsg}</div>
            </div>
          )}

          {/* Lançamento manual */}
          <section className="rounded-2xl border bg-white p-4 md:p-6">
            <h2 className="text-lg font-semibold mb-3">Novo lançamento (manual)</h2>
            <form onSubmit={handleAddManual} className="grid grid-cols-1 md:grid-cols-8 gap-3">
              <div className="md:col-span-2">
                <label className="text-xs text-gray-600">Tipo</label>
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as Tipo)}
                  className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                >
                  <option value="entrada">Entrada</option>
                  <option value="saida">Saída</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-600">Valor (inteiro)</label>
                <input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="Ex: 500"
                  value={valor}
                  onChange={(e) => setValor(e.target.value.replace(/[^\d]/g, ""))}
                  className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-600">Data</label>
                <input
                  type="date"
                  value={dataStr}
                  onChange={(e) => setDataStr(e.target.value)}
                  className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-600">Descrição</label>
                <input
                  placeholder="Ex: Ajuste de caixa"
                  value={descricao}
                  onChange={(e) => setDescricao(e.target.value)}
                  className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                />
              </div>

              <div className="md:col-span-8">
                <label className="text-xs text-gray-600">Observação (opcional)</label>
                <input
                  placeholder="Obs livre"
                  value={obs}
                  onChange={(e) => setObs(e.target.value)}
                  className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                />
              </div>

              <div className="md:col-span-3">
                <label className="text-xs text-gray-600">Referência</label>
                <select
                  value={refType}
                  onChange={(e) => setRefType(e.target.value as any)}
                  className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                >
                  <option value="outro">Outro</option>
                  <option value="acao">Ação</option>
                  <option value="venda">Venda</option>
                  <option value="ajuste">Ajuste</option>
                </select>
              </div>
              <div className="md:col-span-3">
                <label className="text-xs text-gray-600">Ref. ID (opcional)</label>
                <input
                  placeholder="ID relacionado"
                  value={refId}
                  onChange={(e) => setRefId(e.target.value)}
                  className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                />
              </div>

              <div className="md:col-span-2 flex items-end">
                <button
                  type="submit"
                  className="rounded-xl px-4 py-2 border bg-black text-white w-full hover:opacity-90"
                >
                  Lançar
                </button>
              </div>
            </form>
          </section>

          {/* Filtros */}
          <section className="rounded-2xl border bg-white p-4 md:p-6">
            <div className="flex items-center gap-2 mb-3">
              <FunnelIcon className="w-5 h-5" />
              <h2 className="text-lg font-semibold">Filtros</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-8 gap-3">
              <div className="md:col-span-2">
                <label className="text-xs text-gray-600">Início</label>
                <input
                  type="date"
                  value={fInicio}
                  onChange={(e) => setFInicio(e.target.value)}
                  className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-600">Fim</label>
                <input
                  type="date"
                  value={fFim}
                  onChange={(e) => setFFim(e.target.value)}
                  className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-600">Tipo</label>
                <select
                  value={fTipo}
                  onChange={(e) => setFTipo(e.target.value as any)}
                  className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                >
                  <option value="todos">Todos</option>
                  <option value="entrada">Entradas</option>
                  <option value="saida">Saídas</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-gray-600">Origem</label>
                <select
                  value={fOrigem}
                  onChange={(e) => setFOrigem(e.target.value as any)}
                  className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                >
                  <option value="todas">Todas</option>
                  <option value="vendas">Vendas</option>
                  <option value="acoes">Ações</option>
                  <option value="manual">Manuais</option>
                </select>
              </div>

              <div className="md:col-span-8">
                <button
                  onClick={fetchMovs}
                  className="rounded-xl px-4 py-2 border bg-white hover:bg-gray-50"
                >
                  {loadingMovs ? "Carregando..." : "Aplicar filtros"}
                </button>
              </div>
            </div>
          </section>

          {/* Lista */}
          <section className="rounded-2xl border bg-white overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h2 className="text-lg font-semibold">Movimentações</h2>
              <span className="text-sm text-gray-500">
                {loadingMovs ? "Carregando..." : `${movs.length} registros`}
              </span>
            </div>

            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="text-left p-3">Data</th>
                    <th className="text-left p-3">Origem</th>
                    <th className="text-left p-3">Tipo</th>
                    <th className="text-left p-3">Descrição</th>
                    <th className="text-left p-3">Obs</th>
                    <th className="text-left p-3">Valor</th>
                    <th className="text-left p-3">Registrador</th>
                    <th className="text-left p-3">Ref</th>
                    {canDelete && <th className="text-left p-3">Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {movs.map((m) => {
                    const d = m.data?.toDate ? m.data.toDate() : new Date();
                    const tipoBadge =
                      m.tipo === "entrada"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-rose-50 text-rose-700 border-rose-200";
                    return (
                      <tr key={m.id} className="border-t">
                        <td className="p-3 whitespace-nowrap">
                          {d.toLocaleDateString("pt-BR")}
                        </td>
                        <td className="p-3 capitalize">{m.origem}</td>
                        <td className="p-3">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${tipoBadge}`}
                          >
                            {m.tipo === "entrada" ? (
                              <ArrowUpCircleIcon className="w-4 h-4" />
                            ) : (
                              <ArrowDownCircleIcon className="w-4 h-4" />
                            )}
                            {m.tipo === "entrada" ? "Entrada" : "Saída"}
                          </span>
                        </td>
                        <td className="p-3">{m.descricao}</td>
                        <td className="p-3">{m.obs || "-"}</td>
                        <td className="p-3 font-medium">
                          {m.tipo === "saida" ? "-" : ""}
                          {fmtMoney(m.valor)}
                        </td>
                        <td className="p-3">
                          {m.registradorNome} (#{m.registradorRole})
                        </td>
                        <td className="p-3">
                          {m.refType ? `${m.refType}${m.refId ? `: ${m.refId}` : ""}` : "-"}
                        </td>
                        {canDelete && (
                          <td className="p-3">
                            <button
                              onClick={() => handleDelete(m.id)}
                              className="inline-flex items-center gap-1 rounded-xl border px-2 py-1 hover:bg-gray-50"
                              title="Excluir"
                            >
                              <TrashIcon className="w-4 h-4" />
                              Excluir
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {movs.length === 0 && !loadingMovs && (
                    <tr>
                      <td className="p-6 text-center text-gray-500" colSpan={canDelete ? 9 : 8}>
                        Nenhum movimento encontrado no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <p className="text-xs text-gray-500">
            Dica: por padrão busco os últimos 30 dias. Ajuste os filtros para outro período.
          </p>
        </div>
      </main>
    </div>
  );
}
