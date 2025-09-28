// /app/meta/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Sidebar from '@/components/ui/sidebar';
import { auth, db } from '@/lib/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  addDoc,
  setDoc,
  where,
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import {
  PlusIcon,
  XMarkIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  UserIcon,
  CheckCircleIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';

/* =========================
   Tipos
========================= */
type LoggedUserLocal = {
  id: string;
  uid: string;
  nome: string;
  email: string;
  roleLevel: number; // 1..6
  createdAt?: any;
};

type ProdutoFarm = {
  id: string;
  nome: string;
  ativo?: boolean;
  imagemUrl?: string;
  ingredientes: { nome: string; quantidade?: number; peso?: number; imagemUrl?: string }[];
};

type MetaTemplate = {
  id: string;
  effectiveFromMondayISO: string; // "YYYY-Www"
  targets: Record<string, number>; // ex.: { efedrina: 200, poAluminio: 300, dinheiro: 3000 }
  createdAt?: any;
  createdByUid?: string;
  createdByNome?: string;
  note?: string;
};

type PaidDoc = {
  id: string;
  userUid: string;
  semanaISO: string;
  totals: Record<string, number>;
};

type MetaLivreDoc = {
  id: string;
  userUid: string;
  semanaISO: string;
  metaLivre: boolean;
};

/* =========================
   Helpers de data/semana
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
  const weekStr = String(weekNo).padStart(2, '0');
  return `${dt.getUTCFullYear()}-W${weekStr}`;
}
function isoWeekKeyFromMonday(mondayUTC: Date) {
  return isoWeekKeyFromDate(mondayUTC);
}
function nextMondayUTC(from: Date) {
  return startOfWeekMonday(addWeeks(from, 1));
}
function isPastWeek(weekISO: string) {
  const curISO = isoWeekKeyFromMonday(startOfWeekMonday(new Date()));
  return weekISO < curISO;
}
function mondayFromISO(iso: string) {
  const [yStr, wStr] = iso.split('-W');
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
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}
function weekLabel(iso: string) {
  const mon = mondayFromISO(iso);
  const sun = sundayFromISO(iso);
  return `${fmtDM(mon)} — ${fmtDM(sun)}`;
}
function weekDistance(aISO: string, bISO: string) {
  const [aY, aW] = aISO.split('-W').map(Number);
  const [bY, bW] = bISO.split('-W').map(Number);
  return (bY - aY) * 52 + (bW - aW);
}

/* =========================
   Slug/keys <-> rótulos + imagens
========================= */
function slugifyKey(s: string) {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
function toCamelFromSlug(slug: string) {
  return slug.split('-').map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1))).join('');
}
const NAME_MAP: Record<string, string> = {
  'po-de-aluminio': 'poAluminio',
  'embalagem-plastica': 'embalagemPlastica',
  'folha-de-papel': 'folhaPapel',
  efedrina: 'efedrina',
};
function labelFromKey(k: string) {
  if (k === 'poAluminio') return 'Pó de alumínio';
  if (k === 'embalagemPlastica') return 'Embalagem plástica';
  if (k === 'folhaPapel') return 'Folha de papel';
  if (k === 'efedrina') return 'Efedrina';
  if (k === 'dinheiro') return 'Dinheiro';
  return k.replace(/([A-Z])/g, ' $1').replace(/^\w/, (m) => m.toUpperCase());
}

