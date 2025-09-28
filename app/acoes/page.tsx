// /app/acoes/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/ui/sidebar";
import { auth, db } from "@/lib/firebase";
import { onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  DocumentData,
  QueryDocumentSnapshot,
  Timestamp,
  updateDoc,
  doc,
} from "firebase/firestore";
import {
  TrophyIcon,
  ShieldCheckIcon,
  FireIcon,
  SparklesIcon,
  BanknotesIcon,
  UserIcon,
} from "@heroicons/react/24/solid";

/* =========================
   MAPA DE HIERARQUIA
========================= */

type RoleLevel = 1 | 2 | 3 | 4 | 5 | 6;
const roleLabel = (r: number): string => {
  switch (r) {
    case 1: return "Admin Geral";
    case 2: return "Admin";
    case 3: return "Gerente-Ação";
    case 4: return "Gerente-Farm";
    case 5: return "Gerente-Venda";
    default: return "Soldado";
  }
};

const roleIcon = (r: RoleLevel) => {
  switch (r) {
    case 1: return <TrophyIcon className="w-4 h-4" />;
    case 2: return <ShieldCheckIcon className="w-4 h-4" />;
    case 3: return <FireIcon className="w-4 h-4" />;
    case 4: return <SparklesIcon className="w-4 h-4" />;
    case 5: return <BanknotesIcon className="w-4 h-4" />;
    default: return <UserIcon className="w-4 h-4" />;
  }
};

