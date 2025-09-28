"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/ui/sidebar";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
  Timestamp,
  DocumentData,
  QueryDocumentSnapshot,
  startAfter,
} from "firebase/firestore";
import { ChevronDownIcon, ArrowPathIcon, TrashIcon } from "@heroicons/react/24/outline";
import { sendAcoesWebhook } from "@/components/webhook/sendWebhook";

/* =========================
   MAPA DE HIERARQUIA
   1 - Admin Geral
   2 - Admin
   3 - Gerente de Ações
   4 - Gerente de Farm
   5 - Gerente de Vendas
   6 - Soldado
========================= */

type RoleLevel = 1 | 2 | 3 | 4 | 5 | 6;
const roleLabel = (r: number): string => {
  switch (r) {
    case 1: return "Admin Geral";
    case 2: return "Admin";
    case 3: return "Gerente de Ações";
    case 4: return "Gerente de Farm";
    case 5: return "Gerente de Vendas";
    default: return "Soldado";
  }
};
const roleSlug = (r: number):
  | "adminGeral" | "admin" | "gerenteAcoes" | "gerenteFarm" | "gerenteVendas" | "soldado" => {
  switch (r) {
    case 1: return "adminGeral";
    case 2: return "admin";
    case 3: return "gerenteAcoes";
    case 4: return "gerenteFarm";
    case 5: return "gerenteVendas";
    default: return "soldado";
  }
};

// 🔒 Acesso à página e criação: somente 1,2,4
const ROLE_PODE_ACESSAR: RoleLevel[] = [1, 2, 4];
const podeAcessar = (r: number) => ROLE_PODE_ACESSAR.includes(r as RoleLevel);
// 🔒 Excluir: somente 1,2
const podeExcluir = (r: number) => [1, 2].includes(r);

type PerfilUsuario = {
  uid: string;
  nome: string;
  roleLevel: RoleLevel;
};

type Membro = {
  uid: string;
  nome: string;
  roleLevel: RoleLevel;
  roleLabel: string;
  hierarquia: ReturnType<typeof roleSlug>;
};

type AcaoItem = {
  id: string;
  acao: string;
  winLose: "win" | "lose";
  valorGanho?: number | null;
  horario: { seconds: number; nanoseconds: number } | null;
  createdAt?: { seconds: number; nanoseconds: number } | null;
  membros?: Membro[];
  obs?: string | null;
};

const PAGE_SIZE = 10;

/** cores para tags de hierarquia */
const roleBadgeClass = (r: RoleLevel) => {
  switch (r) {
    case 1: return "bg-purple-100 text-purple-800 border-purple-200";
    case 2: return "bg-indigo-100 text-indigo-800 border-indigo-200";
    case 3: return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case 4: return "bg-cyan-100 text-cyan-800 border-cyan-200";
    case 5: return "bg-amber-100 text-amber-800 border-amber-200";
    default: return "bg-gray-100 text-gray-700 border-gray-200";
  }
};