/* =========================
   UI auxiliares
========================= */
const Tag = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border ${className}`}>{children}</span>
);

const ImgMini: React.FC<{ src?: string; alt: string; size?: number }> = ({ src, alt, size = 36 }) => (
  src ? (
    <img src={src} alt={alt} style={{ width: size, height: size }} className="rounded object-cover border" />
  ) : (
    <div style={{ width: size, height: size }} className="rounded bg-gray-200 grid place-items-center border">
      <PhotoIcon className="w-5 h-5 text-gray-500" />
    </div>
  )
);

/* =========================
   Modal: Adicionar/Editar Meta Global
========================= */
const MetaModal: React.FC<{
  open: boolean;
  onClose: () => void;
  currentUser: LoggedUserLocal;
  ingredientAssets: Record<string, { label: string; imageUrl?: string }>;
}> = ({ open, onClose, currentUser, ingredientAssets }) => {
  const [produtos, setProdutos] = useState<ProdutoFarm[]>([]);
  const [produtoId, setProdutoId] = useState('');
  const [produtoSel, setProdutoSel] = useState<ProdutoFarm | null>(null);
  const [quantias, setQuantias] = useState<Record<string, number>>({});
  const [dinheiro, setDinheiro] = useState<number>(0);
  const [effectiveMode, setEffectiveMode] = useState<'next' | 'this' | 'date'>('next');
  const [dateStr, setDateStr] = useState(''); // yyyy-mm-dd
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const snap = await getDocs(collection(db, 'produtosFarm'));
      const arr: ProdutoFarm[] = [];
      snap.forEach((d) => {
        const data = d.data() as any;
        arr.push({
          id: d.id,
          nome: data.nome,
          ativo: !!data.ativo,
          imagemUrl: data.imagemUrl,
          ingredientes: Array.isArray(data.ingredientes) ? data.ingredientes : [],
        });
      });
      arr.sort((a, b) => (b.ativo ? 1 : 0) - (a.ativo ? 1 : 0));
      setProdutos(arr);
    })();
  }, [open]);

  useEffect(() => {
    if (!produtoId) {
      setProdutoSel(null);
      setQuantias({});
      return;
    }
    const p = produtos.find((x) => x.id === produtoId) || null;
    setProdutoSel(p);
    if (p) {
      const init: Record<string, number> = {};
      (p.ingredientes || []).forEach((ing) => {
        const slug = slugifyKey(ing.nome || '');
        const key = NAME_MAP[slug] || toCamelFromSlug(slug);
        init[key] = 0;
      });
      setQuantias(init);
    }
  }, [produtoId, produtos]);

  function startOfWeekMonday(d: Date) {
    const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = date.getUTCDay();
    const diff = (day + 6) % 7;
    date.setUTCDate(date.getUTCDate() - diff);
    date.setUTCHours(0, 0, 0, 0);
    return date;
  }
  function nextMondayUTC(from: Date) {
    const d = startOfWeekMonday(new Date(from));
    d.setUTCDate(d.getUTCDate() + 7);
    return d;
  }
  function isoWeekKeyFromMonday(mondayUTC: Date) {
    const dt = new Date(Date.UTC(mondayUTC.getUTCFullYear(), mondayUTC.getUTCMonth(), mondayUTC.getUTCDate()));
    dt.setUTCDate(dt.getUTCDate() + 4 - (dt.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((+dt - +yearStart) / 86400000 + 1) / 7);
    const weekStr = String(weekNo).padStart(2, '0');
    return `${dt.getUTCFullYear()}-W${weekStr}`;
  }
  function fmtDM(d: Date) {
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}`;
  }
  function mondayFromISO(iso: string) {
    const [yStr, wStr] = iso.split('-W');
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
  function weekLabel(iso: string) {
    const mon = mondayFromISO(iso);
    const sun = sundayFromISO(iso);
    return `${fmtDM(mon)} — ${fmtDM(sun)}`;
  }

  function computeEffectiveWeekISO() {
    let monday: Date;
    if (effectiveMode === 'this') monday = startOfWeekMonday(new Date());
    else if (effectiveMode === 'next') monday = nextMondayUTC(new Date());
    else {
      if (!dateStr) return null;
      const d = new Date(dateStr + 'T00:00:00Z');
      if (isNaN(d.getTime())) return null;
      monday = startOfWeekMonday(d);
    }
    return isoWeekKeyFromMonday(monday);
  }

  async function handleSave() {
    const weekISO = computeEffectiveWeekISO();
    if (!weekISO) return alert('Selecione uma vigência válida.');

    const targets: Record<string, number> = {};
    Object.entries(quantias).forEach(([k, v]) => {
      const n = Math.max(0, Math.floor(Number(v || 0)));
      if (n > 0) targets[k] = n;
    });
    if (Number(dinheiro) > 0) targets['dinheiro'] = Math.floor(Number(dinheiro));
    if (Object.keys(targets).length === 0) return alert('Defina ao menos um item (itens > 0).');

    try {
      setSaving(true);
      await addDoc(collection(db, 'metas_templates'), {
        effectiveFromMondayISO: weekISO,
        targets,
        createdAt: serverTimestamp(),
        createdByUid: currentUser.uid,
        createdByNome: currentUser.nome || currentUser.email || 'Gestor',
      });
      onClose();
    } catch (e) {
      console.error(e);
      alert('Falha ao salvar a meta.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative max-w-2xl w-[95%] mx-auto mt-8 bg-white rounded-2xl shadow-xl max-h-[85vh] flex flex-col">
        <div className="px-5 py-4 border-b flex items-center gap-2">
          <CalendarIcon className="w-5 h-5" />
          <h3 className="text-lg font-semibold">Adicionar/Editar Meta Global</h3>
          <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-gray-100">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto">
          <div className="mb-3">
            <label className="text-sm font-medium">Produto (puxa os ingredientes)</label>
            <select
              className="mt-1 w-full border rounded-lg p-2"
              value={produtoId}
              onChange={(e) => setProdutoId(e.target.value)}
            >
              <option value="">Selecione...</option>
              {produtos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.ativo ? '⭐ ' : ''}{p.nome}
                </option>
              ))}
            </select>
            {produtoSel?.imagemUrl && (
              <div className="mt-2">
                <img src={produtoSel.imagemUrl} className="h-16 rounded border" />
              </div>
            )}
          </div>

          {produtoSel && (
            <div className="mb-4">
              <div className="text-sm text-gray-600 mb-1">
                Defina a quantia semanal de cada item (itens &gt; 0 entram na meta):
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {produtoSel.ingredientes.map((ing, idx) => {
                  const slug = slugifyKey(ing.nome || '');
                  const key = NAME_MAP[slug] || toCamelFromSlug(slug);
                  const asset = ingredientAssets[key];
                  return (
                    <label key={idx} className="text-sm">
                      <span className="block font-medium flex items-center gap-2">
                        <ImgMini src={asset?.imageUrl || ing.imagemUrl} alt={ing.nome || `Ingrediente ${idx + 1}`} />
                        {asset?.label || ing.nome || `Ingrediente ${idx + 1}`}
                      </span>
                      <input
                        type="number"
                        className="mt-2 w-full border rounded-lg p-2"
                        value={Number( (0) )}
                        onChange={() => {}}
                        placeholder=""
                        disabled
                      />
                      <input
                        type="number"
                        className="mt-2 w-full border rounded-lg p-2"
                        value={Number( (quantias[key] ?? 0) )}
                        onChange={(e) =>
                          setQuantias((prev) => ({ ...prev, [key]: Math.max(0, Math.floor(Number(e.target.value || 0))) }))
                        }
                        placeholder="0"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <div className="mb-4">
            <label className="text-sm font-medium flex items-center gap-2">
              <ImgMini alt="Dinheiro" size={24} /> Dinheiro (R$) — opcional
            </label>
            <input
              type="number"
              className="mt-1 w-full border rounded-lg p-2"
              value={dinheiro}
              onChange={(e) => setDinheiro(Math.max(0, Math.floor(Number(e.target.value || 0))))}
              placeholder="0"
            />
          </div>

          <div className="mb-4">
            <div className="text-sm font-medium mb-1">Aplicar a partir de</div>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="inline-flex items-center gap-2">
                <input type="radio" checked={effectiveMode === 'next'} onChange={() => setEffectiveMode('next')} />
                Próxima segunda (recomendado)
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" checked={effectiveMode === 'this'} onChange={() => setEffectiveMode('this')} />
                Esta semana
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="radio" checked={effectiveMode === 'date'} onChange={() => setEffectiveMode('date')} />
                Escolher data:
                <input
                  type="date"
                  className="border rounded-lg p-1 text-sm"
                  value={dateStr}
                  onChange={(e) => setDateStr(e.target.value)}
                  disabled={effectiveMode !== 'date'}
                />
              </label>
            </div>
            <div className="mt-2 text-xs text-gray-600">
              Semana efetiva: {(() => {
                const iso = computeEffectiveWeekISO();
                if (!iso) return '—';
                return weekLabel(iso);
              })()}
            </div>
          </div>

          <div className="mb-2">
            <div className="text-sm font-medium mb-1">Pré-visualização (itens &gt; 0):</div>
            <div className="flex flex-wrap gap-3">
              {Object.entries(quantias)
                .filter(([, v]) => Number(v) > 0)
                .map(([k, v]) => {
                  const asset = ingredientAssets[k];
                  return (
                    <span key={k} className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border bg-white">
                      <ImgMini src={asset?.imageUrl} alt={asset?.label || k} size={24} />
                      <span className="text-sm">{asset?.label || labelFromKey(k)}</span>
                      <span className="text-xs opacity-70">·</span>
                      <span className="text-sm font-medium">{v}</span>
                    </span>
                  );
                })}
              {Number(dinheiro) > 0 && (
                <span className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border bg-white">
                  <ImgMini alt="Dinheiro" size={24} />
                  <span className="text-sm">Dinheiro</span>
                  <span className="text-xs opacity-70">·</span>
                  <span className="text-sm font-medium">{dinheiro}</span>
                </span>
              )}
              {Object.values(quantias).every((v) => Number(v) === 0) && Number(dinheiro) === 0 && (
                <span className="text-sm text-gray-500">Nada selecionado ainda.</span>
              )}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded border hover:bg-gray-50">Cancelar</button>
          <button
            onClick={handleSave}
            className="px-3 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
            disabled={saving || !produtoSel}
          >
            {saving ? 'Salvando...' : 'Salvar meta'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* =========================
   Modal: Meta Livre
========================= */
const MetaLivreModal: React.FC<{
  open: boolean;
  onClose: () => void;
  users: LoggedUserLocal[];
  weeksISO: string[];
  livreIndex: Set<string>;
  onToggleLivre: (userUid: string, semanaISO: string) => Promise<void> | void;
}> = ({ open, onClose, users, weeksISO, livreIndex, onToggleLivre }) => {
  const [userUid, setUserUid] = useState('');
  const [week, setWeek] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUserUid('');
    setWeek(weeksISO[0] || '');
  }, [open, weeksISO]);

  async function handleConfirm() {
    if (!userUid || !week) return;
    try {
      setSaving(true);
      await onToggleLivre(userUid, week);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;
  const isFree = userUid && week ? livreIndex.has(`${userUid}|${week}`) : false;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative max-w-md w-[95%] mx-auto mt-20 bg-white rounded-2xl shadow-xl max-h-[85vh] flex flex-col">
        <div className="px-5 py-4 border-b flex items-center gap-2">
          <UserIcon className="w-5 h-5" />
          <h3 className="text-lg font-semibold">Meta Livre</h3>
          <button onClick={onClose} className="ml-auto p-1 rounded hover:bg-gray-100">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-3 overflow-y-auto">
          <label className="text-sm block">
            Usuário
            <select className="mt-1 w-full border rounded-lg p-2" value={userUid} onChange={(e) => setUserUid(e.target.value)}>
              <option value="">Selecione...</option>
              {users.map(u => <option key={u.uid} value={u.uid}>{u.nome} — {u.email}</option>)}
            </select>
          </label>
          <label className="text-sm block">
            Semana
            <select className="mt-1 w-full border rounded-lg p-2" value={week} onChange={(e) => setWeek(e.target.value)}>
              {weeksISO.map(w => <option key={w} value={w}>{weekLabel(w)}</option>)}
            </select>
          </label>
          {userUid && week && (
            <div className="text-xs text-gray-600">
              Estado atual: {isFree ? <b className="text-amber-700">Meta Livre</b> : <b className="text-gray-700">Obrigatória</b>}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded border hover:bg-gray-50">Cancelar</button>
          <button
            onClick={handleConfirm}
            className={`px-3 py-2 rounded text-white ${isFree ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
            disabled={!userUid || !week || saving}
          >
            {isFree ? 'Desmarcar Meta Livre' : 'Marcar Meta Livre'}
          </button>
        </div>
      </div>
    </div>
  );
};

/* =========================
   Página principal
========================= */
export default function MetaPage() {
  const [activePage, setActivePage] = useState('Meta');
  const [me, setMe] = useState<LoggedUserLocal | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [users, setUsers] = useState<LoggedUserLocal[]>([]);
  const [templates, setTemplates] = useState<MetaTemplate[]>([]);
  const [paidDocs, setPaidDocs] = useState<PaidDoc[]>([]);
  const [livres, setLivres] = useState<MetaLivreDoc[]>([]);

  const [ingredientAssets, setIngredientAssets] = useState<Record<string, { label: string; imageUrl?: string }>>({});

  // semanas (4 colunas) — sempre para TRÁS (mais recentes à esquerda)
  const [offset, setOffset] = useState(0);

  const [metaModalOpen, setMetaModalOpen] = useState(false);
  const [metaLivreOpen, setMetaLivreOpen] = useState(false);

  // Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fb) => {
      if (!fb) {
        setMe(null);
        setAuthReady(true);
        return;
      }
      const raw = localStorage.getItem('loggedUser');
      if (raw) {
        setMe(JSON.parse(raw));
        setAuthReady(true);
      } else {
        const uref = doc(db, 'users', fb.uid);
        const usnap = await getDoc(uref);
        if (usnap.exists()) {
          const d = usnap.data() as any;
          const parsed: LoggedUserLocal = {
            id: fb.uid,
            uid: fb.uid,
            nome: d.nome || fb.email || 'Usuário',
            email: fb.email || '',
            roleLevel: d.roleLevel || d.role || 6,
            createdAt: d.createdAt,
          };
          localStorage.setItem('loggedUser', JSON.stringify(parsed));
          setMe(parsed);
        } else {
          setMe({
            id: fb.uid,
            uid: fb.uid,
            nome: fb.email || 'Usuário',
            email: fb.email || '',
            roleLevel: 6,
          });
        }
        setAuthReady(true);
      }
    });
    return () => unsub();
  }, []);

  const role = me?.roleLevel || 6;
  const isManager = role === 1 || role === 2 || role === 4;
  const isUserOnly = role === 3 || role === 5 || role === 6;

  // users (para modal e board)
  useEffect(() => {
    if (!isManager) return;
    const qUsers = query(collection(db, 'users'), orderBy('nome', 'asc'));
    const unsub = onSnapshot(qUsers, (snap) => {
      const arr: LoggedUserLocal[] = [];
      snap.forEach((d) => {
        const x = d.data() as any;
        arr.push({
          id: d.id,
          uid: d.id,
          nome: x.nome || x.email || 'Usuário',
          email: x.email || '',
          roleLevel: x.roleLevel || x.role || 6,
          createdAt: x.createdAt || null,
        });
      });
      setUsers(arr);
    });
    return () => unsub();
  }, [isManager]);

  // templates
  useEffect(() => {
    const qTpl = query(collection(db, 'metas_templates'), orderBy('effectiveFromMondayISO', 'asc'));
    const unsub = onSnapshot(qTpl, (snap) => {
      const arr: MetaTemplate[] = [];
      snap.forEach((d) => {
        const x = d.data() as any;
        arr.push({
          id: d.id,
          effectiveFromMondayISO: x.effectiveFromMondayISO,
          targets: x.targets || {},
          createdAt: x.createdAt,
          createdByUid: x.createdByUid,
          createdByNome: x.createdByNome,
          note: x.note,
        });
      });
      setTemplates(arr);
    });
    return () => unsub();
  }, []);

  // mapear imagens dos ingredientes
  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, 'produtosFarm'));
      const map: Record<string, { label: string; imageUrl?: string }> = {};
      snap.forEach((d) => {
        const p = d.data() as any;
        const ingredientes: any[] = Array.isArray(p.ingredientes) ? p.ingredientes : [];
        ingredientes.forEach((ing) => {
          const slug = slugifyKey(ing?.nome || '');
          const key = NAME_MAP[slug] || toCamelFromSlug(slug);
          if (!map[key]) {
            map[key] = { label: labelFromKey(key), imageUrl: ing?.imagemUrl };
          }
        });
      });
      if (!map['dinheiro']) map['dinheiro'] = { label: 'Dinheiro' };
      setIngredientAssets(map);
    })();
  }, []);

  // semanas visíveis (4) — indo para trás
  const weeksISO = useMemo(() => {
    const curMon = startOfWeekMonday(new Date());
    // lado esquerdo: semana atual - offset
    const start = addWeeks(curMon, -Math.abs(offset));
    // retornamos [start-3, start-2, start-1, start] (ou seja, do mais antigo para o mais recente)
    const arr = [3, 2, 1, 0].map((i) => isoWeekKeyFromMonday(addWeeks(start, -i)));
    return arr;
  }, [offset]);

  // pagos 4 semanas
  useEffect(() => {
    if (weeksISO.length === 0) return;
    const qPaid = query(collection(db, 'metas_semanais_paid'), where('semanaISO', 'in', weeksISO));
    const unsub = onSnapshot(qPaid, (snap) => {
      const arr: PaidDoc[] = [];
      snap.forEach((d) => {
        const x = d.data() as any;
        arr.push({ id: d.id, userUid: x.userUid, semanaISO: x.semanaISO, totals: x.totals || {} });
      });
      setPaidDocs(arr);
    });
    return () => unsub();
  }, [weeksISO]);

  // metaLivre 4 semanas
  useEffect(() => {
    if (weeksISO.length === 0) return;
    const qFree = query(
      collection(db, 'metas_semanais_targets'),
      where('semanaISO', 'in', weeksISO),
      where('metaLivre', '==', true)
    );
    const unsub = onSnapshot(qFree, (snap) => {
      const arr: MetaLivreDoc[] = [];
      snap.forEach((d) => {
        const x = d.data() as any;
        arr.push({ id: d.id, userUid: x.userUid, semanaISO: x.semanaISO, metaLivre: !!x.metaLivre });
      });
      setLivres(arr);
    });
    return () => unsub();
  }, [weeksISO]);

  function getTemplateForWeek(weekISO: string): MetaTemplate | null {
    if (templates.length === 0) return null;
    const list = templates.filter((t) => t.effectiveFromMondayISO <= weekISO);
    if (list.length === 0) return null;
    return list[list.length - 1];
  }

  const paidIndex = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const p of paidDocs) {
      const k = `${p.userUid}|${p.semanaISO}`;
      const cur = map.get(k) || {};
      for (const [key, val] of Object.entries(p.totals || {})) {
        cur[key] = (cur[key] || 0) + Number(val || 0);
      }
      map.set(k, cur);
    }
    return map;
  }, [paidDocs]);

  const livreIndex = useMemo(() => {
    const set = new Set<string>();
    for (const l of livres) set.add(`${l.userUid}|${l.semanaISO}`);
    return set;
  }, [livres]);

  async function toggleMetaLivre(userUid: string, semanaISO: string) {
    const key = `${userUid}|${semanaISO}`;
    const wasFree = livreIndex.has(key);
    try {
      const docId = `${userUid}_${semanaISO}`;
      const ref = doc(db, 'metas_semanais_targets', docId);
      if (wasFree) {
        await setDoc(ref, { userUid, semanaISO, metaLivre: false, updatedAt: serverTimestamp() }, { merge: true });
      } else {
        await setDoc(ref, { userUid, semanaISO, metaLivre: true, updatedAt: serverTimestamp() }, { merge: true });
      }
    } catch (e) {
      console.error(e);
      alert('Falha ao alternar Meta Livre.');
    }
  }

  // *** CORREÇÃO: Meta Livre tem prioridade ***
  function computeStatus(
    userUid: string,
    semanaISO: string
  ): { code: 'V'|'O'|'!'|'X'|'none', color: string, title: string } {
    const key = `${userUid}|${semanaISO}`;
    const isFree = livreIndex.has(key);

    if (isFree) {
      return { code: 'O', color: 'text-amber-600', title: 'Meta Livre' };
    }

    const tpl = getTemplateForWeek(semanaISO);
    if (!tpl || Object.keys(tpl.targets || {}).length === 0) {
      return { code: 'none', color: 'text-gray-400', title: 'Sem meta vigente' };
    }

    const paid = paidIndex.get(key) || {};
    const allCovered = Object.entries(tpl.targets)
      .every(([k, v]) => Number(paid[k] || 0) >= Number(v || 0));
    if (allCovered) {
      return { code: 'V', color: 'text-emerald-600', title: 'Pago suficiente' };
    }

    if (isPastWeek(semanaISO)) {
      const nowISO = isoWeekKeyFromMonday(startOfWeekMonday(new Date()));
      const weeksBehind = Math.max(0, weekDistance(semanaISO, nowISO));
      if (weeksBehind >= 2) return { code: 'X', color: 'text-red-600', title: '2+ semanas em atraso' };
      return { code: '!', color: 'text-orange-600', title: '1 semana em atraso' };
    }

    return { code: 'none', color: 'text-gray-400', title: 'Semana corrente/futura' };
  }

  if (!authReady) {
    return (
      <div className="flex min-h-screen">
        <Sidebar activePage={activePage} setActivePage={setActivePage} />
        <main className="flex-1 grid place-items-center p-6">Carregando…</main>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="flex min-h-screen">
        <Sidebar activePage={activePage} setActivePage={setActivePage} />
        <main className="flex-1 grid place-items-center p-6">
          <div className="text-center text-sm text-gray-600">Faça login para ver suas metas.</div>
        </main>
      </div>
    );
  }

  const weekISO_Current = isoWeekKeyFromMonday(startOfWeekMonday(new Date()));
  const tplCurrent = getTemplateForWeek(weekISO_Current);

  return (
    <div className="flex min-h-screen bg-[#f5f7fb]">
      <Sidebar activePage={activePage} setActivePage={setActivePage} />

      <main className="flex-1 p-4 md:p-6 space-y-6 max-w-6xl mx-auto w-full">
        {/* Header + metas semana (com IMAGENS) */}
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0 w-full">
            <h1 className="text-2xl md:text-3xl font-semibold">Metas</h1>

            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {tplCurrent && Object.keys(tplCurrent.targets || {}).length > 0 ? (
                Object.entries(tplCurrent.targets).map(([k, v]) => {
                  const asset = ingredientAssets[k];
                  return (
                    <div key={k} className="bg-white rounded-2xl border border-gray-200 p-3 flex items-center gap-3 shadow-sm">
                      <ImgMini src={asset?.imageUrl} alt={asset?.label || labelFromKey(k)} />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{asset?.label || labelFromKey(k)}</div>
                        <div className="text-xs text-gray-500 truncate">Meta: {v}</div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <span className="text-sm text-gray-500">Sem meta vigente para esta semana.</span>
              )}
            </div>
          </div>

          {isManager && (
            <div className="flex flex-col gap-2 shrink-0">
              <button
                onClick={() => setMetaLivreOpen(true)}
                className="rounded-xl px-3 py-2 border border-amber-300 bg-white hover:bg-amber-50 text-sm inline-flex items-center gap-2 text-amber-700"
              >
                <CheckCircleIcon className="w-4 h-4" />
                Meta Livre
              </button>
              <button
                onClick={() => setMetaModalOpen(true)}
                className="rounded-xl px-3 py-2 border border-gray-300 bg-white hover:bg-gray-50 text-sm inline-flex items-center gap-2"
              >
                <PlusIcon className="w-4 h-4" />
                Adicionar/Editar Meta
              </button>
            </div>
          )}
        </header>

        {/* ====== Visão Usuário ====== */}
        {isUserOnly && (
          <UserSelfView
            me={me}
            getTemplateForWeek={getTemplateForWeek}
            paidIndex={paidIndex}
            ingredientAssets={ingredientAssets}
          />
        )}

        {/* ====== Visão Gestão ====== */}
        {isManager && (
          <ManagerBoard
            users={users}
            weeksISO={weeksISO}
            offset={offset}
            setOffset={setOffset}
            getTemplateForWeek={getTemplateForWeek}
            computeStatus={computeStatus}
            paidIndex={paidIndex}
            livreIndex={livreIndex}
            ingredientAssets={ingredientAssets}
            onToggleLivre={toggleMetaLivre} // <- NOVO: ação rápida
          />
        )}
      </main>

      {/* Modal Meta Global */}
      {isManager && me && (
        <MetaModal
          open={metaModalOpen}
          onClose={() => setMetaModalOpen(false)}
          currentUser={me}
          ingredientAssets={ingredientAssets}
        />
      )}

      {/* Modal Meta Livre */}
      {isManager && (
        <MetaLivreModal
          open={metaLivreOpen}
          onClose={() => setMetaLivreOpen(false)}
          users={users}
          weeksISO={weeksISO}
          livreIndex={livreIndex}
          onToggleLivre={toggleMetaLivre}
        />
      )}
    </div>
  );
}

/* =========================
   Componentes auxiliares
========================= */

const UserSelfView: React.FC<{
  me: LoggedUserLocal;
  getTemplateForWeek: (weekISO: string) => MetaTemplate | null;
  paidIndex: Map<string, Record<string, number>>;
  ingredientAssets: Record<string, { label: string; imageUrl?: string }>;
}> = ({ me, getTemplateForWeek, paidIndex, ingredientAssets }) => {
  const monday = startOfWeekMonday(new Date());
  const weekISO = isoWeekKeyFromMonday(monday);

  const tpl = getTemplateForWeek(weekISO);
  const paid = paidIndex.get(`${me.uid}|${weekISO}`) || {};

  const rows = useMemo(() => {
    const arr: { key: string; required: number; paid: number; missing: number }[] = [];
    if (tpl?.targets) {
      for (const [k, req] of Object.entries(tpl.targets)) {
        const got = Number(paid[k] || 0);
        arr.push({ key: k, required: Number(req || 0), paid: got, missing: Math.max(0, Number(req || 0) - got) });
      }
    }
    return arr;
  }, [tpl, paid]);

  const totalMissing = rows.reduce((a, r) => a + r.missing, 0);
  const atrasado = isPastWeek(weekISO) && totalMissing > 0;

  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Minha semana ({weekLabel(weekISO)})</h2>
        {atrasado ? (
          <Tag className="border-red-300 text-red-700">Seu farm está atrasado</Tag>
        ) : (
          <Tag className="border-emerald-300 text-emerald-700">Em dia</Tag>
        )}
      </div>

      {(!tpl || Object.keys(tpl.targets || {}).length === 0) ? (
        <div className="mt-3 text-gray-500 text-sm">Sem meta vigente para esta semana.</div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-gray-600">
                <th className="p-2">Item</th>
                <th className="p-2">Meta</th>
                <th className="p-2">Pago</th>
                <th className="p-2">Falta</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const asset = ingredientAssets[r.key];
                return (
                  <tr key={r.key} className="border-t">
                    <td className="p-2">
                      <div className="flex items-center gap-2">
                        <ImgMini src={asset?.imageUrl} alt={asset?.label || labelFromKey(r.key)} size={28} />
                        <span>{asset?.label || labelFromKey(r.key)}</span>
                      </div>
                    </td>
                    <td className="p-2">{r.required}</td>
                    <td className="p-2">{r.paid}</td>
                    <td className={`p-2 ${r.missing > 0 ? 'text-red-600 font-medium' : ''}`}>{r.missing}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-3 text-sm text-gray-600">
            Total faltando: <span className={`font-semibold ${totalMissing > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{totalMissing}</span>
          </div>
        </div>
      )}
    </section>
  );
};

const ManagerBoard: React.FC<{
  users: LoggedUserLocal[];
  weeksISO: string[];
  offset: number;
  setOffset: (n: number) => void;
  getTemplateForWeek: (weekISO: string) => MetaTemplate | null;
  computeStatus: (userUid: string, semanaISO: string) => { code: 'V'|'O'|'!'|'X'|'none', color: string, title: string };
  paidIndex: Map<string, Record<string, number>>;
  livreIndex: Set<string>;
  ingredientAssets: Record<string, { label: string; imageUrl?: string }>;
  onToggleLivre: (userUid: string, semanaISO: string) => Promise<void> | void; // <- NOVO
}> = ({
  users,
  weeksISO,
  offset,
  setOffset,
  getTemplateForWeek,
  computeStatus,
  paidIndex,
  livreIndex,
  ingredientAssets,
  onToggleLivre,
}) => {
  // controle de expansões por célula (user|week)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  function toggleCell(uid: string, w: string) {
    const key = `${uid}|${w}`;
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Metas por usuário</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOffset(offset + 4)} // semanas ANTERIORES (indo para trás)
            className="rounded-lg px-2 py-1 border hover:bg-gray-50 inline-flex items-center gap-1 text-sm"
            title="Semanas anteriores"
          >
            <ChevronLeftIcon className="w-4 h-4" /> 4 sem.
          </button>
          <div className="text-sm text-gray-600">
            {weekLabel(weeksISO[0])} → {weekLabel(weeksISO[weeksISO.length - 1])}
          </div>
          <button
            onClick={() => setOffset(Math.max(0, offset - 4))} // voltar em direção à atual
            className="rounded-lg px-2 py-1 border hover:bg-gray-50 inline-flex items-center gap-1 text-sm"
            title="Semanas seguintes (mais recentes)"
          >
            4 sem. <ChevronRightIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[13px] border-separate" style={{ borderSpacing: 0 }}>
          <thead className="sticky top-0 bg-white z-10">
            <tr className="text-left text-gray-600">
              <th className="px-2 py-2 w-56 bg-white sticky left-0 z-10 border-b">Usuário</th>
              {weeksISO.map((w) => (
                <th key={w} className="px-2 py-2 whitespace-nowrap text-center border-b">{weekLabel(w)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td className="p-3 text-gray-500" colSpan={1 + weeksISO.length}>
                  Sem usuários.
                </td>
              </tr>
            )}
            {users.map((u, rowIdx) => (
              <React.Fragment key={u.uid}>
                <tr className={rowIdx % 2 ? 'bg-gray-50/40' : ''}>
                  <td className="px-2 py-2 bg-white sticky left-0 z-10 border-r">
                    <div className="font-medium truncate">{u.nome}</div>
                    <div className="text-xs text-gray-500 truncate">{u.email}</div>
                  </td>
                  {weeksISO.map((w) => {
                    const status = computeStatus(u.uid, w);
                    const isFree = livreIndex.has(`${u.uid}|${w}`);
                    const tpl = getTemplateForWeek(w);
                    const paid = paidIndex.get(`${u.uid}|${w}`) || {};
                    const need = tpl?.targets || {};
                    const miss = Object.entries(need).reduce((acc, [k, v]) => acc + Math.max(0, Number(v || 0) - Number(paid[k] || 0)), 0);
                    const key = `${u.uid}|${w}`;
                    const isOpen = !!expanded[key];

                    return (
                      <td key={w} className="px-2 py-1 text-center align-top">
                        <button
                          onClick={() => toggleCell(u.uid, w)}
                          title={status.title + (isFree ? ' · Meta Livre' : '')}
                          className={`inline-flex items-center justify-center w-8 h-8 rounded-md border text-sm transition
                            ${status.code === 'V'
                              ? 'border-emerald-300 text-emerald-700 bg-emerald-50'
                              : status.code === 'O'
                              ? 'border-amber-300 text-amber-700 bg-amber-50'
                              : status.code === '!'
                              ? 'border-orange-300 text-orange-700 bg-orange-50'
                              : status.code === 'X'
                              ? 'border-red-300 text-red-700 bg-red-50'
                              : 'border-gray-300 text-gray-400 bg-gray-50 hover:bg-gray-100'}`}
                        >
                          {status.code === 'none' ? '—' : status.code}
                        </button>
                        {status.code !== 'O' && tpl && (
                          <div className="mt-1 text-[11px] text-gray-500">falta: {miss}</div>
                        )}

                        {/* Painel expandido */}
                        {isOpen && (
                          <div className="mt-2 text-left text-[12px] bg-white border rounded-lg p-2 shadow-sm">
                            <div className="flex items-center justify-between mb-1">
                              <div className="font-medium">Detalhes — {weekLabel(w)}</div>
                              {/* Ação rápida: toggle Meta Livre */}
                              <button
                                onClick={() => onToggleLivre(u.uid, w)}
                                className={`px-2 py-1 rounded border text-xs ${
                                  isFree
                                    ? 'border-amber-300 text-amber-700 hover:bg-amber-50'
                                    : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                                }`}
                                title={isFree ? 'Remover Meta Livre desta semana' : 'Marcar Meta Livre nesta semana'}
                              >
                                {isFree ? 'Remover Meta Livre' : 'Meta Livre'}
                              </button>
                            </div>

                            {tpl && Object.keys(need).length > 0 ? (
                              <ul className="space-y-1">
                                {Object.entries(need).map(([k, req]) => {
                                  const got = Number(paid[k] || 0);
                                  const falta = Math.max(0, Number(req || 0) - got);
                                  const asset = ingredientAssets[k];
                                  return (
                                    <li key={k} className="flex items-center justify-between">
                                      <span className="flex items-center gap-2">
                                        <ImgMini src={asset?.imageUrl} alt={asset?.label || labelFromKey(k)} size={20} />
                                        <span className="text-gray-700">{asset?.label || labelFromKey(k)}</span>
                                      </span>
                                      <span className="tabular-nums">
                                        <span className="text-gray-600">meta:</span> {req}{' '}
                                        <span className="text-gray-600">· pago:</span> {got}{' '}
                                        <span className={`font-medium ${falta > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                          falta: {falta}
                                        </span>
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : (
                              <div className="text-gray-500">Sem meta vigente.</div>
                            )}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-xs text-gray-600 flex flex-wrap gap-3">
        <span><span className="inline-block w-3 h-3 align-middle rounded border border-emerald-300 bg-emerald-50 mr-1" />V = pago suficiente</span>
        <span><span className="inline-block w-3 h-3 align-middle rounded border border-amber-300 bg-amber-50 mr-1" />O = meta livre</span>
        <span><span className="inline-block w-3 h-3 align-middle rounded border border-orange-300 bg-orange-50 mr-1" />! = 1 semana atraso</span>
        <span><span className="inline-block w-3 h-3 align-middle rounded border border-red-300 bg-red-50 mr-1" />X = 2+ semanas atraso</span>
        <span><span className="inline-block w-3 h-3 align-middle rounded border border-gray-300 bg-gray-50 mr-1" />— = sem meta/dados</span>
      </div>
    </section>
  );
};
