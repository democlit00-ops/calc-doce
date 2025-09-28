'use client';

import { useEffect, useMemo, useState } from 'react';
import Sidebar from '@/components/ui/sidebar';
import { db, auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  query,
  orderBy,
  limit as fsLimit,
  onSnapshot,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  // ✅ para registrar entrada no estoque
  addDoc,
  // ✅ NOVOS: para metas_semanais_paid
  setDoc,
  increment,
} from 'firebase/firestore';
import {
  CheckCircleIcon,
  XCircleIcon,
  Cog6ToothIcon,
  BanknotesIcon,
  TrashIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  XMarkIcon,
} from '@heroicons/react/24/solid';

/* ====== Tipos/util ====== */
type Hierarquia = '1'|'2'|'3'|'4'|'5'|'6';
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

type IngredienteItem = { nome: string; quantidade: number; peso: number; imagemUrl?: string; };
type ProdutoFarm = {
  id: string; nome: string; imagemUrl?: string | null;
  ingredientes?: IngredienteItem[];
};

type RegistroBau = {
  id: string;
  depositoId?: string | null;
  depositoSeq?: number | null;

  displayId?: string | null;
  criadoPorUid: string | null;
  criadoPorNome: string | null;
  produtoId: string | null;
  produtoNome: string | null;
  produtoImagemUrl: string | null;

  quantidade: number;
  efedrina: number;
  poAluminio: number;
  embalagemPlastica: number;
  folhasPapel: number;
  valorDinheiro: number;

  observacao?: string;
  imagemUrl?: string | null;
  imagemExpiresAt?: string | null;

  confirmado?: boolean;

  flagMetaPaga?: boolean;
  flagFabricado?: boolean;
  flagConfirmado?: boolean;
  flagRecusado?: boolean;

  lastStatusByUid?: string | null;
  lastStatusByNome?: string | null;
  lastStatusAt?: any;

  statusLastUpdatedByUid?: string | null;
  statusLastUpdatedByNome?: string | null;
  statusLastUpdatedAt?: any;

  criadoEm?: any;
};

// ⬇️ EXTENDIDO: Guardamos possíveis campos de webhook do user
type UserIndex = {
  uid: string;
  nome?: string | null;
  pastaNumero?: string | null;
  passaport?: string | null;
  email?: string | null;

  webhookFolder?: string | null;
  discordWebhook?: string | null;
  webhook?: string | null;
  webhookUrl?: string | null;
  pasta?: string | null; // pode ser URL ou número (string)
};

type FiltroStatus = '' | 'pendente' | 'meta_paga' | 'fabricado' | 'confirmado' | 'recusado';

type ItemKey = 'meta' | 'efedrina' | 'po_aluminio' | 'embalagem' | 'papel';
type ItemDep = { key: ItemKey; label: string; valor: number };

/* ===== Helpers de Semana ISO (segunda como início) ===== */
function startOfWeekMonday(d: Date) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay(); // 0=Dom
  const diff = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - diff);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}