const RoleBadge = ({ r, text }: { r: RoleLevel; text?: string }) => (
  <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border uppercase tracking-wide ${roleBadgeClass(r)}`}>
    <span className="w-2 h-2 rounded-full bg-current opacity-50" />
    {text ?? roleLabel(r)}
  </span>
);

/** Converte Date para string compatível com <input type="datetime-local"> (YYYY-MM-DDTHH:MM) */
const toLocalDatetimeInput = (d = new Date()) => {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
};

export default function RegistroAcoesPage() {
  const router = useRouter();
  const [activePage, setActivePage] = useState("Registro de Ações");
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);

  // controle de permissão
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null);

  // form
  const [showForm, setShowForm] = useState(false);
  const [acao, setAcao] = useState("");
  const [horario, setHorario] = useState<string>("");
  const [winLose, setWinLose] = useState<"win" | "lose">("win");
  const [valorGanho, setValorGanho] = useState<string>("");
  const [obs, setObs] = useState("");

  // seleção de membros
  const [buscaUser, setBuscaUser] = useState("");
  const [resultados, setResultados] = useState<PerfilUsuario[]>([]);
  const [membrosSel, setMembrosSel] = useState<Membro[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersErr, setUsersErr] = useState<string | null>(null);
  const reqTokenRef = useRef(0); // evita corrida de requisições

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // listagem
  const [minhasAcoes, setMinhasAcoes] = useState<AcaoItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [pageIndex, setPageIndex] = useState(0);
  const [cursors, setCursors] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]);
  const [hasMore, setHasMore] = useState(false);

  // expansão + exclusão
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [deletingIds, setDeletingIds] = useState<Record<string, boolean>>({});

  const topRef = useRef<HTMLDivElement | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);

  /* ============ AUTH ============ */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) {
        router.push("/dashboard");
        return;
      }
      setFirebaseUser(u);
    });
    return () => unsub();
  }, [router]);

  /* ============ CARREGAR PERFIL + GATE ============ */
  useEffect(() => {
    const carregarPerfil = async () => {
      if (!firebaseUser) return;
      try {
        const usersCol = collection(db, "users");
        const qUser = query(usersCol, where("uid", "==", firebaseUser.uid), limit(1));
        const snap = await getDocs(qUser);

        let nome = firebaseUser.email ?? "Usuário";
        let role: RoleLevel = 6;

        if (!snap.empty) {
          const d = snap.docs[0].data() as any;
          if (d?.nome) nome = d.nome;
          const n = Number(d?.roleLevel);
          if (!Number.isNaN(n) && n >= 1 && n <= 6) role = n as RoleLevel;
        }

        const p: PerfilUsuario = { uid: firebaseUser.uid, nome, roleLevel: role };

        // 🔒 Gate: só 1,2,4 entram; demais => dashboard
        if (!podeAcessar(p.roleLevel)) {
          router.push("/dashboard");
          return;
        }

        setPerfil(p);
      } catch {
        router.push("/dashboard");
      } finally {
        setCheckingAuth(false);
      }
    };
    carregarPerfil();
  }, [firebaseUser, router]);

  const isAdminLike = useMemo(() => (perfil ? [1, 2].includes(perfil.roleLevel) : false), [perfil]);
  const podeRegistrar = useMemo(() => (perfil ? podeAcessar(perfil.roleLevel) : false), [perfil]);
  const podeVerExcluir = useMemo(() => (perfil ? podeExcluir(perfil.roleLevel) : false), [perfil]);

  /* ============ HELPERS ============ */
  const formatDateTime = (stamp?: { seconds: number } | null) => {
    const s = stamp?.seconds ?? null;
    if (!s) return "-";
    const d = new Date(s * 1000);
    return d.toLocaleString("pt-BR");
  };

  const formatMoedaInteiro = (v: number | null | undefined) => {
    if (v == null) return "-";
    const int = Math.trunc(Number(v));
    return `$ ${int.toLocaleString("pt-BR")}`;
  };

  const extrairIndexUrl = (msg: string): string | null => {
    const m = msg.match(/https?:\/\/[^\s)]+/);
    return m ? m[0] : null;
  };

  const sortLocalDesempate = (arr: AcaoItem[]) => {
    return [...arr].sort((a, b) => {
      const ha = a.horario?.seconds ?? 0;
      const hb = b.horario?.seconds ?? 0;
      if (ha !== hb) return hb - ha;
      const ca = a.createdAt?.seconds ?? 0;
      const cb = b.createdAt?.seconds ?? 0;
      return cb - ca;
    });
  };

  /** Pega registrador (membros[0]) se existir */
  const getRegistrador = (a: AcaoItem) => {
    const m0 = Array.isArray(a.membros) && a.membros.length > 0 ? a.membros[0] : null;
    return m0;
  };

  /* ============ LISTAGEM (1/2: todas; outros: só as próprias) ============ */
  const fetchPage = async (page: number, resetCursors = false) => {
    if (!perfil) return;
    setListLoading(true);
    try {
      const colRef = collection(db, "acoes");
      const listarTodas = isAdminLike; // roles 1/2 veem todas

      let base =
        listarTodas
          ? query(colRef, orderBy("horario", "desc"), limit(PAGE_SIZE + 1))
          : query(
              colRef,
              where("registradoPor.uid", "==", perfil.uid),
              orderBy("horario", "desc"),
              limit(PAGE_SIZE + 1)
            );

      if (page > 0 && cursors[page - 1]) {
        base =
          listarTodas
            ? query(colRef, orderBy("horario", "desc"), startAfter(cursors[page - 1]!), limit(PAGE_SIZE + 1))
            : query(
                colRef,
                where("registradoPor.uid", "==", perfil.uid),
                orderBy("horario", "desc"),
                startAfter(cursors[page - 1]!),
                limit(PAGE_SIZE + 1)
              );
      }

      const snap = await getDocs(base);
      setHasMore(snap.docs.length > PAGE_SIZE);

      const docsPage = snap.docs.slice(0, PAGE_SIZE);
      const itens: AcaoItem[] = docsPage.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          acao: data?.acao ?? "",
          winLose: data?.winLose === "win" ? "win" : "lose",
          valorGanho: typeof data?.valorGanho === "number" ? Math.trunc(data.valorGanho) : null,
          horario: data?.horario ?? null,
          createdAt: data?.createdAt ?? null,
          membros: Array.isArray(data?.membros) ? data.membros : [],
          obs: data?.obs ?? null,
        };
      });

      setMinhasAcoes(sortLocalDesempate(itens));

      const last = docsPage[docsPage.length - 1] ?? null;
      setCursors((prev) => {
        const next = resetCursors ? Array(page + 1).fill(null) : [...prev];
        next[page] = last;
        return next;
      });
    } catch (e: any) {
      const url = typeof e?.message === "string" ? extrairIndexUrl(e.message) : null;
      if (url) {
        setHasMore(false);
        setMinhasAcoes([]);
        setErro(`Esta consulta precisa de um índice composto. Crie em: ${url}`);
      } else {
        setErro(e?.message ?? "Erro ao carregar ações.");
      }
    } finally {
      setListLoading(false);
    }
  };

  useEffect(() => {
    if (perfil) {
      setPageIndex(0);
      setCursors([null]);
      fetchPage(0, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil?.uid, isAdminLike]);

  const irParaProxima = () => {
    if (!hasMore || listLoading) return;
    const next = pageIndex + 1;
    setPageIndex(next);
    fetchPage(next);
    topRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const irParaAnterior = () => {
    if (pageIndex === 0 || listLoading) return;
    const prev = pageIndex - 1;
    setPageIndex(prev);
    fetchPage(prev);
    topRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  /* ============ BUSCAR USUÁRIOS (seletor) ============ */
  const buscarUsuarios = async (term: string) => {
    if (!perfil) return;
    const myToken = ++reqTokenRef.current;
    setUsersLoading(true);
    setUsersErr(null);

    try {
      // busca básica: ordena por nome
      const snap = await getDocs(query(collection(db, "users"), orderBy("nome", "asc"), limit(100)));
      let lista: PerfilUsuario[] = [];
      snap.forEach((d) => {
        const data = d.data() as any;
        const nome = data?.nome ?? data?.email ?? "(sem nome)";
        const n = Number(data?.roleLevel ?? 6);
        const role: RoleLevel = (!Number.isNaN(n) && n >= 1 && n <= 6) ? (n as RoleLevel) : 6;
        lista.push({ uid: data?.uid ?? d.id, nome, roleLevel: role });
      });

      // filtro por termo
      const t = term.trim().toLowerCase();
      if (t) lista = lista.filter((u) => u.nome.toLowerCase().includes(t));

      // remove já selecionados
      const selecionadosSet = new Set(membrosSel.map((m) => m.uid));
      lista = lista.filter((u) => !selecionadosSet.has(u.uid));

      // ordena por nome
      lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

      // evita condição de corrida
      if (reqTokenRef.current === myToken) {
        setResultados(lista);
      }
    } catch (err: any) {
      if (reqTokenRef.current === myToken) {
        setResultados([]);
        setUsersErr("Falha ao carregar membros. Tente novamente.");
      }
    } finally {
      if (reqTokenRef.current === myToken) {
        setUsersLoading(false);
      }
    }
  };

  // 1) carrega quando o form abre
  useEffect(() => {
    if (showForm) buscarUsuarios(buscaUser);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showForm]);

  // 2) debounce da busca + refiltra quando a seleção muda
  useEffect(() => {
    if (!showForm) return;
    const h = setTimeout(() => buscarUsuarios(buscaUser), 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buscaUser, membrosSel, showForm]);

  const addMembro = (u: PerfilUsuario) => {
    if (membrosSel.find((m) => m.uid === u.uid)) return;
    setMembrosSel((prev) => [
      ...prev,
      {
        uid: u.uid,
        nome: u.nome,
        roleLevel: u.roleLevel,
        roleLabel: roleLabel(u.roleLevel),
        hierarquia: roleSlug(u.roleLevel),
      },
    ]);
    setResultados((prev) => prev.filter((r) => r.uid !== u.uid));
  };

  const removeMembro = (uid: string) => {
    const toReturn = membrosSel.find((m) => m.uid === uid) || null;
    setMembrosSel((prev) => prev.filter((m) => m.uid !== uid));
    if (toReturn) {
      setResultados((prev) => {
        if (prev.some((p) => p.uid === toReturn.uid)) return prev;
        const novo: PerfilUsuario = {
          uid: toReturn.uid,
          nome: toReturn.nome,
          roleLevel: toReturn.roleLevel,
        };
        const arr = [...prev, novo];
        arr.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
        return arr;
      });
    }
  };

  /* ============ VALIDAR / SALVAR / WEBHOOK / CAIXA ============ */
  const validar = () => {
    if (!acao.trim()) return "Informe a Ação.";
    if (!horario) return "Informe o Horário.";
    if (!winLose) return "Selecione Win ou Lose.";
    if (valorGanho && isNaN(Number(valorGanho))) return "Valor ganho deve ser numérico.";
    return null;
  };

  const handleSalvar = async () => {
    setErro(null);
    setSuccessMsg(null);
    const err = validar();
    if (err) return setErro(err);
    if (!perfil) return setErro("Usuário não autenticado.");
    if (!podeRegistrar) return setErro("Sem permissão para registrar ações.");

    setSalvando(true);
    try {
      const registrador: Membro = {
        uid: perfil.uid,
        nome: perfil.nome,
        roleLevel: perfil.roleLevel,
        roleLabel: roleLabel(perfil.roleLevel),
        hierarquia: roleSlug(perfil.roleLevel),
      };
      const semRegistrador = membrosSel.filter((m) => m.uid !== registrador.uid);
      const membrosFinal: Membro[] = [registrador, ...semRegistrador];

      const horarioTs = Timestamp.fromDate(new Date(horario));
      const valorInt = valorGanho ? Math.trunc(Number(valorGanho)) : null;

      const docPayload = {
        acao: acao.trim(),
        winLose,
        valorGanho: valorInt,
        membros: membrosFinal,
        obs: obs.trim() || null,
        registradoPor: registrador,
        horario: horarioTs,
        createdAt: serverTimestamp(),
      };

      const acoesRef = await addDoc(collection(db, "acoes"), docPayload);

      // === (att para Caixa) — registra ENTRADA quando win e valor > 0 ===
      if (winLose === "win" && (valorInt ?? 0) > 0) {
        await addDoc(collection(db, "caixaMovimentos"), {
          origem: "acoes",
          tipo: "entrada",
          valor: Math.trunc(valorInt!),
          descricao: acao.trim() || "Ação (win)",
          obs: obs.trim() ? `Ação WIN — ${obs.trim()}` : "Ação WIN",
          // usa o horário da ação como data do movimento (para aparecer no período correto)
          data: horarioTs,
          createdAt: serverTimestamp(),
          registradorUid: perfil.uid,
          registradorNome: perfil.nome,
          registradorRole: perfil.roleLevel,
          refType: "acao",
          refId: acoesRef.id,
        });
      }

      // webhook (mantido)
      await sendAcoesWebhook({
        tipo: "registro_acao",
        ...docPayload,
        horarioISO: horarioTs.toDate().toISOString(),
        createdAtISO: new Date().toISOString(),
      });

      setAcao("");
      setHorario(toLocalDatetimeInput(new Date()));
      setWinLose("win");
      setValorGanho("");
      setObs("");
      setMembrosSel([]);
      setShowForm(false);
      setSuccessMsg("Ação criada com sucesso!");
      setPageIndex(0);
      setCursors([null]);
      await fetchPage(0, true);
      topRef.current?.scrollIntoView({ behavior: "smooth" });
      buscarUsuarios(buscaUser);
    } catch (e: any) {
      setErro(e?.message ?? "Erro ao salvar.");
    } finally {
      setSalvando(false);
    }
  };

  /* ============ EXCLUIR ============ */
  const handleExcluir = async (a: AcaoItem) => {
    if (!perfil || !podeVerExcluir) return;
    const ok = window.confirm(`Excluir a ação "${a.acao}"? Essa operação não pode ser desfeita.`);
    if (!ok) return;

    setDeletingIds((prev) => ({ ...prev, [a.id]: true }));
    try {
      await deleteDoc(doc(db, "acoes", a.id));

      // 🔒 regra do cliente: NÃO remove do caixa se a ação for excluída

      await sendAcoesWebhook({
        tipo: "exclusao_acao",
        docId: a.id,
        acao: a.acao,
        winLose: a.winLose,
        valorGanho: a.valorGanho ?? null,
        horarioISO: a.horario?.seconds ? new Date(a.horario.seconds * 1000).toISOString() : null,
        membros: Array.isArray(a.membros)
          ? a.membros.map((m) => ({ uid: m.uid, nome: m.nome, hierarquia: m.hierarquia }))
          : [],
        registradoPor: (() => {
          const reg = getRegistrador(a);
          return reg ? { uid: reg.uid, nome: reg.nome, hierarquia: reg.hierarquia } : undefined;
        })(),
        obs: a.obs ?? null,
        deletedBy: { uid: perfil.uid, nome: perfil.nome, hierarquia: roleSlug(perfil.roleLevel) },
        createdAtISO: new Date().toISOString(),
      });

      setMinhasAcoes((prev) => prev.filter((x) => x.id !== a.id));
    } catch (e: any) {
      setErro(e?.message ?? "Erro ao excluir a ação.");
    } finally {
      setDeletingIds((prev) => ({ ...prev, [a.id]: false }));
    }
  };

  /* ============ UI ============ */
  useEffect(() => {
    if (showForm && !horario) setHorario(toLocalDatetimeInput(new Date()));
  }, [showForm, horario]);

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f7fb] text-gray-700">
        <div className="animate-pulse opacity-80">Verificando permissões…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <div className="relative flex min-h-screen">
        {/* Sidebar */}
        <aside>
          <Sidebar activePage={activePage} setActivePage={setActivePage} />
        </aside>

        <main className="flex-1 p-4 md:p-10">
          <div ref={topRef} className="max-w-6xl mx-auto w-full">
            {/* Cabeçalho */}
            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5 mb-6">
              <h1 className="text-2xl md:text-3xl font-semibold text-gray-900">Registro de Ações</h1>
              <p className="text-gray-500">
                {isAdminLike
                  ? "Você está vendo todas as ações. Ordenado por horário (mais recentes primeiro)."
                  : "Você só vê as ações que registrou. Ordenado por horário (mais recentes primeiro)."}
              </p>
            </div>

            {/* sucesso/erro */}
            {successMsg && (
              <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 p-3">
                {successMsg}
              </div>
            )}
            {erro && (
              <div className="mb-6 rounded-xl border border-red-200 bg-red-50 text-red-800 p-3">
                {erro}
              </div>
            )}

            {/* Barra de ações */}
            <div className="flex items-center justify-end mb-4">
              <button
                onClick={() => {
                  setShowForm((v) => !v);
                  setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth" }), 0);
                }}
                className="rounded-xl bg-emerald-600 text-white px-4 py-2 font-medium shadow-sm hover:bg-emerald-500"
              >
                {showForm ? "Fechar formulário" : "Criar ação"}
              </button>
            </div>

            {/* LISTA */}
            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  {isAdminLike ? "Todas as ações" : "Minhas ações"}
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={irParaAnterior}
                    disabled={pageIndex === 0 || listLoading}
                    className="rounded-lg px-3 py-1.5 bg-gray-100 border border-gray-200 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                    title="Mais recentes"
                  >
                    ←
                  </button>
                  <button
                    onClick={irParaProxima}
                    disabled={!hasMore || listLoading}
                    className="rounded-lg px-3 py-1.5 bg-gray-100 border border-gray-200 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                    title="Mais antigas"
                  >
                    →
                  </button>
                </div>
              </div>

              {listLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-14 rounded-xl border border-gray-200 bg-gray-100 animate-pulse" />
                  ))}
                </div>
              ) : minhasAcoes.length === 0 ? (
                <div className="text-gray-600">Nenhuma ação encontrada.</div>
              ) : (
                <div className="space-y-2">
                  {minhasAcoes.map((a) => {
                    const win = a.winLose === "win";
                    const lineBg = win ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200";
                    const textTint = win ? "text-emerald-900" : "text-red-900";
                    const open = !!expanded[a.id];
                    const deleting = !!deletingIds[a.id];

                    const reg = getRegistrador(a);

                    return (
                      <div key={a.id} className={`rounded-xl overflow-hidden border ${lineBg}`}>
                        {/* Linha principal (clicável) */}
                        <button
                          onClick={() => setExpanded((prev) => ({ ...prev, [a.id]: !open }))}
                          className="w-full text-left"
                        >
                          <div className="flex items-center gap-6 md:gap-8 p-3">
                            {/* Nome (tag) */}
                            <div className={`shrink-0 ${textTint} font-semibold text-[15px] leading-tight`}>
                              {reg ? (
                                <span className="inline-flex items-center gap-2">
                                  <span className="truncate max-w-[32ch]">{reg.nome}</span>
                                  <RoleBadge r={reg.roleLevel} />
                                </span>
                              ) : (
                                <span>(sem registrador)</span>
                              )}
                            </div>

                            {/* Ação */}
                            <div className="min-w-0 flex-1">
                              <div className={`truncate ${textTint} font-semibold text-[15px] leading-tight`}>
                                {a.acao || "(sem título)"}
                              </div>
                            </div>

                            {/* Data/Hora */}
                            <div className="shrink-0 text-gray-700 text-sm font-medium">
                              {formatDateTime(a.horario)}
                            </div>

                            {/* Valor + chevron */}
                            <div className="shrink-0 flex items-center gap-3">
                              <div className="text-gray-800 text-sm font-medium">
                                {formatMoedaInteiro(a.valorGanho ?? null)}
                              </div>
                              <ChevronDownIcon
                                className={`w-5 h-5 text-gray-500 transition-transform ${open ? "rotate-180" : ""}`}
                              />
                            </div>
                          </div>
                        </button>

                        {/* Área expandida */}
                        {open && (
                          <div className="px-4 pb-4 pt-1 text-sm">
                            {/* Ações administrativas (excluir) */}
                            {podeVerExcluir && (
                              <div className="flex justify-end mb-2">
                                <button
                                  onClick={() => handleExcluir(a)}
                                  disabled={deleting}
                                  className="inline-flex items-center gap-1 rounded-lg bg-blue-100 text-blue-800 border border-blue-200 px-3 py-1.5 hover:bg-blue-200 disabled:opacity-50"
                                  title="Excluir ação"
                                >
                                  <TrashIcon className="w-4 h-4" />
                                  {deleting ? "Excluindo..." : "Excluir"}
                                </button>
                              </div>
                            )}

                            {/* Membros */}
                            <div className="mt-2">
                              <div className="text-gray-700 font-semibold mb-2">Membros</div>
                              {Array.isArray(a.membros) && a.membros.length > 0 ? (
                                <ul className="space-y-1.5">
                                  {a.membros.map((m: Membro, idx: number) => (
                                    <li key={m.uid} className="flex flex-wrap items-center gap-2">
                                      <span className="text-gray-900 font-medium">{m.nome}</span>
                                      {idx === 0 && (
                                        <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                                          registrador
                                        </span>
                                      )}
                                      <RoleBadge r={m.roleLevel} />
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <div className="text-gray-500">—</div>
                              )}
                            </div>

                            {/* Observação */}
                            <div className="mt-4">
                              <div className="text-gray-700 font-semibold mb-1">Observação</div>
                              {a.obs ? (
                                <div className="text-gray-800 whitespace-pre-wrap break-words leading-relaxed">
                                  {a.obs}
                                </div>
                              ) : (
                                <div className="text-gray-500">—</div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-3 text-xs text-gray-500">
                Página {pageIndex + 1}{hasMore || pageIndex > 0 ? " (10 por página)" : ""}
              </div>
            </div>

            {/* FORMULÁRIO */}
            {showForm && (
              <div ref={formRef} className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
                <h3 className="text-gray-900 font-semibold mb-4">Criar nova ação</h3>

                <div className="grid gap-4">
                  <div className="flex flex-col">
                    <label className="text-sm text-gray-700 mb-1">Ação *</label>
                    <input
                      value={acao}
                      onChange={(e) => setAcao(e.target.value)}
                      placeholder="Ex.: Operação no QG, Depósito de materiais..."
                      className="bg-white text-gray-900 border border-gray-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-200"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex flex-col">
                      <label className="text-sm text-gray-700 mb-1">Horário *</label>
                      <input
                        required
                        type="datetime-local"
                        value={horario}
                        onChange={(e) => setHorario(e.target.value)}
                        className="bg-white text-gray-900 border border-gray-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-200"
                      />
                    </div>

                    <div className="flex flex-col">
                      <label className="text-sm text-gray-700 mb-2">Resultado *</label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setWinLose("win")}
                          className={`px-4 py-2 rounded-xl border transition ${
                            winLose === "win"
                              ? "bg-emerald-100 border-emerald-200 text-emerald-900"
                              : "bg-gray-100 border-gray-200 text-gray-700 hover:bg-gray-200"
                          }`}
                        >
                          Win
                        </button>
                        <button
                          type="button"
                          onClick={() => setWinLose("lose")}
                          className={`px-4 py-2 rounded-xl border transition ${
                            winLose === "lose"
                              ? "bg-red-100 border-red-200 text-red-900"
                              : "bg-gray-100 border-gray-200 text-gray-700 hover:bg-gray-200"
                          }`}
                        >
                          Lose
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col">
                    <label className="text-sm text-gray-700 mb-1">Valor ganho ($) — sem centavos</label>
                    <input
                      inputMode="numeric"
                      value={valorGanho}
                      onChange={(e) => setValorGanho(e.target.value.replace(/\D+/g, ""))}
                      placeholder="Ex.: 3000"
                      className="bg-white text-gray-900 border border-gray-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-200"
                    />
                    <span className="text-xs text-gray-500 mt-1">Será salvo e exibido como “$ 3.000”.</span>
                  </div>

                  {/* Membros */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <label className="text-sm text-gray-700">Membros</label>
                      <div className="flex items-center gap-2">
                        {usersLoading && (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                            <ArrowPathIcon className="w-4 h-4 animate-spin" /> carregando…
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => buscarUsuarios(buscaUser)}
                          className="rounded-lg px-2 py-1 text-xs bg-gray-100 border border-gray-200 hover:bg-gray-200"
                          title="Recarregar"
                        >
                          Recarregar
                        </button>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <input
                        value={buscaUser}
                        onChange={(e) => setBuscaUser(e.target.value)}
                        placeholder="Buscar usuário pelo nome..."
                        className="bg-white text-gray-900 border border-gray-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-200 flex-1"
                      />
                    </div>

                    <div className="grid md:grid-cols-2 gap-3">
                      {/* Lista de Membros disponíveis */}
                      <div className="bg-white border border-gray-200 rounded-xl p-3">
                        <div className="text-sm text-gray-700 mb-2">Membros</div>

                        {usersErr && (
                          <div className="mb-2 text-xs text-red-600">{usersErr}</div>
                        )}

                        <ul className="max-h-56 overflow-auto space-y-1">
                          {resultados.length === 0 && !usersLoading ? (
                            <li className="text-gray-500 text-sm">Sem resultados.</li>
                          ) : (
                            resultados.map((u) => (
                              <li key={u.uid} className="flex items-center justify-between gap-2">
                                <div className="min-w-0 flex items-center gap-2">
                                  <div className="truncate text-gray-900">{u.nome}</div>
                                  <RoleBadge r={u.roleLevel} />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => addMembro(u)}
                                  className="text-xs rounded-lg bg-emerald-100 text-emerald-800 px-2 py-1 border border-emerald-200 hover:bg-emerald-200"
                                >
                                  Adicionar
                                </button>
                              </li>
                            ))
                          )}
                        </ul>
                      </div>

                      {/* Lista de Selecionados */}
                      <div className="bg-white border border-gray-200 rounded-xl p-3">
                        <div className="text-sm text-gray-700 mb-2">Selecionados</div>
                        <ul className="max-h-56 overflow-auto space-y-1">
                          {membrosSel.length === 0 ? (
                            <li className="text-gray-500 text-sm">Ninguém selecionado ainda.</li>
                          ) : (
                            membrosSel.map((m: Membro, idx: number) => (
                              <li key={m.uid} className="flex items-center justify-between gap-2">
                                <div className="min-w-0 flex items-center gap-2">
                                  <div className="truncate text-gray-900 font-medium">
                                    {m.nome}
                                    {idx === 0 && perfil?.uid === m.uid ? (
                                      <span className="text-amber-600"> (você)</span>
                                    ) : null}
                                  </div>
                                  {idx === 0 && (
                                    <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                                      registrador
                                    </span>
                                  )}
                                  <RoleBadge r={m.roleLevel} />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeMembro(m.uid)}
                                  className="text-xs rounded-lg bg-red-100 text-red-800 px-2 py-1 border border-red-200 hover:bg-red-200"
                                >
                                  Remover
                                </button>
                              </li>
                            ))
                          )}
                        </ul>
                        <div className="text-xs text-gray-500 mt-2">
                          Dica: ao salvar, o registrador (você) fica sempre como primeiro.
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col">
                    <label className="text-sm text-gray-700 mb-1">Obs</label>
                    <textarea
                      rows={4}
                      value={obs}
                      onChange={(e) => setObs(e.target.value)}
                      placeholder="Observações da ação (opcional)"
                      className="bg-white text-gray-900 border border-gray-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-200 resize-y"
                    />
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => {
                        setShowForm(false);
                        topRef.current?.scrollIntoView({ behavior: "smooth" });
                      }}
                      className="rounded-xl bg-gray-100 text-gray-700 px-4 py-2 border border-gray-200 hover:bg-gray-200"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleSalvar}
                      disabled={salvando || !podeRegistrar}
                      className="rounded-xl bg-emerald-600 text-white px-4 py-2 font-medium shadow-sm hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {salvando ? "Salvando..." : "Salvar ação"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
