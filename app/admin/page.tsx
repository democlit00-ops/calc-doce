// /app/admin/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/ui/sidebar";
import { Input, Button } from "@/components/ui";
import { db, auth } from "@/lib/firebase";
import {
  collection,
  getDocs,
  getDoc,
  updateDoc,
  doc,
  setDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  // ===== Alertas - adições =====
  addDoc,
  serverTimestamp,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";
import {
  createUserWithEmailAndPassword,
  getAuth,
  deleteUser,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  sendPasswordResetEmail,
} from "firebase/auth";
import {
  PencilSquareIcon,
  XMarkIcon,
  PlusIcon,
  TrashIcon,
  BellAlertIcon, // botão de alertas
} from "@heroicons/react/24/outline";
import toast, { Toaster } from "react-hot-toast";
import type { User as BaseUser } from "@/types";

/* =========================
   Tipos
========================= */
type RoleLevel = 1|2|3|4|5|6|7|8|9;

type User = BaseUser & {
  pastaNumero?: string; // "Nº da pasta" (string, aceita "01")
};

type ActionRecord = {
  id: string;
  nomeAcao: string;
  resultado: "win" | "lose";
  valorGanho?: number;
  participantes?: string[];
  createdAt?: any;
};

type MetaSemanal = {
  id: string;
  status: "nao_pagou" | "meta_livre" | "confirmado" | "desconhecido";
  semanaRef?: string; // ISO da semana: YYYY-Www
  createdAt?: any;
};

// ===== Alertas =====
type AlertDoc = {
  id: string;
  message: string;
  authorUid: string;
  authorName: string;
  authorRole: RoleLevel;
  createdAt: Timestamp | null;
};

/* =========================
   Hierarquias (mantidas)
========================= */
const ROLE_LABELS: Record<RoleLevel, string> = {
  1: "CHEFE",
  2: "GERENTE GERAL",
  3: "GERENTE DE AÇÃO",
  4: "GERENTE DE FARM",
  5: "GERENTE DE VENDAS",
  6: "SOLDADO FARM",
  7: "SOLDADO AÇÃO",
  8: "VAPOR",
  9: "AVIÃO",
};

const ROLE_COLORS: Record<RoleLevel, string> = {
  1: "bg-indigo-600",
  2: "bg-sky-600",
  3: "bg-rose-600",
  4: "bg-emerald-600",
  5: "bg-amber-600",
  6: "bg-lime-600",
  7: "bg-red-700",
  8: "bg-gray-600",
  9: "bg-cyan-700",
};

const ROLE_EMOJIS: Record<RoleLevel, string> = {
  1: "👑",
  2: "👔",
  3: "🔫",
  4: "🚜",
  5: "💵",
  6: "📦",
  7: "🪖",
  8: "👀",
  9: "✈️",
};

function RoleBadge({ level }: { level: RoleLevel }) {
  const color = ROLE_COLORS[level];
  const emoji = ROLE_EMOJIS[level];
  const label = ROLE_LABELS[level];
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-white text-xs ${color}`}
      title={label}
    >
      <span aria-hidden>{emoji}</span> {label}
    </span>
  );
}

/* =========================
   Helpers gerais
========================= */
const showPastaNumero = (v: unknown) => {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v).padStart(2, "0");
  return "";
};

// permissões (mantidas do seu código)
const canSeeAdminButton = (role: number) => [1,2,3,4,5].includes(role);
const canSeeAdminArea   = (role: number) => [1,2,3,4,5].includes(role);
const canCreateUser     = (role: number) => [1,2,3,4,5,6].includes(role);
const canEditTarget = (me: number, target: number) => {
  if (me === 1) return true;
  if (me === 2) return target >= 2;
  if (me === 3) return target >= 3;
  return false;
};
const canDeleteTarget = (me: number, target: number) => {
  if (me === 1) return true;
  if (me === 2) return target >= 3;
  if (me === 3) return target >= 4;
  return false;
};
const canSeeAllUsers = (role: number) => [1,2,3,4,5,6].includes(role);

/* =========================
   Datas/Semanas — IGUAL à /app/meta/page.tsx
========================= */
function startOfWeekMonday(d: Date) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay(); // 0=Dom
  const diff = (day + 6) % 7;    // volta até segunda
  date.setUTCDate(date.getUTCDate() - diff);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}
function addWeeks(date: Date, w: number) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + w * 7);
  return d;
}
function isoWeekKeyFromDate(d: Date) {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  dt.setUTCDate(dt.getUTCDate() + 4 - (dt.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((+dt - +yearStart) / 86400000 + 1) / 7);
  const weekStr = String(weekNo).padStart(2, "0");
  return `${dt.getUTCFullYear()}-W${weekStr}`;
}
function isoWeekKeyFromMonday(mondayUTC: Date) {
  return isoWeekKeyFromDate(mondayUTC);
}
function mondayFromISO(iso: string) {
  const [yStr, wStr] = iso.split("-W");
  const year = Number(yStr);
  const week = Number(wStr);
  const simple = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = simple.getUTCDay() || 7;
  const mondayOfWeek1 = new Date(simple);
  mondayOfWeek1.setUTCDate(simple.getUTCDate() - (dayOfWeek - 1));
  const monday = new Date(mondayOfWeek1);
  monday.setUTCDate(mondayOfWeek1.getUTCDate() + (week - 1) * 7);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}
function sundayFromISO(iso: string) {
  const mon = mondayFromISO(iso);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  sun.setUTCHours(23, 59, 59, 999);
  return sun;
}
function fmtDM(d: Date) {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}
function weekLabel(iso: string) {
  const mon = mondayFromISO(iso);
  const sun = sundayFromISO(iso);
  return `${fmtDM(mon)} — ${fmtDM(sun)}`;
}

/* =========================
   Mensagem da Meta Semanal (mantida)
========================= */
function metaMessage(last4: MetaSemanal[]): string {
  const statuses = last4.map(m => String(m.status || "").toLowerCase()) as MetaSemanal["status"][];

  const s1 = statuses[0];
  const s2 = statuses[1];
  const s3 = statuses[2];
  const s4 = statuses[3];

  const role4 = ROLE_LABELS[4];
  const role1 = ROLE_LABELS[1];
  const role2 = ROLE_LABELS[2];

  if ([s1,s2,s3,s4].every(s => s === "nao_pagou")) {
    return "Vamos te pegar, tá ligado malandro...";
  }
  if ([s1,s2,s3].every(s => s === "nao_pagou")) {
    return `Se liga, estamos de olho em você. Fale com nosso ${role1} ou ${role2} para resolver logo.`;
  }
  if ([s1,s2,s3,s4].every(s => s === "confirmado")) {
    return "Você é o melhor! Parabéns, seguimos de olho nesse desempenho. Vamos pra cima!";
  }
  if ([s1,s2,s3].every(s => s === "confirmado")) {
    return "Trem bala! Tudo certo com o farm, vamos pra cima.";
  }
  if (s1 === "confirmado" && s2 === "confirmado") {
    return "Tudo certo com sua meta. Parabéns, continue assim!";
  }
  if (s1 === "confirmado") {
    return "Tudo ok com sua meta. Parabéns!";
  }
  if (s1 === "meta_livre" && s2 === "meta_livre") {
    return "Como você está? Duas semanas de atestado, mande notícias.";
  }
  if (s1 === "meta_livre") {
    return "Esta semana está de atestado. Fique bem e volte logo.";
  }
  if (s1 === "nao_pagou" && s2 === "nao_pagou") {
    return `Você está há 2 semanas sem pagar; procure urgente o nosso ${role4}.`;
  }
  if (s1 === "nao_pagou") {
    return `Sua meta da semana passada está atrasada; procure nosso ${role4}.`;
  }
  return "Sem registro suficiente para avaliar sua meta.";
}

/* =========================
   Componente principal
========================= */
export default function AdminPage() {
  const router = useRouter();

  const [loggedUser, setLoggedUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<RoleLevel | null>(null);

  // modal editar/criar
  const [showEdit, setShowEdit] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState<Omit<User, "id" | "uid">>({
    email: "",
    senha: "",
    nome: "",
    passaport: "",
    discord: "",
    roleLevel: 6,
    pasta: "",
    pastaNumero: "",
  });

  // trocar senha (self)
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");

  // Admin toggle
  const [adminMode, setAdminMode] = useState(false);

  // Doc inicial
  const [ultimasAcoes, setUltimasAcoes] = useState<ActionRecord[]>([]);
  const [metas, setMetas] = useState<MetaSemanal[]>([]);

  const [activePage, setActivePage] = useState("Admin");

  // ===== Alertas - estados =====
  const [alerts, setAlerts] = useState<AlertDoc[]>([]);           // últimos 10
  const [latestAlert, setLatestAlert] = useState<AlertDoc | null>(null); // banner não lido
  const [showAlertsModal, setShowAlertsModal] = useState(false);  // histórico
  const [showLatestDialog, setShowLatestDialog] = useState(false);// leitura do banner
  const [sendingAlert, setSendingAlert] = useState(false);        // loading envio
  const [newAlertMsg, setNewAlertMsg] = useState("");             // textarea envio

  useEffect(() => {
    const saved = localStorage.getItem("loggedUser");
    if (!saved) {
      router.push("/login");
      return;
    }
    const lu = JSON.parse(saved);
    setLoggedUser(lu);
  }, [router]);

  useEffect(() => {
    if (!loggedUser) return;
    fetchUsers();
    fetchUltimasAcoes();
    fetchMetasSemanais_Last4();
  }, [loggedUser]);

  /* =========================
     Alertas — efeitos
  ========================= */
  // últimos 10 no modal
  useEffect(() => {
    const q10 = query(
      collection(db, "alerts"),
      orderBy("createdAt", "desc"),
      limit(10)
    );
    const unsub = onSnapshot(q10, (snap) => {
      const list = snap.docs.map(d => {
        const x = d.data() as any;
        return {
          id: d.id,
          message: String(x?.message || ""),
          authorUid: String(x?.authorUid || ""),
          authorName: String(x?.authorName || "Desconhecido"),
          authorRole: Number(x?.authorRole || 9) as RoleLevel,
          createdAt: x?.createdAt ?? null,
        } as AlertDoc;
      });
      setAlerts(list);
    });
    return () => unsub();
  }, []);

  // assina o alerta mais recente e verifica ack para banner
  useEffect(() => {
    if (!loggedUser) return;
    const q1 = query(
      collection(db, "alerts"),
      orderBy("createdAt", "desc"),
      limit(1)
    );
    const unsub = onSnapshot(q1, async (snap) => {
      if (snap.empty) {
        setLatestAlert(null);
        return;
      }
      const d = snap.docs[0];
      const x = d.data() as any;
      const last: AlertDoc = {
        id: d.id,
        message: String(x?.message || ""),
        authorUid: String(x?.authorUid || ""),
        authorName: String(x?.authorName || "Desconhecido"),
        authorRole: Number(x?.authorRole || 9) as RoleLevel,
        createdAt: x?.createdAt ?? null,
      };
      try {
        const ackRef = doc(db, "users", loggedUser.id!, "alert_acks", last.id);
        const ackSnap = await getDoc(ackRef);
        if (!ackSnap.exists()) setLatestAlert(last);
        else setLatestAlert(null);
      } catch {
        setLatestAlert(last);
      }
    });
    return () => unsub();
  }, [loggedUser]);

  /* =========================
     Fetchers
  ========================= */
  const fetchUsers = async () => {
    if (!loggedUser) return;

    if (canSeeAllUsers(loggedUser.roleLevel)) {
      const snap = await getDocs(collection(db, "users"));
      const listAll = snap.docs.map((d) => {
        const u = { id: d.id, ...d.data() } as User;
        return {
          ...u,
          pastaNumero:
            typeof (u as any).pastaNumero === "number"
              ? String((u as any).pastaNumero).padStart(2, "0")
              : ((u as any).pastaNumero ?? ""),
        };
      });
      setUsers(listAll);
    } else {
      const meSnap = await getDoc(doc(db, "users", loggedUser.id!));
      const me = meSnap.exists()
        ? ({ id: meSnap.id, ...meSnap.data() } as User)
        : (loggedUser as User);

      const onlyMe: User = {
        ...me,
        pastaNumero:
          typeof (me as any).pastaNumero === "number"
            ? String((me as any).pastaNumero).padStart(2, "0")
            : ((me as any).pastaNumero ?? ""),
      };
      setUsers([onlyMe]);
    }
  };

  // ==== ÚLTIMAS AÇÕES ====
  const fetchUltimasAcoes = async () => {
    try {
      if (!loggedUser) return;

      const myId = (loggedUser as any).uid || loggedUser.id;

      const tryQuery = async (colName: "acoes" | "acoesuser") => {
        // principal: participantes + createdAt desc
        try {
          const q1 = query(
            collection(db, colName),
            where("participantes", "array-contains", myId),
            orderBy("createdAt", "desc"),
            limit(5)
          );
          const s1 = await getDocs(q1);
          if (!s1.empty) return s1.docs;
        } catch {}

        // fallback: ordenar por 'horario' e filtrar por registrador/membros
        try {
          const q2 = query(collection(db, colName), orderBy("horario", "desc"), limit(20));
          const s2 = await getDocs(q2);
          const list = s2.docs.filter(d => {
            const x: any = d.data();
            const inMembros = Array.isArray(x?.membros) && x.membros.some((m: any) => String(m?.uid) === myId);
            const isReg = String(x?.registradoPor?.uid || "") === myId;
            return inMembros || isReg;
          });
          if (list.length) return list.slice(0, 5);
        } catch {}

        return [];
      };

      let docsArr = await tryQuery("acoes");
      if (docsArr.length === 0) docsArr = await tryQuery("acoesuser");

      const list: ActionRecord[] = docsArr.map(d => {
        const x: any = d.data();
        const res = String(x?.resultado || x?.winLose || "").toLowerCase();
        const resultado: "win" | "lose" = res === "win" || res === "vitória" || res === "vitoria" ? "win" : "lose";
        return {
          id: d.id,
          nomeAcao: x?.nomeAcao ?? x?.acao ?? x?.nome ?? "Ação",
          resultado,
          valorGanho: Number.isFinite(x?.valorGanho) ? Number(x.valorGanho) : undefined,
          participantes: Array.isArray(x?.participantes) ? x.participantes : undefined,
          createdAt: x?.createdAt ?? x?.horario ?? null,
        };
      });

      setUltimasAcoes(list);
    } catch {
      setUltimasAcoes([]);
    }
  };

  // ==== METAS — 4 últimas semanas (pula a atual) ====
  const loadTemplates = async () => {
    const tplSnap = await getDocs(query(collection(db, "metas_templates"), orderBy("effectiveFromMondayISO", "asc")));
    return tplSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Array<{id:string; effectiveFromMondayISO:string; targets: Record<string,number>}>;
  };

  const loadPaidAndFree = async (weeksISO: string[], userUid: string) => {
    const paidSnap = await getDocs(
      query(
        collection(db, "metas_semanais_paid"),
        where("semanaISO", "in", weeksISO),
        where("userUid", "==", userUid)
      )
    );
    const paidIndex = new Map<string, Record<string, number>>();
    paidSnap.forEach(d => {
      const x: any = d.data();
      const k = `${x.userUid}|${x.semanaISO}`;
      const cur = paidIndex.get(k) || {};
      for (const [kk, vv] of Object.entries(x.totals || {})) {
        cur[kk] = (cur[kk] || 0) + Number(vv || 0);
      }
      paidIndex.set(k, cur);
    });

    const freeSnap = await getDocs(
      query(
        collection(db, "metas_semanais_targets"),
        where("semanaISO", "in", weeksISO),
        where("userUid", "==", userUid)
      )
    );
    const livreIndex = new Set<string>();
    freeSnap.forEach(d => {
      const x: any = d.data();
      if (x?.metaLivre) livreIndex.add(`${x.userUid}|${x.semanaISO}`);
    });

    return { paidIndex, livreIndex };
  };

  const makeGetTemplateForWeek = (templates: Array<{effectiveFromMondayISO:string; targets:Record<string,number>}>) => {
    return (weekISO: string) => {
      const list = templates.filter(t => t.effectiveFromMondayISO <= weekISO);
      return list.length ? list[list.length - 1] : null;
    };
  };

  const computeStatus = (
    getTemplateForWeek: (w: string) => {targets:Record<string,number>} | null,
    paidIndex: Map<string, Record<string, number>>,
    livreIndex: Set<string>,
    userUid: string,
    semanaISO: string
  ): MetaSemanal["status"] => {
    const tpl = getTemplateForWeek(semanaISO);
    const key = `${userUid}|${semanaISO}`;
    const isFree = livreIndex.has(key);
    if (!tpl || Object.keys(tpl.targets || {}).length === 0) {
      return "desconhecido";
    }
    if (isFree) return "meta_livre";

    const paid = paidIndex.get(key) || {};
    const allCovered = Object.entries(tpl.targets).every(([k, v]) => Number(paid[k] || 0) >= Number(v || 0));
    if (allCovered) return "confirmado";
    return "nao_pagou";
  };

  const fetchMetasSemanais_Last4 = async () => {
    try {
      if (!loggedUser) return;
      const myId = (loggedUser as any).uid || loggedUser.id;

      // SEGUNDA a DOMINGO — pular semana atual e pegar 4 concluídas
      const mon = startOfWeekMonday(new Date());
      const weeksISO = [1,2,3,4].map(i => isoWeekKeyFromMonday(addWeeks(mon, -i)));

      const templates = await loadTemplates();
      const { paidIndex, livreIndex } = await loadPaidAndFree(weeksISO, myId);
      const getTemplateForWeek = makeGetTemplateForWeek(templates);

      const last4: MetaSemanal[] = weeksISO.map(iso => ({
        id: iso,
        status: computeStatus(getTemplateForWeek, paidIndex, livreIndex, myId, iso),
        semanaRef: iso,
      }));

      setMetas(last4);
    } catch (e) {
      console.error(e);
      setMetas([]);
    }
  };

  /* =========================
     Ações de CRUD
  ========================= */
  const handleCreateUser = async (): Promise<void> => {
    if (!loggedUser) return;
    if (!canCreateUser(loggedUser.roleLevel)) {
      toast.error("Sem permissão para criar usuário.");
      return;
    }

    if (!newUser.nome || !newUser.email || !(newUser as any).senha) {
      toast.error("Preencha os campos obrigatórios!");
      return;
    }

    const payload: Omit<User, "id" | "uid"> = {
      ...newUser,
      roleLevel: newUser.roleLevel as RoleLevel,
      pastaNumero: (newUser.pastaNumero ?? "").toString().trim(),
    };

    try {
      const cred = await createUserWithEmailAndPassword(auth, payload.email!, (newUser as any).senha!);
      const uid = cred.user.uid;

      const { senha: _omit, ...toSave } = payload;

      await setDoc(doc(db, "users", uid), {
        ...toSave,
        uid,
        criadoEm: new Date(),
      });

      await fetch("/api/personalWebhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autor: loggedUser?.nome ?? "Desconhecido",
          ...toSave,
        }),
      }).catch(() => {});

      await fetch("/api/geralWebhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acao: "criado",
          autor: loggedUser?.nome ?? "Desconhecido",
          usuario: {
            nome: toSave.nome,
            email: toSave.email,
            discord: toSave.discord,
            passaport: toSave.passaport,
            roleLevel: toSave.roleLevel,
            pasta: toSave.pasta,
            pastaNumero: toSave.pastaNumero,
          },
        }),
      }).catch(() => {});

      setShowCreate(false);
      setNewUser({
        email: "",
        senha: "",
        nome: "",
        passaport: "",
        discord: "",
        roleLevel: 6,
        pasta: "",
        pastaNumero: "",
      });

      fetchUsers();
      toast.success("Usuário criado com sucesso!");
    } catch (err) {
      console.error("Erro ao criar usuário:", err);
      toast.error("Erro ao criar usuário");
    }
  };

  const handleSendPasswordReset = async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email);
      toast.success("E-mail de redefinição enviado!");
    } catch (e) {
      console.error(e);
      toast.error("Falha ao enviar e-mail de redefinição.");
    }
  };

  const handleSaveEdit = async () => {
    if (!editUser || !loggedUser) return;

    if (!canEditTarget(loggedUser.roleLevel, (editUser.roleLevel as number))) {
      toast.error("Sem permissão para editar este usuário.");
      return;
    }

    try {
      const antigoSnap = await getDoc(doc(db, "users", editUser.id!));
      const antigo = antigoSnap.exists() ? ({ id: antigoSnap.id, ...antigoSnap.data() } as any) : null;

      const { id, senha: _discardPwd, ...data } = editUser as User;
      const dataToSave: Record<string, any> = {
        ...data,
        pastaNumero: (editUser.pastaNumero ?? "").toString().trim(),
      };

      await updateDoc(doc(db, "users", editUser.id!), dataToSave);

      const alteracoes: string[] = [];
      if (antigo) {
        ["nome", "email", "passaport", "discord", "pasta", "pastaNumero", "roleLevel"].forEach((campo) => {
          if ((antigo as any)[campo] !== (editUser as any)[campo]) {
            alteracoes.push(`${campo}: ${(antigo as any)[campo] ?? ""} ➜ ${(editUser as any)[campo] ?? ""}`);
          }
        });
      }

      await fetch("/api/geralWebhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acao: "editado",
          autor: loggedUser?.nome ?? "Desconhecido",
          usuario: {
            nome: editUser.nome,
            email: editUser.email,
            discord: editUser.discord,
            passaport: editUser.passaport,
            roleLevel: editUser.roleLevel,
            pasta: editUser.pasta,
            pastaNumero: editUser.pastaNumero,
          },
          alteracoes,
        }),
      }).catch(() => {});

      toast.success("Usuário atualizado!");
      setShowEdit(false);
      setEditUser(null);
      setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
      fetchUsers();
    } catch (err: any) {
      console.error("Erro ao salvar as alterações:", err);
      toast.error("Erro ao salvar alterações.");
    }
  };

  const handleDeleteUser = async (user: User) => {
    if (!loggedUser) return;

    if (!canDeleteTarget(loggedUser.roleLevel, user.roleLevel as number)) {
      toast.error("Sem permissão para excluir este usuário.");
      return;
    }

    if (user.roleLevel === 1) {
      const snap = await getDocs(query(collection(db, "users"), where("roleLevel", "==", 1)));
      if (snap.size <= 1) {
        toast.error("Não é permitido excluir o último usuário CHEFE (role 1).");
        return;
      }
    }

    if (!window.confirm(`Deseja realmente excluir ${user.nome}?`)) return;

    try {
      await deleteDoc(doc(db, "users", user.id!));

      const authInstance = getAuth();
      const currentUser = authInstance.currentUser;
      if (currentUser && currentUser.uid === user.id) {
        await deleteUser(currentUser);
      }

      await fetch("/api/geralWebhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acao: "excluido",
          autor: loggedUser?.nome ?? "Desconhecido",
          usuario: {
            nome: user.nome,
            email: user.email,
            discord: user.discord,
            passaport: user.passaport,
            roleLevel: user.roleLevel,
            pasta: user.pasta,
            pastaNumero: user.pastaNumero,
          },
        }),
      }).catch(() => {});

      toast.success("Usuário excluído com sucesso!");
      fetchUsers();
    } catch (err) {
      console.error("Erro ao excluir usuário:", err);
      toast.error("Erro ao excluir usuário");
    }
  };

  /* =========================
     Alertas — ações
  ========================= */
  // Envia novo alerta (roles 1–5)
  const handleSendAlert = async () => {
    if (!loggedUser) return;
    const myRole = Number(loggedUser.roleLevel) as RoleLevel;
    if (![1,2,3,4,5].includes(myRole)) {
      toast.error("Sem permissão para enviar alertas.");
      return;
    }
    const msg = newAlertMsg.trim();
    if (!msg) {
      toast.error("Escreva a mensagem do alerta.");
      return;
    }

    try {
      setSendingAlert(true);
      await addDoc(collection(db, "alerts"), {
        message: msg,
        authorUid: loggedUser.id,
        authorName: loggedUser.nome || "Desconhecido",
        authorRole: myRole,
        createdAt: serverTimestamp(),
      });
      setNewAlertMsg("");
      toast.success("Alerta enviado para todos!");
    } catch (e) {
      console.error(e);
      toast.error("Falha ao enviar alerta.");
    } finally {
      setSendingAlert(false);
    }
  };

  // Marca o alerta mais recente como lido pelo usuário atual
  const markLatestAsRead = async () => {
    if (!loggedUser || !latestAlert) return;
    try {
      const ackRef = doc(db, "users", loggedUser.id!, "alert_acks", latestAlert.id);
      await setDoc(ackRef, { readAt: serverTimestamp() }, { merge: true });
      setShowLatestDialog(false);
      setLatestAlert(null); // esconder banner
    } catch (e) {
      console.error(e);
      toast.error("Não foi possível marcar como lido.");
    }
  };

  /* =========================
     Filtros da tabela
  ========================= */
  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return users.filter((u) => {
      const match =
        u.nome.toLowerCase().includes(term) ||
        u.passaport?.toLowerCase().includes(term) ||
        u.discord?.toLowerCase().includes(term) ||
        (u.email?.toLowerCase().includes(term) ?? false) ||
        showPastaNumero(u.pastaNumero).toLowerCase().includes(term);
      const matchRole = filterRole === null || u.roleLevel === filterRole;
      return match && matchRole;
    });
  }, [users, search, filterRole]);

  if (!loggedUser) return null;

  /* =========================
     UI — Doc Inicial
  ========================= */
  const me = users.find(u => u.id === loggedUser.id) ?? (loggedUser as User);
  const metaMsg = metaMessage(metas);

  return (
    <div className="flex min-h-screen bg-gray-100 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <Toaster position="top-right" />
      <Sidebar activePage={activePage} setActivePage={setActivePage} />

      <main className="flex-1 p-6 md:p-10 space-y-6">
        {/* Cabeçalho / Boas-vindas */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-xl md:text-2xl font-semibold">
            Seja bem-vindo {me.nome?.split(" ")[0] ?? me.nome}
          </h1>

          <div className="flex items-center gap-2">
            {/* Trocar senha — disponível a todos (1–9) */}
            <Button
              variant="secondary"
              onClick={() => {
                setEditUser(me);
                setShowEdit(true);
                setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
              }}
            >
              Trocar senha
            </Button>

            {/* 🔔 Histórico (1–9) */}
            <Button
              variant="secondary"
              onClick={() => setShowAlertsModal(true)}
              className="flex items-center gap-2"
              title="Ver últimos alertas"
            >
              <BellAlertIcon className="w-5 h-5" />
              Alertas
            </Button>

            {/* Área Admin — só roles 1–5 */}
            {canSeeAdminButton(loggedUser.roleLevel) && (
              <Button onClick={() => setAdminMode(v => !v)}>
                {adminMode ? "Fechar Área Admin" : "Área Admin"}
              </Button>
            )}
          </div>
        </div>

        {/* Banner do alerta mais recente (se não lido) */}
        {latestAlert && (
          <div
            className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-3 cursor-pointer"
            onClick={() => setShowLatestDialog(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setShowLatestDialog(true)}
            title="Abrir alerta"
          >
            <div className="text-sm">
              <span className="font-semibold">
                {latestAlert.authorName} — {ROLE_LABELS[latestAlert.authorRole]}
              </span>
            </div>
            <div className="text-xs text-amber-900/80 dark:text-amber-200/90">
              Clique para ler o alerta.
            </div>
          </div>
        )}

        {/* Se NÃO estiver no modo admin, mostra o “doc inicial” */}
        {!adminMode && (
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Dados do usuário */}
            <div className="lg:col-span-1 bg-white dark:bg-gray-800 rounded-xl shadow p-5 space-y-3">
              <div className="flex items-center justify-between">
                <RoleBadge level={me.roleLevel as RoleLevel} />
              </div>

              <div className="grid grid-cols-1 gap-2 mt-2">
                <div>
                  <span className="text-xs text-gray-500">Nome</span>
                  <div className="text-sm">{me.nome}</div>
                </div>
                <div>
                  <span className="text-xs text-gray-500">Email</span>
                  <div className="text-sm">{me.email}</div>
                </div>
                <div>
                  <span className="text-xs text-gray-500">Passaporte</span>
                  <div className="text-sm">{me.passaport}</div>
                </div>
                {showPastaNumero(me.pastaNumero) && (
                  <div>
                    <span className="text-xs text-gray-500">Nº da pasta</span>
                    <div className="text-sm">{showPastaNumero(me.pastaNumero)}</div>
                  </div>
                )}
                {me.discord && (
                  <div>
                    <span className="text-xs text-gray-500">Discord</span>
                    <div className="text-sm">{me.discord}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Blocos lado a lado */}
            <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Suas últimas ações */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-5">
                <h2 className="text-base font-semibold mb-3">Suas últimas ações</h2>
                <div className="space-y-2">
                  {ultimasAcoes.length === 0 && (
                    <div className="text-sm text-gray-500">Sem ações recentes.</div>
                  )}
                  {ultimasAcoes.map((a) => {
                    const isWin = a.resultado === "win";
                    return (
                      <div
                        key={a.id}
                        className={`border rounded-lg px-3 py-2 text-sm ${
                          isWin
                            ? "border-emerald-300 bg-emerald-50/60 dark:bg-emerald-900/20"
                            : "border-rose-300 bg-rose-50/60 dark:bg-rose-900/20"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">{a.nomeAcao}</div>
                          <div className={`text-xs font-semibold ${isWin ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`}>
                            {isWin ? "Vitória" : "Derrota"}
                          </div>
                        </div>
                        <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                          Valor ganho: {typeof a.valorGanho === "number" ? `R$ ${a.valorGanho}` : "—"}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Sua Meta Semanal */}
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-5">
                <h2 className="text-base font-semibold mb-3">Sua Meta Semanal</h2>
                <p className="text-sm mb-3">{metaMsg}</p>

                {metas.length > 0 ? (
                  <ul className="space-y-2">
                    {metas.map((m) => (
                      <li
                        key={m.id}
                        className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                      >
                        <span className="font-medium">{weekLabel(m.semanaRef || m.id)}</span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-semibold
                            ${
                              m.status === "confirmado"
                                ? "bg-emerald-600 text-white"
                                : m.status === "meta_livre"
                                ? "bg-gray-500 text-white"
                                : m.status === "nao_pagou"
                                ? "bg-rose-600 text-white"
                                : "bg-gray-300 text-gray-800"
                            }`}
                        >
                          {m.status === "confirmado" ? "Confirmado"
                            : m.status === "meta_livre" ? "Meta Livre"
                            : m.status === "nao_pagou" ? "Atrasada"
                            : "Sem meta"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-sm text-gray-500">Sem dados das últimas semanas.</div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* =========================
            Área Admin — roles 1–5
        ========================== */}
        {adminMode && canSeeAdminArea(loggedUser.roleLevel) && (
          <section className="space-y-4">
            {/* Enviar Alerta (roles 1–5) */}
            {[1,2,3,4,5].includes(Number(loggedUser.roleLevel)) && (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow p-4">
                <h3 className="text-base font-semibold mb-2">Enviar alerta para todos</h3>
                <textarea
                  className="w-full rounded border bg-white/80 dark:bg-gray-700 p-2 text-sm"
                  rows={3}
                  placeholder="Escreva a mensagem do alerta..."
                  value={newAlertMsg}
                  onChange={(e) => setNewAlertMsg(e.target.value)}
                />
                <div className="flex justify-end pt-2">
                  <Button onClick={handleSendAlert} disabled={sendingAlert}>
                    {sendingAlert ? "Enviando..." : "Enviar alerta"}
                  </Button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  O alerta mostrará <strong>seu nome</strong>, sua <strong>hierarquia</strong> e a mensagem.
                </p>
              </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              <Input
                className="w-80"
                placeholder="Pesquisar por nome, passaporte, discord, e nº da pasta..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              {canCreateUser(loggedUser.roleLevel) && (
                <Button onClick={() => setShowCreate(true)} className="flex items-center gap-2">
                  <PlusIcon className="w-5 h-5" /> Criar Usuário
                </Button>
              )}

              <Button
                variant="secondary"
                onClick={() => {
                  const self = users.find(u => u.id === loggedUser.id);
                  if (self) {
                    setEditUser(self);
                    setShowEdit(true);
                    setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
                  }
                }}
              >
                Alterar minha senha
              </Button>
            </div>

            <div className="flex flex-wrap gap-2 mt-2">
              {(Object.keys(ROLE_LABELS) as unknown as RoleLevel[]).map((level) => (
                <button
                  key={level}
                  onClick={() => setFilterRole(filterRole === level ? null : level)}
                  className={`px-3 py-1 rounded-full text-white text-sm transition ${
                    filterRole === level
                      ? `${ROLE_COLORS[level]} ring-2 ring-offset-1 ring-offset-gray-100 dark:ring-offset-gray-900`
                      : `${ROLE_COLORS[level]} opacity-80 hover:opacity-100`
                  }`}
                  title={ROLE_LABELS[level]}
                >
                  <span className="mr-1">{ROLE_EMOJIS[level]}</span>
                  {ROLE_LABELS[level]}
                </button>
              ))}
              {filterRole !== null && (
                <button onClick={() => setFilterRole(null)} className="px-3 py-1 rounded-full bg-gray-500 text-white text-sm">
                  Limpar filtro
                </button>
              )}
            </div>

            {/* Tabela */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm mt-2">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Nome</th>
                    <th className="text-left p-2">Email</th>
                    <th className="text-left p-2">Passaporte</th>
                    <th className="text-left p-2">Discord</th>
                    <th className="text-left p-2">Pasta</th>
                    <th className="text-left p-2">Nº da pasta</th>
                    <th className="text-left p-2">Hierarquia</th>
                    <th className="text-left p-2">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => {
                    const canEdit = canEditTarget(loggedUser.roleLevel, u.roleLevel as number);
                    const canDelete = canDeleteTarget(loggedUser.roleLevel, u.roleLevel as number);

                    return (
                      <tr key={u.id} className="border-b">
                        <td className="p-2">{u.nome}</td>
                        <td className="p-2">{u.email}</td>
                        <td className="p-2">{u.passaport}</td>
                        <td className="p-2">{u.discord}</td>

                        {/* Pasta: "Nome - Nº" (toast com link se houver) */}
                        <td className="p-2">
                          <span
                            role={u.pasta ? "button" : undefined}
                            tabIndex={u.pasta ? 0 : -1}
                            className={`${u.pasta ? "underline decoration-dotted cursor-pointer hover:decoration-solid" : ""} outline-none`}
                            title={u.pasta || ""}
                            onClick={() => { if (u.pasta) toast(u.pasta); }}
                            onKeyDown={(e) => {
                              if (u.pasta && (e.key === "Enter" || e.key === " ")) {
                                e.preventDefault();
                                toast(u.pasta);
                              }
                            }}
                          >
                            {u.nome}{showPastaNumero(u.pastaNumero) ? ` - ${showPastaNumero(u.pastaNumero)}` : ""}
                          </span>
                        </td>

                        {/* Exibe somente o número */}
                        <td className="p-2">{showPastaNumero(u.pastaNumero)}</td>

                        <td className="p-2">
                          <RoleBadge level={u.roleLevel as RoleLevel} />
                        </td>

                        <td className="p-2 flex gap-1">
                          {canEdit && (
                            <Button
                              size="sm"
                              onClick={() => {
                                setEditUser(u);
                                setShowEdit(true);
                                setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
                              }}
                            >
                              <PencilSquareIcon className="w-4 h-4" />
                            </Button>
                          )}

                          {canDelete && (
                            <Button size="sm" variant="destructive" onClick={() => handleDeleteUser(u)}>
                              <TrashIcon className="w-4 h-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      {/* ============ Modais ============ */}

      {/* Modal: Últimos alertas (10) */}
      {showAlertsModal && (
        <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 w-full max-w-lg rounded-xl shadow-xl">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold">Últimos alertas</h3>
              <button onClick={() => setShowAlertsModal(false)} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-3 max-h-[70vh] overflow-auto">
              {alerts.length === 0 && (
                <div className="text-sm text-gray-500">Nenhum alerta encontrado.</div>
              )}
              {alerts.map((a) => (
                <div key={a.id} className="rounded-lg border p-3 bg-amber-50/60 dark:bg-amber-900/10">
                  <div className="text-sm font-semibold">
                    {a.authorName} — {ROLE_LABELS[a.authorRole]}
                  </div>
                  <div className="text-sm mt-1 whitespace-pre-wrap">{a.message}</div>
                  <div className="text-[11px] text-gray-500 mt-1">
                    {a.createdAt?.toDate ? a.createdAt.toDate().toLocaleString() : "—"}
                  </div>
                </div>
              ))}
            </div>

            <div className="p-3 border-t flex justify-end">
              <Button variant="secondary" onClick={() => setShowAlertsModal(false)}>Fechar</Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: conteúdo do alerta mais recente (banner) */}
      {showLatestDialog && latestAlert && (
        <div className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 w-full max-w-md rounded-xl shadow-xl">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold">Alerta</h3>
              <button onClick={() => setShowLatestDialog(false)} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10">
                <XMarkIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-2">
              <div className="text-sm font-semibold">
                {latestAlert.authorName} — {ROLE_LABELS[latestAlert.authorRole]}
              </div>
              <div className="text-sm whitespace-pre-wrap">{latestAlert.message}</div>
              <div className="text-[11px] text-gray-500 mt-1">
                {latestAlert.createdAt?.toDate ? latestAlert.createdAt.toDate().toLocaleString() : "—"}
              </div>
            </div>

            <div className="p-3 border-t flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowLatestDialog(false)}>Fechar</Button>
              <Button onClick={markLatestAsRead}>Marcar como lido</Button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Modais originais (Editar / Criar) ===== */}

      {/* Modal Editar */}
      {showEdit && editUser && (
        <div className="fixed inset-0 z-[9999] bg-black/50 flex items-stretch md:items-center justify-center p-0 md:p-4">
          <div className="bg-white dark:bg-gray-800 w-full h-full rounded-none overflow-y-auto
                          md:w-full md:max-w-md md:max-h-[85vh] md:rounded-xl shadow-xl">
            <div className="p-4 md:p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  {canEditTarget(loggedUser.roleLevel, editUser.roleLevel as number) ? "Editar usuário" : "Alterar senha"}
                </h2>
                <button
                  onClick={() => { setShowEdit(false); setCurrentPwd(""); setNewPwd(""); setConfirmPwd(""); }}
                  className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10"
                >
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>

              {/* Trocar senha (self 1–9) */}
              {(!canEditTarget(loggedUser.roleLevel, (editUser.roleLevel as number)) || loggedUser.id === editUser.id) && (
                <div className="grid grid-cols-1 gap-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Senha atual</label>
                    <Input type="password" value={currentPwd} onChange={(e) => setCurrentPwd(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Nova senha</label>
                    <Input type="password" value={newPwd} onChange={(e) => setNewPwd(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Confirmar nova senha</label>
                    <Input type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} />
                  </div>
                  <p className="text-xs text-gray-500">A senha deve ter pelo menos 6 caracteres.</p>
                  <div className="flex justify-end gap-2 pt-3">
                    <Button
                      variant="secondary"
                      onClick={() => { setShowEdit(false); setCurrentPwd(""); setNewPwd(""); setConfirmPwd(""); }}
                    >
                      Cancelar
                    </Button>
                    <Button
                      onClick={async () => {
                        try {
                          if (!currentPwd || !newPwd || !confirmPwd) {
                            toast.error("Preencha senha atual, nova e confirmação.");
                            return;
                          }
                          if (newPwd.length < 6) {
                            toast.error("A nova senha deve ter pelo menos 6 caracteres.");
                            return;
                          }
                          if (newPwd !== confirmPwd) {
                            toast.error("As senhas não conferem.");
                            return;
                          }

                          const authInstance = getAuth();
                          if (!authInstance.currentUser || authInstance.currentUser.uid !== editUser.id) {
                            toast.error("Sessão inválida. Faça login novamente.");
                            return;
                          }

                          const cred = EmailAuthProvider.credential(editUser.email!, currentPwd);
                          await reauthenticateWithCredential(authInstance.currentUser, cred);
                          await updatePassword(authInstance.currentUser, newPwd);

                          await fetch("/api/geralWebhook", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              acao: "senha_alterada",
                              autor: editUser.nome,
                              usuario: { uid: editUser.id, email: editUser.email },
                            }),
                          }).catch(() => {});

                          toast.success("Senha atualizada com sucesso!");
                          setShowEdit(false);
                          setEditUser(null);
                          setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
                        } catch (err: any) {
                          console.error(err);
                          if (err?.code === "auth/requires-recent-login") {
                            toast.error("Por segurança, faça login novamente e tente alterar a senha.");
                          } else if (err?.code === "auth/wrong-password") {
                            toast.error("Senha atual incorreta.");
                          } else {
                            toast.error("Erro ao atualizar senha.");
                          }
                        }
                      }}
                    >
                      Salvar
                    </Button>
                  </div>
                </div>
              )}

              {/* Form de edição (1 edita 1–9 | 2 edita 2–9 | 3 edita 3–9) */}
              {canEditTarget(loggedUser.roleLevel, (editUser.roleLevel as number)) && (
                <>
                  {[
                    ["nome", "text", "Nome"],
                    ["email", "email", "Email"],
                    ["passaport", "text", "Passaporte"],
                    ["discord", "text", "Discord"],
                    ["pasta", "text", "Pasta"],
                    ["pastaNumero", "text", "Nº da pasta"],
                  ].map(([field, type, label]) => (
                    <div key={field} className="space-y-1">
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-300">{label}</label>
                      <Input
                        type={type as any}
                        value={(editUser as any)[field] ?? ""}
                        onChange={(e) => setEditUser({ ...editUser!, [field as keyof User]: e.target.value } as User)}
                      />
                    </div>
                  ))}

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Hierarquia</label>
                    <select
                      value={editUser.roleLevel as number}
                      onChange={(e) => setEditUser({ ...editUser!, roleLevel: Number(e.target.value) as RoleLevel })}
                      className="w-full p-2 rounded border border-gray-300 dark:bg-gray-700"
                    >
                      {(Object.keys(ROLE_LABELS) as unknown as RoleLevel[]).map((lv) => (
                        <option key={lv} value={lv}>{ROLE_LABELS[lv]}</option>
                      ))}
                    </select>
                  </div>

                  {(loggedUser.roleLevel === 1 || loggedUser.roleLevel === 2) && (
                    <div className="pt-2">
                      <Button variant="secondary" onClick={() => handleSendPasswordReset(editUser.email!)}>
                        Enviar e-mail de redefinição de senha
                      </Button>
                      <p className="text-xs text-gray-500 mt-1">
                        Por segurança, senhas de terceiros são redefinidas via e-mail.
                      </p>
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-3">
                    <Button
                      variant="secondary"
                      onClick={() => { setShowEdit(false); setCurrentPwd(""); setNewPwd(""); setConfirmPwd(""); }}
                    >
                      Cancelar
                    </Button>
                    <Button onClick={handleSaveEdit}>Salvar</Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Criar */}
      {showCreate && (
        <div className="fixed inset-0 z-[9999] bg-black/50 flex items-stretch md:items-center justify-center p-0 md:p-4">
          <div className="bg-white dark:bg-gray-800 w-full h-full rounded-none overflow-y-auto
                          md:w-full md:max-w-md md:max-h-[85vh] md:rounded-xl shadow-xl">
            <div className="p-4 md:p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Criar usuário</h2>
                <button onClick={() => setShowCreate(false)} className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10">
                  <XMarkIcon className="w-5 h-5" />
                </button>
              </div>

              {[
                ["nome", "text", "Nome"],
                ["email", "email", "Email"],
                ["senha", "password", "Senha"],
                ["passaport", "text", "Passaporte"],
                ["discord", "text", "Discord"],
                ["pasta", "text", "Pasta"],
                ["pastaNumero", "text", "Nº da pasta"],
              ].map(([field, type, label]) => (
                <div key={field} className="space-y-1">
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-300">{label}</label>
                  <Input
                    type={type as any}
                    value={(newUser as any)[field]}
                    onChange={(e) => setNewUser({ ...newUser, [field as keyof typeof newUser]: e.target.value } as any)}
                    placeholder={field === "pastaNumero" ? "Ex.: 01" : undefined}
                  />
                </div>
              ))}

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-300">Hierarquia</label>
                <select
                  value={newUser.roleLevel as number}
                  onChange={(e) => setNewUser({ ...newUser, roleLevel: Number(e.target.value) as RoleLevel })}
                  className="w-full p-2 rounded border border-gray-300 dark:bg-gray-700"
                >
                  {(Object.keys(ROLE_LABELS) as unknown as RoleLevel[]).map((lv) => (
                    <option key={lv} value={lv}>{ROLE_LABELS[lv]}</option>
                  ))}
                </select>
              </div>

              <div className="text-xs text-gray-500">
                Usuários criados por você entram com a hierarquia selecionada acima.
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <Button variant="secondary" onClick={() => setShowCreate(false)}>
                  Cancelar
                </Button>
                <Button onClick={handleCreateUser}>Salvar</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