function isoWeekKeyFromMonday(mondayUTC: Date) {
  const dt = new Date(Date.UTC(mondayUTC.getUTCFullYear(), mondayUTC.getUTCMonth(), mondayUTC.getUTCDate()));
  dt.setUTCDate(dt.getUTCDate() + 4 - (dt.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((+dt - +yearStart) / 86400000 + 1) / 7);
  const weekStr = String(weekNo).padStart(2, '0');
  return `${dt.getUTCFullYear()}-W${weekStr}`;
}
function weekISOFromTimestamp(ts: any) {
  const d = ts?.toDate ? (ts.toDate() as Date) : new Date(ts);
  const mon = startOfWeekMonday(d);
  return isoWeekKeyFromMonday(mon);
}

/* ===== Helpers de URL p/ override do webhook (NOVOS) ===== */
function isHttpUrl(v: unknown): v is string {
  return typeof v === 'string' && /^https?:\/\//i.test(v.trim());
}
function pickFirstUrl(...vals: any[]): string | null {
  for (const v of vals) if (isHttpUrl(v)) return v.trim();
  return null;
}

/* ====== Componentes auxiliares ====== */
function ChipsStatus({ r }: { r: RegistroBau }) {
  const defs: { label: string; Icon: any; cls: string; active: boolean }[] = [
    { label: 'Meta Paga',   Icon: BanknotesIcon,  cls: 'bg-violet-100 text-violet-700', active: !!r.flagMetaPaga },
    { label: 'Fabricado',   Icon: Cog6ToothIcon,  cls: 'bg-sky-100 text-sky-700',       active: !!r.flagFabricado },
    { label: 'Confirmado',  Icon: CheckCircleIcon, cls: 'bg-green-100 text-green-700',  active: !!(r.flagConfirmado || r.confirmado) },
    { label: 'Recusado',    Icon: XCircleIcon,     cls: 'bg-red-100 text-red-700',      active: !!r.flagRecusado },
  ];
  const ativos = defs.filter(d => d.active);
  if (ativos.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-700">
        <Cog6ToothIcon className="w-4 h-4" /> Pendente
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {ativos.map((d, i) => {
        const Icon = d.Icon;
        return (
          <span key={i} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${d.cls}`}>
            <Icon className="w-4 h-4" /> {d.label}
          </span>
        );
      })}
    </div>
  );
}

function rowBgClasses(r: RegistroBau): string {
  if (r.flagRecusado) return 'bg-red-50';
  if (r.flagConfirmado || r.confirmado) return 'bg-green-50';
  if (r.flagFabricado) return 'bg-sky-50';
  if (r.flagMetaPaga) return 'bg-violet-50';
  return 'bg-yellow-50/40';
}

/* Modal genérico */
function ConfirmModal({
  open, title = 'Confirmar', message,
  confirmText = 'Confirmar', cancelText = 'Cancelar',
  onConfirm, onCancel,
}: {
  open: boolean; title?: string; message?: string;
  confirmText?: string; cancelText?: string;
  onConfirm: () => void; onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onCancel} />
      <div className="relative bg-white rounded-xl shadow-xl w-[95%] max-w-md p-5">
        <h3 className="text-lg font-semibold mb-2">{title}</h3>
        {message && <p className="text-sm text-gray-600 mb-4">{message}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-2 rounded border hover:bg-gray-50"> {cancelText} </button>
          <button onClick={onConfirm} className="px-3 py-2 rounded bg-red-600 text-white hover:bg-red-700">{confirmText}</button>
        </div>
      </div>
    </div>
  );
}

/** Modal de imagem (comprovante) */
function ImageModal({ url, onClose }: { url: string | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!url) return null;
  return (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative mx-auto mt-10 mb-8 max-w-4xl px-4">
        <button
          onClick={onClose}
          className="absolute -top-10 right-4 bg-white/90 hover:bg-white text-black rounded-full p-2 shadow"
          aria-label="Fechar"
        >
          <XMarkIcon className="w-6 h-6" />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="Comprovante" className="w-full h-auto rounded-lg shadow-2xl" />
      </div>
    </div>
  );
}

/* ====== Página ====== */
export default function PageAdm() {
  const [activePage, setActivePage] = useState('Conferir Depósitos (ADM)');
  const [hierarquia, setHierarquia] = useState<Hierarquia>('3');
  const [ready, setReady] = useState(false);

  const [registros, setRegistros] = useState<RegistroBau[]>([]);
  const [limite, setLimite] = useState(50);

  // filtros
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('');
  const [filtroProdutoId, setFiltroProdutoId] = useState<string>(''); // opcional
  const [produtos, setProdutos] = useState<ProdutoFarm[]>([]);
  const [filtroNome, setFiltroNome] = useState('');
  const [filtroPasta, setFiltroPasta] = useState('');
  const [filtroPassaport, setFiltroPassaport] = useState('');

  const [userIndex, setUserIndex] = useState<Record<string, UserIndex>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // modal excluir
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RegistroBau | null>(null);

  // modal de imagem
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  // confirmação de troca de status
  const [confirmStatusOpen, setConfirmStatusOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<{
    r: RegistroBau;
    field: 'flagMetaPaga'|'flagFabricado'|'flagConfirmado'|'flagRecusado';
    newValue: boolean;
    label: string;
  } | null>(null);

  // enviar para webhook?
  const [sendWebhook, setSendWebhook] = useState(true);

  // para salvar "quem alterou"
  const [me, setMe] = useState<{ uid: string; nome: string } | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) { setReady(true); return; }
      try {
        const usnap = await getDoc(doc(db, 'users', u.uid));
        const data = usnap.exists() ? (usnap.data() as any) : {};
        setHierarquia(normalizeRole(data.roleLevel ?? data.hierarquia ?? data.role ?? '3'));
        const nome = data.name ?? data.displayName ?? data.nome ?? u.displayName ?? u.email ?? 'Administrador';
        setMe({ uid: u.uid, nome });
      } finally {
        setReady(true);
      }
    });
    return () => unsub();
  }, []);

  const permitido = useMemo(() => ['1','2','4','5'].includes(hierarquia), [hierarquia]);

  // produtos
  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'produtosFarm'), orderBy('nome','asc')), (snap) => {
      const arr: ProdutoFarm[] = snap.docs.map(d => {
        const data = d.data() as any;
        return {
          id: d.id,
          nome: data.nome || '—',
          imagemUrl: data.imagemUrl || null,
          ingredientes: Array.isArray(data.ingredientes) ? data.ingredientes : [],
        };
      });
      setProdutos(arr);
    });
    return () => unsub();
  }, []);

  // registros stream
  useEffect(() => {
    const baseQ = query(collection(db, 'bau_registros'), orderBy('criadoEm', 'desc'), fsLimit(limite));
    const unsub = onSnapshot(baseQ, async (snap) => {
      const rows: RegistroBau[] = [];
      const uids = new Set<string>();
      snap.forEach(d => {
        const data = d.data() as any;
        rows.push({ id: d.id, ...data });
        if (data.criadoPorUid) uids.add(data.criadoPorUid);
      });
      setRegistros(rows);

      // índice de usuários
      const idx: Record<string, UserIndex> = { ...userIndex };
      for (const uid of Array.from(uids)) {
        if (!idx[uid]) {
          const us = await getDoc(doc(db, 'users', uid));
          const ud = us.exists() ? (us.data() as any) : {};
          idx[uid] = {
            uid,
            nome: ud.name ?? ud.displayName ?? ud.nome ?? null,
            pastaNumero: ud.numeroPastaCadastro ?? ud.numeroPasta ?? ud.numPasta ?? ud.pastaNumero ?? ud.pasta ?? ud['numero_da_pasta'] ?? null,
            passaport: ud.passaport ?? ud.passaporte ?? null,
            email: ud.email ?? null,

            // ⬇️ novos campos p/ override do webhook
            webhookFolder: ud.webhookFolder ?? null,
            discordWebhook: ud.discordWebhook ?? null,
            webhook: ud.webhook ?? null,
            webhookUrl: ud.webhookUrl ?? null,
            pasta: typeof ud.pasta === 'string' ? ud.pasta : null,
          };
        }
      }
      setUserIndex(idx);
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limite]);

  function matchesStatusFilter(r: RegistroBau) {
    if (!filtroStatus) return true;
    const flags = {
      meta_paga: !!r.flagMetaPaga,
      fabricado: !!r.flagFabricado,
      confirmado: !!(r.flagConfirmado || r.confirmado),
      recusado: !!r.flagRecusado,
    };
    if (filtroStatus === 'pendente') {
      return !flags.meta_paga && !flags.fabricado && !flags.confirmado && !flags.recusado;
    }
    return (flags as any)[filtroStatus];
  }

  const registrosFiltrados = useMemo(() => {
    return registros.filter(r => {
      if (filtroProdutoId && r.produtoId !== filtroProdutoId) return false;
      if (!matchesStatusFilter(r)) return false;

      const idx = r.criadoPorUid ? userIndex[r.criadoPorUid] : undefined;
      const nome = (idx?.nome || r.criadoPorNome || '').toString().toLowerCase();
      const pasta = (idx?.pastaNumero || '').toString().toLowerCase();
      const passaport = (idx?.passaport || '').toString().toLowerCase();

      if (filtroNome && !nome.includes(filtroNome.toLowerCase())) return false;
      if (filtroPasta && !pasta.includes(filtroPasta.toLowerCase())) return false;
      if (filtroPassaport && !passaport.includes(filtroPassaport.toLowerCase())) return false;
      return true;
    });
  }, [registros, filtroStatus, filtroProdutoId, filtroNome, filtroPasta, filtroPassaport, userIndex]);

  // helpers
  const produtoById = (id?: string | null) => produtos.find(p => p.id === id);
  const norm = (s?: string) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const getIngImgByKey = (p: ProdutoFarm | undefined, key: ItemKey): string | undefined => {
    if (!p) return undefined;
    if (key === 'meta') return p.imagemUrl || undefined;
    const list = p.ingredientes || [];
    const find = (pred: (i: IngredienteItem) => boolean) => list.find(pred)?.imagemUrl;
    if (key === 'efedrina') return find(i => norm(i.nome).includes('efedrin'));
    if (key === 'po_aluminio') return find(i => norm(i.nome).includes('alumin'));
    if (key === 'embalagem') return find(i => norm(i.nome).includes('embalag'));
    if (key === 'papel') return find(i => norm(i.nome).includes('papel'));
    return undefined;
  };

  // ===== regra de decisão de envio de embed (apenas quando necessário) =====
  function decideEmbed(prev: {conf:boolean; fab:boolean; rec:boolean; meta:boolean},
                      next: {conf:boolean; fab:boolean; rec:boolean; meta:boolean},
                      toggled: 'flagMetaPaga'|'flagFabricado'|'flagConfirmado'|'flagRecusado',
                      newValue: boolean) {
    // Recusado => sempre envia (vermelho)
    if (toggled === 'flagRecusado' && newValue) return { send: true, color: 'red' as const };

    // Confirmado marcado agora
    if (toggled === 'flagConfirmado' && newValue) {
      if (next.fab) return { send: true, color: 'blue' as const }; // conf + fab => azul
      return { send: true, color: 'green' as const };              // conf sem fab => verde
    }

    // Fabricado marcado agora
    if (toggled === 'flagFabricado' && newValue) {
      if (next.conf) return { send: true, color: 'blue' as const }; // já está confirmado -> azul
      return { send: false, color: null as any };                    // ainda não confirmado
    }

    // Meta paga nunca dispara
    if (toggled === 'flagMetaPaga' && newValue) return { send: false, color: null as any };

    // Desmarcar qualquer flag não dispara
    return { send: false, color: null as any };
  }

  /* ===== 🔑 Soma/Desfaz soma em metas_semanais_paid ===== */
  async function applyMetaPaidDelta(r: RegistroBau, sign: 1 | -1) {
    try {
      if (!r.criadoPorUid) return;
      const semanaISO = weekISOFromTimestamp(r.criadoEm);
      const paidId = `${r.criadoPorUid}_${semanaISO}`;

      // monta pacote totals com increment para cada item > 0
      const totalsPatch: Record<string, any> = {};
      const addInc = (key: string, amount: number) => {
        const val = Math.floor(Number(amount || 0));
        if (val > 0) totalsPatch[key] = increment(sign * val);
      };

      addInc('efedrina', r.efedrina);
      addInc('poAluminio', r.poAluminio);
      addInc('embalagemPlastica', r.embalagemPlastica);
      addInc('folhaPapel', r.folhasPapel);
      addInc('dinheiro', r.valorDinheiro); // dinheiro em inteiros

      if (Object.keys(totalsPatch).length === 0) return;

      await setDoc(
        doc(db, 'metas_semanais_paid', paidId),
        {
          userUid: r.criadoPorUid,
          semanaISO,
          updatedAt: serverTimestamp(),
          totals: totalsPatch, // nested merge
        },
        { merge: true }
      );

      // marca no registro (auditoria leve)
      await updateDoc(doc(db, 'bau_registros', r.id), {
        metaPaidWeekISO: semanaISO,
        metaPaidUpdatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn('applyMetaPaidDelta error:', e);
    }
  }

  async function doToggleFlag(
    r: RegistroBau,
    field: keyof Pick<RegistroBau,'flagMetaPaga'|'flagFabricado'|'flagConfirmado'|'flagRecusado'>,
    value: boolean
  ) {
    // estado anterior (considerando legado "confirmado")
    const prev = {
      meta: !!r.flagMetaPaga,
      fab:  !!r.flagFabricado,
      conf: !!(r.flagConfirmado || r.confirmado),
      rec:  !!r.flagRecusado,
    };
    // aplica o novo valor virtualmente
    const next = { ...prev };
    if (field === 'flagMetaPaga')   next.meta = value;
    if (field === 'flagFabricado')  next.fab  = value;
    if (field === 'flagConfirmado') next.conf = value;
    if (field === 'flagRecusado')   next.rec  = value;

    const patch: any = { [field]: value };
    if (field === 'flagConfirmado') patch.confirmado = value ? true : false; // compat legado
    if (me) {
      patch.lastStatusByUid = me.uid;
      patch.lastStatusByNome = me.nome;
      patch.lastStatusAt = serverTimestamp();
      patch.statusLastUpdatedByUid = me.uid;   // compat
      patch.statusLastUpdatedByNome = me.nome; // compat
      patch.statusLastUpdatedAt = serverTimestamp();
    }
    await updateDoc(doc(db, 'bau_registros', r.id), patch);

    // ✅ registrar ENTRADA no estoque quando confirmar (vínculo com o registro do baú)
    if (field === 'flagConfirmado' && value && Number(r.quantidade) > 0) {
      try {
        await addDoc(collection(db, 'stock_movements'), {
          type: 'in',
          reason: 'deposit',
          quantity: Number(r.quantidade),
          bauId: 'j4SvwoA9k24FrBFgjq5d',
          bauName: 'Baú Gerente',
          createdByUid: me?.uid || 'adm',
          createdByName: me?.nome || 'Administrador',
          roleLevel: Number(hierarquia) || 0,
          note: `Depósito confirmado de ${r.criadoPorNome || 'Usuário'}${r.depositoId ? ` • Id ${r.depositoId}` : ''}`,
          createdAt: serverTimestamp(),
          // 🔗 vínculo para auditoria
          bauRegistroId: r.id,
        });
      } catch (e) {
        console.warn('Falha ao registrar entrada no estoque (deposit):', e);
      }
    }

    // ✅ metas_semanais_paid (somar/desfazer soma)
    if (field === 'flagMetaPaga') {
      try {
        // se virou TRUE e antes era FALSE → somar
        if (value && !prev.meta) await applyMetaPaidDelta(r, +1);
        // se virou FALSE e antes era TRUE → desfazer soma
        if (!value && prev.meta) await applyMetaPaidDelta(r, -1);
      } catch (e) {
        console.warn('Erro ao atualizar metas_semanais_paid:', e);
      }
    }

    // decide se envia embed
    const decision = decideEmbed(prev, next, field, value);
    if (!decision.send || !sendWebhook || !r.criadoPorUid) return;

    // monta payload para /api/notify (inclui TODAS flags ativas)
    const registroPayload = {
      id: r.id,
      criadoPorNome: r.criadoPorNome,
      produtoId: r.produtoId,
      produtoNome: r.produtoNome,
      quantidade: r.quantidade,
      efedrina: r.efedrina,
      poAluminio: r.poAluminio,
      embalagemPlastica: r.embalagemPlastica,
      folhasPapel: r.folhasPapel,
      valorDinheiro: r.valorDinheiro,
      observacao: r.observacao ?? null,
      imagemUrl: r.imagemUrl ?? null,
      imagemExpiresAt: r.imagemExpiresAt ?? null,
      flagMetaPaga: next.meta,
      flagFabricado: next.fab,
      flagConfirmado: next.conf,
      flagRecusado: next.rec,
      confirmado: next.conf,
      status: ((): string => {
        if (next.rec) return 'recusado';
        if (next.conf && next.fab) return 'fabricado';
        if (next.conf) return 'confirmado';
        if (next.fab) return 'fabricado';
        if (next.meta) return 'meta_paga';
        return 'pendente';
      })(),
    };

    await notify(r.criadoPorUid, registroPayload);
  }

  function requestToggle(
    r: RegistroBau,
    field: 'flagMetaPaga'|'flagFabricado'|'flagConfirmado'|'flagRecusado',
    current: boolean
  ) {
    const labels: Record<typeof field, string> = {
      flagMetaPaga: 'Meta Paga',
      flagFabricado: 'Fabricado',
      flagConfirmado: 'Confirmado',
      flagRecusado: 'Recusado',
    } as const;
    setPendingStatus({ r, field, newValue: !current, label: labels[field] });
    setConfirmStatusOpen(true);
  }

  function extractBlobKey(url: string) {
    try {
      const u = new URL(url);
      return u.pathname.replace(/^\/+/, '');
    } catch { return ''; }
  }

  async function excluirRegistro(r: RegistroBau) {
    // apaga blob se existir
    if (r.imagemUrl) {
      const key = extractBlobKey(r.imagemUrl);
      if (key) {
        try {
          await fetch('/api/blob-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keys: [key] }),
          });
        } catch {}
      }
    }
    await deleteDoc(doc(db, 'bau_registros', r.id));
  }

  function fmt(ts: any) {
    try {
      if (ts?.toDate) return ts.toDate().toLocaleString('pt-BR');
      const d = new Date(ts); if (!isNaN(d.getTime())) return d.toLocaleString('pt-BR');
    } catch {}
    return '—';
  }

  // notificação (AGORA envia userWebhookOverride)
  async function notify(uid: string, registro: any) {
    try {
      const u = userIndex[uid];
      const userWebhookOverride =
        pickFirstUrl(
          u?.webhookFolder,
          u?.discordWebhook,
          u?.webhook,
          u?.webhookUrl,
          // se "pasta" for URL, também vale
          isHttpUrl(u?.pasta) ? u?.pasta : null
        ) || null;

      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, registro, userWebhookOverride }),
      });
      const json = await res.json().catch(() => ({}));
      console.log('/api/notify →', res.status, json);
    } catch (e) {
      console.warn('notify fail', e);
    }
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen">
        <Sidebar activePage={activePage} setActivePage={setActivePage} />
        <main className="flex-1 grid place-items-center">Carregando…</main>
      </div>
    );
  }

  if (!permitido) {
    return (
      <div className="flex min-h-screen">
        <Sidebar activePage={activePage} setActivePage={setActivePage} />
        <main className="flex-1 grid place-items-center p-6">
          <div className="text-center text-sm text-gray-600">
            Acesso restrito a Admin/Gerente/Supervisor.
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#f5f7fb]">
      {/* Sidebar padrão */}
      <Sidebar activePage={activePage} setActivePage={setActivePage} />

      <main className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full">
        <header className="mb-4">
          <h1 className="text-2xl md:text-3xl font-bold">Conferir Depósitos</h1>
          <p className="text-sm text-gray-600">Filtre por nº da pasta (cadastro), nome, passaport; clique para expandir. Confirmação antes de alterar status.</p>
        </header>

        {/* Filtros */}
        <section className="bg-white border border-gray-200 rounded-xl p-4 mb-4 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-7 gap-3">
          <div>
            <label className="text-xs text-gray-600">Nº da pasta (cadastro)</label>
            <input value={filtroPasta} onChange={(e)=>setFiltroPasta(e.target.value)} className="w-full mt-1 p-2 border rounded" />
          </div>
          <div>
            <label className="text-xs text-gray-600">Nome</label>
            <input value={filtroNome} onChange={(e)=>setFiltroNome(e.target.value)} className="w-full mt-1 p-2 border rounded" />
          </div>
          <div>
            <label className="text-xs text-gray-600">Passaport</label>
            <input value={filtroPassaport} onChange={(e)=>setFiltroPassaport(e.target.value)} className="w-full mt-1 p-2 border rounded" />
          </div>
          <div>
            <label className="text-xs text-gray-600">Produto (opcional)</label>
            <select value={filtroProdutoId} onChange={(e)=>setFiltroProdutoId(e.target.value)} className="w-full mt-1 p-2 border rounded bg-white">
              <option value="">Todos</option>
              {produtos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600">Status (filtro)</label>
            <select value={filtroStatus} onChange={(e)=>setFiltroStatus(e.target.value as FiltroStatus)} className="w-full mt-1 p-2 border rounded bg-white">
              <option value="">Todos</option>
              <option value="pendente">Pendente</option>
              <option value="meta_paga">Meta Paga</option>
              <option value="fabricado">Fabricado</option>
              <option value="confirmado">Confirmado</option>
              <option value="recusado">Recusado</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-600">Mostrar</label>
            <select value={limite} onChange={(e)=>setLimite(Number(e.target.value))} className="w-full mt-1 p-2 border rounded bg-white">
              <option value={20}>20</option><option value={50}>50</option><option value={100}>100</option>
            </select>
          </div>
        </section>

        {/* LISTA EXPANSÍVEL */}
        <section className="space-y-3">
          {registrosFiltrados.map((r) => {
            const idx = r.criadoPorUid ? userIndex[r.criadoPorUid] : undefined;
            const nome = idx?.nome || r.criadoPorNome || '—';
            const pasta = idx?.pastaNumero || '—';
            const passaport = idx?.passaport || '—';

            const isOpen = !!expanded[r.id];
            const bg = rowBgClasses(r);
            const produto = produtoById(r.produtoId || undefined);

            // Id exibido igual à page do usuário
            const displayId = r.depositoId || r.displayId || r.id.slice(-6);

            const baseItens: ItemDep[] = [
              { key: 'meta',        label: r.produtoNome || 'Meta (unid.)', valor: Number(r.quantidade || 0) },
              { key: 'efedrina',    label: 'Efedrina',                      valor: Number(r.efedrina || 0) },
              { key: 'po_aluminio', label: 'Pó de alumínio',                valor: Number(r.poAluminio || 0) },
              { key: 'embalagem',   label: 'Embalagem plástica',            valor: Number(r.embalagemPlastica || 0) },
              { key: 'papel',       label: 'Folhas de papel',               valor: Number(r.folhasPapel || 0) },
            ];
            const itens = baseItens.filter(i => i.valor > 0);

            const dinheiroInfo = Number(r.valorDinheiro) > 0
              ? (r.valorDinheiro).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
              : null;

            // usa os novos campos; se não existirem, cai nos antigos
            const lastNome = r.lastStatusByNome ?? r.statusLastUpdatedByNome ?? null;
            const lastAtRaw = r.lastStatusAt ?? r.statusLastUpdatedAt ?? null;

            return (
              <article key={r.id} className={`rounded-xl border border-gray-200 overflow-hidden ${bg}`}>
                {/* Linha de topo */}
                <button
                  onClick={() => setExpanded(prev => ({ ...prev, [r.id]: !prev[r.id] }))}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg_black/5 hover:bg-black/5 text-left"
                  title="Clique para expandir"
                >
                  <div className="flex items-center gap-3">
                    {isOpen ? <ChevronDownIcon className="w-5 h-5 text-gray-600" /> : <ChevronRightIcon className="w-5 h-5 text-gray-600" />}
                    <div className="text-sm">
                      <div className="font-medium">
                        <span className="text-gray-500">Id:</span> {displayId} • {nome}
                      </div>
                      <div className="text-xs text-gray-600">
                        Pasta: <strong>{pasta}</strong> • Passaport: <strong>{passaport}</strong>
                      </div>
                    </div>
                  </div>
                  <div className="pr-1">
                    <ChipsStatus r={r} />
                  </div>
                </button>

                {/* Conteúdo expandido */}
                {isOpen && (
                  <div className="px-3 pb-3">
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr,220px] gap-3">
                      {/* Depósito */}
                      <div className="rounded-lg border border-gray-200 bg-white/60 p-3">
                        <h4 className="text-sm font-semibold mb-2">Depósito</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                          {itens.map((i, idx) => {
                            const img = getIngImgByKey(produto, i.key);
                            return (
                              <div key={idx} className="rounded-lg border border-gray-200 bg-white p-2 flex items-center gap-2">
                                {img
                                  ? <img src={img} alt={i.label} className="w-6 h-6 rounded object-cover border" />
                                  : <span className="inline-block w-6 h-6 rounded border border-dashed border-gray-300" />}
                                <div>
                                  <div className="text-gray-500">{i.label}</div>
                                  <div className="font-medium">{i.valor}</div>
                                </div>
                              </div>
                            );
                          })}
                          {dinheiroInfo && (
                            <div className="rounded-lg border border-gray-200 bg-white p-2 flex items-center gap-2">
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded border border-gray-300 text-gray-700">
                                <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden="true">
                                  <path d="M3 6h18v12H3z" opacity=".2"/>
                                  <path d="M21 5H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1ZM4 7h16v10H4V7Zm3 2a2 2 0 0 0-2 2h2v-2Zm12 2a2 2 0 0 0-2-2v2h2Zm-2 6a2 2 0 0 0 2-2h-2v2ZM5 15a2 2 0 0 0 2 2v-2H5Zm7-6a4 4 0 1 0 .001 8.001A4 4 0 0 0 12 9Zm0 2a2 2 0 1 1-.001 4.001A2 2 0 0 1 12 11Z"/>
                                </svg>
                              </span>
                              <div>
                                <div className="text-gray-500">Dinheiro</div>
                                <div className="font-medium">{dinheiroInfo}</div>
                              </div>
                            </div>
                          )}
                          {(!itens.length && !dinheiroInfo) && (
                            <div className="text-gray-500">Sem valores.</div>
                          )}
                        </div>

                        {(r.lastStatusByNome || r.statusLastUpdatedByNome || r.lastStatusAt || r.statusLastUpdatedAt) && (
                          <p className="mt-2 text-xs text-gray-600">
                            Última alteração: <strong>{(r.lastStatusByNome ?? r.statusLastUpdatedByNome) || '—'}</strong>
                            {(r.lastStatusAt ?? r.statusLastUpdatedAt)?.toDate ? ` em ${fmt((r.lastStatusAt ?? r.statusLastUpdatedAt).toDate())}` : ''}
                          </p>
                        )}
                      </div>

                      {/* Comprovante */}
                      <div className="rounded-lg border border-gray-200 bg-white/60 p-3">
                        <h4 className="text-sm font-semibold mb-2">Comprovante</h4>
                        {r.imagemUrl ? (
                          <button
                            type="button"
                            onClick={() => setPreviewUrl(r.imagemUrl!)}
                            className="inline-block rounded border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50"
                          >
                            Ver comprovante
                          </button>
                        ) : (
                          <div className="text-sm text-gray-500">Sem comprovante</div>
                        )}
                        {r.imagemExpiresAt && (
                          <div className="text-[11px] text-gray-500 mt-1">
                            expira {new Date(r.imagemExpiresAt).toLocaleDateString('pt-BR')}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Ações */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <label className="inline-flex items-center gap-2 mr-2 text-xs">
                        <input
                          type="checkbox"
                          checked={sendWebhook}
                          onChange={e => setSendWebhook(e.target.checked)}
                        />
                        <span>Enviar para webhook</span>
                      </label>

                      <button
                        onClick={() => requestToggle(r, 'flagMetaPaga', !!r.flagMetaPaga)}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs border ${r.flagMetaPaga ? 'bg-violet-600 text-white border-violet-700' : 'bg-white text-violet-700 border-violet-300'}`}
                      >
                        <BanknotesIcon className="w-4 h-4" /> Meta Paga
                      </button>
                      <button
                        onClick={() => requestToggle(r, 'flagFabricado', !!r.flagFabricado)}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs border ${r.flagFabricado ? 'bg-sky-600 text-white border-sky-700' : 'bg-white text-sky-700 border-sky-300'}`}
                      >
                        <Cog6ToothIcon className="w-4 h-4" /> Fabricado
                      </button>
                      <button
                        onClick={() => requestToggle(r, 'flagConfirmado', !!(r.flagConfirmado || r.confirmado))}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs border ${(r.flagConfirmado || r.confirmado) ? 'bg-green-600 text-white border-green-700' : 'bg-white text-green-700 border-green-300'}`}
                      >
                        <CheckCircleIcon className="w-4 h-4" /> Confirmado
                      </button>
                      <button
                        onClick={() => requestToggle(r, 'flagRecusado', !!r.flagRecusado)}
                        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs border ${r.flagRecusado ? 'bg-red-600 text-white border-red-700' : 'bg-white text-red-700 border-red-300'}`}
                      >
                        <XCircleIcon className="w-4 h-4" /> Recusado
                      </button>

                      <span className="mx-2 h-6 w-px bg-gray-300" />

                      <button
                        onClick={() => { setPendingDelete(r); setConfirmOpen(true); }}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded text-xs border bg-white hover:bg-red-50 text-red-700 border-red-300"
                      >
                        <TrashIcon className="w-4 h-4" /> Excluir
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}

          {registrosFiltrados.length === 0 && (
            <div className="text-center text-gray-500 py-10">
              Nenhum registro encontrado.
            </div>
          )}
        </section>
      </main>

      {/* Modal de confirmação de exclusão */}
      <ConfirmModal
        open={confirmOpen}
        title="Excluir registro"
        message={`Tem certeza que deseja excluir este registro? Essa ação não pode ser desfeita.`}
        confirmText="Excluir"
        cancelText="Cancelar"
        onCancel={() => { setConfirmOpen(false); setPendingDelete(null); }}
        onConfirm={async () => {
          if (pendingDelete) {
            await excluirRegistro(pendingDelete);
          }
          setConfirmOpen(false);
          setPendingDelete(null);
        }}
      />

      {/* Modal de confirmação de status */}
      <ConfirmModal
        open={confirmStatusOpen}
        title="Alterar status"
        message={pendingStatus ? `Deseja ${pendingStatus.newValue ? 'marcar' : 'desmarcar'} "${pendingStatus.label}"?` : ''}
        confirmText="Sim"
        cancelText="Cancelar"
        onCancel={() => { setConfirmStatusOpen(false); setPendingStatus(null); }}
        onConfirm={async () => {
          if (pendingStatus) {
            const { r, field, newValue } = pendingStatus;
            await doToggleFlag(r, field, newValue);
          }
          setConfirmStatusOpen(false);
          setPendingStatus(null);
        }}
      />

      {/* Modal de imagem */}
      <ImageModal url={previewUrl} onClose={() => setPreviewUrl(null)} />
    </div>
  );
}