/** Badge (pill) com cores fortes */
function rolePillClass(r: RoleLevel): string {
  switch (r) {
    case 1: return "bg-purple-600 text-white";
    case 2: return "bg-blue-600 text-white";
    case 3: return "bg-red-600 text-white";
    case 4: return "bg-green-600 text-white";
    case 5: return "bg-amber-500 text-white";
    default: return "bg-slate-600 text-white";
  }
}
const RolePill = ({ r }: { r: RoleLevel }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${rolePillClass(r)}`}
    title={roleLabel(r)}
  >
    <span className="opacity-90">{roleIcon(r)}</span>
    {roleLabel(r)}
  </span>
);

// ===== Tipos do banco =====

type PerfilUsuario = {
  uid: string;
  nome: string;
  roleLevel: RoleLevel;
};

type Membro = {
  uid?: string;
  nome?: string;
  roleLevel?: RoleLevel;
  roleLabel?: string;
  hierarquia?: string;
};

type AcaoItem = {
  id: string;
  acao: string;
  winLose: "win" | "lose";
  horario: { seconds: number; nanoseconds: number } | null;
  membros?: Membro[];
  registradoPor?: Membro;
};

const PAGE_SIZE = 10;
const PAGE_MAX_PAGES = 10; // 10 x 10 = 100
const FALLBACK_BATCH_MULTIPLIER = 3; // tamanho do lote bruto no fallback
type OrderField = "horario" | "createdAt";

function formatDateTime(stamp?: { seconds: number } | null) {
  const s = stamp?.seconds ?? null;
  if (!s) return "-";
  const d = new Date(s * 1000);
  return d.toLocaleString("pt-BR", { timeZone: "America/Bahia" });
}

/* ==== helpers ==== */
function buildParticipantesFromDoc(x: any): string[] {
  const set = new Set<string>();
  if (x?.registradoPor?.uid) set.add(String(x.registradoPor.uid));
  if (Array.isArray(x?.membros)) {
    x.membros.forEach((m: any) => { if (m?.uid) set.add(String(m.uid)); });
  }
  return Array.from(set);
}
function normalize(s?: string) { return (s || "").trim().toLowerCase(); }
function userParticipouDoDoc(x: any, uid: string, nome?: string): boolean {
  const uidNorm = String(uid || "");
  const nomeNorm = normalize(nome);
  if (Array.isArray(x?.participantes) && x.participantes.includes(uidNorm)) return true;
  if (Array.isArray(x?.membros) && x.membros.some((m: any) => String(m?.uid || "") === uidNorm)) return true;
  if (String(x?.registradoPor?.uid || "") === uidNorm) return true;
  if (nomeNorm) {
    if (normalize(x?.registradoPor?.nome) === nomeNorm) return true;
    if (Array.isArray(x?.membros) && x.membros.some((m: any) => normalize(m?.nome) === nomeNorm)) return true;
  }
  return false;
}

export default function AcoesPage() {
  const router = useRouter();
  const [activePage, setActivePage] = useState("Ações");
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  // paginação
  const [acoes, setAcoes] = useState<AcaoItem[]>([]);
  const [loadingAcoes, setLoadingAcoes] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pageIndex, setPageIndex] = useState(0);
  const [cursors, setCursors] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]);
  const [hasMore, setHasMore] = useState(false);

  // coleção usada e campo de ordenação detectado
  const [colecaoLista, setColecaoLista] = useState<"acoesuser" | "acoes">("acoesuser");
  const [orderField, setOrderField] = useState<OrderField>("horario");

  // cursores p/ fallback (consulta sem where e filtro no cliente)
  const [fallbackCursors, setFallbackCursors] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]);

  // usuários (para contagem)
  const [usuarios, setUsuarios] = useState<PerfilUsuario[]>([]);
  const [loadingUsuarios, setLoadingUsuarios] = useState(true);

  // filtro de participação/contagem
  const [dataIni, setDataIni] = useState<string>("");
  const [dataFim, setDataFim] = useState<string>("");
  const [contagens, setContagens] = useState<Record<string, number>>({});
  const [loadingFiltro, setLoadingFiltro] = useState(false);
  const firstLoadDone = useRef(false);

  const isAdminLike = useMemo(() => (perfil ? [1, 2].includes(perfil.roleLevel) : false), [perfil]);

  /* ==== AUTH ==== */
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

  /* ==== PERFIL ==== */
  useEffect(() => {
    const loadPerfil = async () => {
      if (!firebaseUser) return;
      try {
        const snap = await getDocs(query(collection(db, "users"), where("uid", "==", firebaseUser.uid), limit(1)));
        let nome = firebaseUser.email ?? "Usuário";
        let role: RoleLevel = 6;
        if (!snap.empty) {
          const d: any = snap.docs[0].data();
          if (d?.nome) nome = d.nome;
          const n = Number(d?.roleLevel);
          if (!Number.isNaN(n) && n >= 1 && n <= 6) role = n as RoleLevel;
        }
        setPerfil({ uid: firebaseUser.uid, nome, roleLevel: role });
      } finally {
        setCheckingAuth(false);
      }
    };
    loadPerfil();
  }, [firebaseUser]);

  /* ==== CARREGAR USUÁRIOS ==== */
  useEffect(() => {
    const loadUsers = async () => {
      setLoadingUsuarios(true);
      const qUsers = query(collection(db, "users"), orderBy("nome", "asc"));
      const snap = await getDocs(qUsers);
      const list: PerfilUsuario[] = [];
      snap.forEach((d) => {
        const data: any = d.data();
        const nome = data?.nome ?? data?.email ?? "(sem nome)";
        const n = Number(data?.roleLevel ?? 6);
        const role: RoleLevel = (!Number.isNaN(n) && n >= 1 && n <= 6) ? (n as RoleLevel) : 6;
        list.push({ uid: data?.uid ?? d.id, nome, roleLevel: role });
      });
      list.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      setUsuarios(list);
      setLoadingUsuarios(false);
    };
    loadUsers();
  }, []);

  /* ==== detectar dinamicamente o campo de ordenação (horario -> createdAt) ==== */
  const detectOrderField = async (colName: "acoesuser" | "acoes"): Promise<OrderField> => {
    const colRef = collection(db, colName);
    // tenta horario
    const s1 = await getDocs(query(colRef, orderBy("horario", "desc"), limit(1)));
    if (!s1.empty) return "horario";
    // tenta createdAt
    const s2 = await getDocs(query(colRef, orderBy("createdAt", "desc"), limit(1)));
    if (!s2.empty) return "createdAt";
    // default
    return "horario";
  };

  /* ==== LISTAGEM: busca “minhas ações” robusta ==== */
  const fetchPage = async (page: number, reset = false) => {
    if (!perfil) return;
    setLoadingAcoes(true);

    const runOn = async (colName: "acoesuser" | "acoes", ordField: OrderField) => {
      const colRef = collection(db, colName);
      const listarTodas = isAdminLike;

      // consulta padrão (não-admin tenta por 'participantes')
      let base = listarTodas
        ? query(colRef, orderBy(ordField, "desc"), limit(PAGE_SIZE + 1))
        : query(
            colRef,
            where("participantes", "array-contains", perfil.uid),
            orderBy(ordField, "desc"),
            limit(PAGE_SIZE + 1)
          );

      if (page > 0 && cursors[page - 1]) {
        base = listarTodas
          ? query(colRef, orderBy(ordField, "desc"), startAfter(cursors[page - 1]!), limit(PAGE_SIZE + 1))
          : query(
              colRef,
              where("participantes", "array-contains", perfil.uid),
              orderBy(ordField, "desc"),
              startAfter(cursors[page - 1]!),
              limit(PAGE_SIZE + 1)
            );
      }

      // 1) tenta consulta normal
      let snap;
      try {
        snap = await getDocs(base);
      } catch (e) {
        // se faltar índice ou der erro, força fallback
        snap = { docs: [] as any[] };
      }

      let docsPage = snap.docs.slice(0, PAGE_SIZE);
      let itens: AcaoItem[] = docsPage.map((d) => {
        const data: any = d.data();
        return {
          id: d.id,
          acao: data?.acao ?? "",
          winLose: data?.winLose === "lose" ? "lose" : "win",
          // escolhe campo existente para render
          horario: data?.horario ?? data?.createdAt ?? null,
          membros: Array.isArray(data?.membros) ? data.membros : [],
          registradoPor:
            data?.registradoPor ??
            (Array.isArray(data?.membros) && data.membros.length ? data.membros[0] : undefined),
        };
      });

      // 2) FALLBACK (não-admin OU quando a consulta padrão voltou vazia)
      const precisaFallback = !isAdminLike && itens.length === 0;
      if (precisaFallback) {
        const batchSize = PAGE_SIZE * FALLBACK_BATCH_MULTIPLIER;
        const startCursor = page > 0 ? fallbackCursors[page - 1] : null;

        let baseFallback = startCursor
          ? query(colRef, orderBy(ordField, "desc"), startAfter(startCursor), limit(batchSize + 1))
          : query(colRef, orderBy(ordField, "desc"), limit(batchSize + 1));

        // se ordField não existir em muitos docs, ainda assim Firestore retorna só os que têm o campo;
        // por isso detectamos previamente, e aqui sempre usamos o que existe.
        const snap2 = await getDocs(baseFallback);
        const allDocs = snap2.docs;

        const filtrados = allDocs
          .map((d) => ({ d, data: d.data() }))
          .filter(({ data }) => userParticipouDoDoc(data, perfil.uid, perfil.nome))
          .map(({ d }) => d);

        const slice = filtrados.slice(0, PAGE_SIZE);

        docsPage = slice;
        itens = slice.map((d) => {
          const data: any = d.data();
          return {
            id: d.id,
            acao: data?.acao ?? "",
            winLose: data?.winLose === "lose" ? "lose" : "win",
            horario: data?.horario ?? data?.createdAt ?? null,
            membros: Array.isArray(data?.membros) ? data.membros : [],
            registradoPor:
              data?.registradoPor ??
              (Array.isArray(data?.membros) && data.membros.length ? data.membros[0] : undefined),
          };
        });

        const fallbackHasMore = (allDocs.length > batchSize) || (filtrados.length > PAGE_SIZE);
        setHasMore(fallbackHasMore && page < PAGE_MAX_PAGES - 1);

        const lastRaw = allDocs[Math.min(allDocs.length - 1, batchSize - 1)] ?? allDocs[allDocs.length - 1] ?? null;
        setFallbackCursors((prev) => {
          const next = reset ? Array(page + 1).fill(null) : [...prev];
          next[page] = lastRaw || null;
          return next;
        });

        return { snap: snap2, docsPage, itens };
      }

      // fluxo normal
      setHasMore(snap.docs.length > PAGE_SIZE && page < PAGE_MAX_PAGES - 1);
      return { snap, docsPage, itens };
    };

    try {
      let chosenCol: "acoesuser" | "acoes" = colecaoLista;
      let ord: OrderField = orderField;
      let result;

      if (page === 0) {
        // detecta melhor campo de ordenação em acoesuser; se vazio, cai para acoes
        let detected = await detectOrderField("acoesuser");
        let r1 = await runOn("acoesuser", detected);

        if (r1.itens.length > 0) {
          chosenCol = "acoesuser";
          ord = detected;
          result = r1;
        } else {
          detected = await detectOrderField("acoes");
          const r2 = await runOn("acoes", detected);
          chosenCol = "acoes";
          ord = detected;
          result = r2;
        }

        setColecaoLista(chosenCol);
        setOrderField(ord);

        const docsPage = result.docsPage;
        const itens = result.itens;
        setAcoes(itens);

        const last = docsPage[docsPage.length - 1] ?? null;
        setCursors([last]);
        if (reset) setFallbackCursors([null]);
      } else {
        const r = await runOn(colecaoLista, orderField);
        const docsPage = r.docsPage;
        const itens = r.itens;

        setAcoes(itens);

        const last = docsPage[docsPage.length - 1] ?? null;
        setCursors((prev) => {
          const next = reset ? Array(page + 1).fill(null) : [...prev];
          next[page] = last;
          return next;
        });
        if (reset) setFallbackCursors([null]);
      }
    } catch {
      setAcoes([]);
      setHasMore(false);
    } finally {
      setLoadingAcoes(false);
    }
  };

  useEffect(() => {
    if (perfil) {
      setColecaoLista("acoesuser");
      setOrderField("horario");
      setPageIndex(0);
      setCursors([null]);
      setFallbackCursors([null]);
      fetchPage(0, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perfil?.uid, isAdminLike]);

  const irProxima = () => {
    if (loadingAcoes || !hasMore) return;
    const next = pageIndex + 1;
    setPageIndex(next);
    fetchPage(next);
  };

  const irAnterior = () => {
    if (loadingAcoes || pageIndex === 0) return;
    const prev = pageIndex - 1;
    setPageIndex(prev);
    fetchPage(prev);
  };

  /* ==== CONTAGEM POR USUÁRIO (30 dias) — tenta horario e createdAt ==== */
  const aplicarFiltro = async () => {
    if (!perfil) return;
    setLoadingFiltro(true);

    const end = dataFim ? new Date(dataFim) : new Date();
    end.setHours(23, 59, 59, 999);
    const start = dataIni ? new Date(dataIni) : new Date(end.getTime());
    if (!dataIni) start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);

    const rangeQueryBoth = async (colName: "acoesuser" | "acoes") => {
      const col = collection(db, colName);

      // busca por horario
      const qh = query(
        col,
        where("horario", ">=", Timestamp.fromDate(start)),
        where("horario", "<=", Timestamp.fromDate(end))
      );
      const sh = await getDocs(qh);

      // busca por createdAt (alguns docs não têm horario)
      const qc = query(
        col,
        where("createdAt", ">=", Timestamp.fromDate(start)),
        where("createdAt", "<=", Timestamp.fromDate(end))
      );
      const sc = await getDocs(qc);

      const map = new Map<string, number>();
      const addDoc = (data: any) => {
        if (Array.isArray(data?.participantes) && data.participantes.length) {
          (data.participantes as string[]).forEach((u) => {
            if (!u) return;
            map.set(u, (map.get(u) ?? 0) + 1);
          });
        } else {
          const uids = new Set<string>();
          if (Array.isArray(data?.membros)) data.membros.forEach((m: any) => m?.uid && uids.add(String(m.uid)));
          if (data?.registradoPor?.uid) uids.add(String(data.registradoPor.uid));
          uids.forEach((u) => map.set(u, (map.get(u) ?? 0) + 1));
        }
      };

      sh.forEach((d) => addDoc(d.data()));
      sc.forEach((d) => addDoc(d.data()));
      return map;
    };

    try {
      const [m1, m2] = await Promise.all([rangeQueryBoth("acoesuser"), rangeQueryBoth("acoes")]);
      const total = new Map<string, number>(m1);
      m2.forEach((v, k) => total.set(k, (total.get(k) ?? 0) + v));

      const entries = usuarios.map((u) => ({ ...u, count: total.get(u.uid) ?? 0 }));
      entries.sort((a, b) => b.count - a.count || a.nome.localeCompare(b.nome, "pt-BR"));
      setContagens(Object.fromEntries(entries.map((e) => [e.uid, e.count])));
    } catch {
      setContagens({});
    } finally {
      setLoadingFiltro(false);
    }
  };

  // carrega contagens padrão (30 dias)
  useEffect(() => {
    if (!firstLoadDone.current && usuarios.length > 0 && perfil) {
      firstLoadDone.current = true;
      aplicarFiltro();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuarios.length, perfil?.uid]);

  // recomputa colunas no render
  const orderedUsers = useMemo(() => {
    const arr = usuarios.map((u) => ({ ...u, count: contagens[u.uid] ?? 0 }));
    arr.sort((a, b) => b.count - a.count || a.nome.localeCompare(b.nome, "pt-BR"));
    const mid = Math.ceil(arr.length / 2);
    return { left: arr.slice(0, mid), right: arr.slice(mid) };
  }, [usuarios, contagens]);

  /* ============== Backfill utilitário (continua opcional p/ admins) ============== */
  const isAdminLikeBtn = isAdminLike;
  const backfillParticipantesAcoesUser = async () => {
    if (!isAdminLikeBtn) return;
    const snap = await getDocs(collection(db, "acoesuser"));
    let atualizados = 0;
    for (const d of snap.docs) {
      const x: any = d.data();
      const precisa = !Array.isArray(x.participantes) || x.participantes.length === 0;
      const precisaCreated = !x.createdAt && x.horario;
      if (precisa || precisaCreated) {
        const participantes = buildParticipantesFromDoc(x);
        await updateDoc(doc(db, "acoesuser", d.id), {
          ...(precisa ? { participantes } : {}),
          ...(precisaCreated ? { createdAt: x.horario } : {}),
        });
        atualizados++;
      }
    }
    alert(`Backfill em 'acoesuser': ${atualizados} atualização(ões).`);
  };

  const backfillParticipantesAcoes = async () => {
    if (!isAdminLikeBtn) return;
    const snap = await getDocs(collection(db, "acoes"));
    let atualizados = 0;
    for (const d of snap.docs) {
      const x: any = d.data();
      const precisa = !Array.isArray(x.participantes) || x.participantes.length === 0;
      const precisaCreated = !x.createdAt && x.horario;
      if (precisa || precisaCreated) {
        const participantes = buildParticipantesFromDoc(x);
        await updateDoc(doc(db, "acoes", d.id), {
          ...(precisa ? { participantes } : {}),
          ...(precisaCreated ? { createdAt: x.horario } : {}),
        });
        atualizados++;
      }
    }
    alert(`Backfill em 'acoes': ${atualizados} atualização(ões).`);
  };

  if (checkingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f7fb]">
        <div className="animate-pulse opacity-80">Verificando permissões…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f7fb]">
      <div className="relative flex min-h-screen">
        <aside>
          <Sidebar activePage={activePage} setActivePage={setActivePage} />
        </aside>

        <main className="flex-1 p-4 md:p-10">
          <div className="max-w-6xl mx-auto w-full">
            {/* Cabeçalho */}
            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5 mb-6">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h1 className="text-2xl md:text-3xl font-semibold text-gray-900 tracking-tight">Ações</h1>

                {isAdminLikeBtn && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={backfillParticipantesAcoesUser}
                      className="rounded-lg px-3 py-1.5 bg-indigo-600 text-white text-sm hover:bg-indigo-500"
                      title="Preenche 'participantes' e 'createdAt' em ações antigas (acoesuser)"
                    >
                      Sincronizar participantes (acoesuser)
                    </button>
                    <button
                      onClick={backfillParticipantesAcoes}
                      className="rounded-lg px-3 py-1.5 bg-violet-600 text-white text-sm hover:bg-violet-500"
                      title="Preenche 'participantes' e 'createdAt' em ações antigas (acoes)"
                    >
                      Sincronizar participantes (acoes)
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* ÚLTIMAS AÇÕES */}
            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Últimas ações</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={irAnterior}
                    disabled={pageIndex === 0 || loadingAcoes}
                    className="rounded-lg px-3 py-1.5 bg-gray-100 border border-gray-200 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                    title="Mais recentes"
                  >
                    &lt;
                  </button>
                  <button
                    onClick={irProxima}
                    disabled={!hasMore || loadingAcoes}
                    className="rounded-lg px-3 py-1.5 bg-gray-100 border border-gray-200 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                    title="Mais antigas"
                  >
                    &gt;
                  </button>
                </div>
              </div>

              {loadingAcoes ? (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-14 rounded-xl border border-gray-200 bg-gray-100 animate-pulse" />
                  ))}
                </div>
              ) : acoes.length === 0 ? (
                <div className="text-gray-600">Nenhuma ação encontrada.</div>
              ) : (
                <div className="space-y-2">
                  {acoes.map((a) => {
                    const win = a.winLose === "win";
                    const lineBg = win ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200";
                    const textTint = win ? "text-emerald-900" : "text-red-900";
                    const open = !!expanded[a.id];

                    const registrador =
                      a.registradoPor ||
                      (Array.isArray(a.membros) && a.membros.length ? a.membros[0] : undefined);
                    const regNome = registrador?.nome ?? "(sem registrador)";
                    const regRole: RoleLevel = (registrador?.roleLevel as RoleLevel) || 6;

                    return (
                      <div key={a.id} className={`rounded-xl overflow-hidden border ${lineBg}`}>
                        <button
                          onClick={() => setExpanded((prev) => ({ ...prev, [a.id]: !open }))}
                          className="w-full text-left"
                        >
                          <div className={`grid items-center gap-3 p-3 ${textTint} grid-cols-1 sm:grid-cols-[minmax(220px,1fr)_minmax(280px,2fr)_160px]`}>
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="truncate font-semibold">{regNome}</span>
                              <RolePill r={regRole} />
                            </div>
                            <div className="min-w-0 truncate font-semibold">{a.acao || "(sem título)"}</div>
                            <div className="sm:text-right text-sm text-gray-700 font-medium">
                              {formatDateTime(a.horario)}
                            </div>
                          </div>
                        </button>

                        {open && (
                          <div className="px-4 pb-4 pt-1 text-sm">
                            <div className="text-gray-700 font-semibold mb-2">Membros</div>
                            {Array.isArray(a.membros) && a.membros.length > 0 ? (
                              <ul className="space-y-1.5">
                                {a.membros.map((m, idx) => (
                                  <li key={`${a.id}-${m.uid || idx}`} className="flex flex-wrap items-center gap-2">
                                    <span className="text-gray-900 font-medium">{m.nome || "(sem nome)"}</span>
                                    <RolePill r={(m.roleLevel as RoleLevel) || 6} />
                                    {idx === 0 && (
                                      <span className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">
                                        participante
                                      </span>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <div className="text-gray-500">—</div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-3 text-xs text-gray-500">
                Página {pageIndex + 1}
                {hasMore || pageIndex > 0 ? " (10 por página, máx. 100)" : ""}
              </div>
            </div>

            {/* PARTICIPAÇÃO POR PERÍODO */}
            <div className="rounded-2xl bg-white border border-gray-200 shadow-sm p-5">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Participações por usuário</h2>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-sm text-gray-600">Data inicial</label>
                  <input
                    type="date"
                    value={dataIni}
                    onChange={(e) => setDataIni(e.target.value)}
                    className="bg-white text-gray-900 border border-gray-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-200 w-full"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-600">Data final</label>
                  <input
                    type="date"
                    value={dataFim}
                    onChange={(e) => setDataFim(e.target.value)}
                    className="bg-white text-gray-900 border border-gray-300 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-emerald-200 w-full"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={aplicarFiltro}
                    disabled={loadingFiltro || loadingUsuarios}
                    className="rounded-xl bg-emerald-600 text-white px-4 py-2 font-medium shadow-sm hover:bg-emerald-500 disabled:opacity-50 w-full"
                  >
                    {loadingFiltro ? "Filtrando…" : "Aplicar filtro"}
                  </button>
                </div>
              </div>

              <div className="mt-4 text-sm text-gray-600">
                {dataIni || dataFim ? (
                  <>
                    Período selecionado:{" "}
                    <b>{dataIni ? new Date(dataIni).toLocaleDateString("pt-BR") : "(início livre)"}</b> até{" "}
                    <b>{dataFim ? new Date(dataFim).toLocaleDateString("pt-BR") : "(hoje)"}</b>
                  </>
                ) : (
                  <>Sem datas: mostrando os últimos <b>30 dias</b>.</>
                )}
              </div>

              {/* duas colunas; cada linha: Nome + Badge | contagem */}
              <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
                {[orderedUsers.left, orderedUsers.right].map((col, idx) => (
                  <ul key={idx} className="space-y-2">
                    {col.map((u) => (
                      <li
                        key={u.uid}
                        className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-3 py-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate text-gray-800 font-medium">{u.nome}</span>
                          <RolePill r={u.roleLevel} />
                        </div>
                        <span className="font-semibold text-gray-900">{contagens[u.uid] ?? 0}</span>
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
