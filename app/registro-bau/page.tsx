'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from '@/components/ui/sidebar';
import { db, auth } from '@/lib/firebase';

import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  serverTimestamp,
  limit as fsLimit,
  where,
  getDocs,
  runTransaction,
} from 'firebase/firestore';
import {
  CheckCircleIcon,
  XCircleIcon,
  Cog6ToothIcon,
  BanknotesIcon,
} from '@heroicons/react/24/solid';

/** ===== Tipos ===== */
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
  id: string; nome: string; imagemUrl?: string; ativo: boolean;
  quantidade?: number; peso?: number; valor?: number; ingredientes?: IngredienteItem[];
};

type StatusDeposito = 'meta_paga'|'fabricado'|'confirmado'|'recusado'|'pendente';

type RegistroBau = {
  id?: string;

  // identificação e usuário
  depositoId?: string | null;     // ex.: "01-03"
  depositoSeq?: number | null;    // ex.: 3
  pastaNumero?: string | null;
  criadoPorUid: string | null;
  criadoPorNome: string | null;

  // produto
  produtoId: string | null;
  produtoNome: string | null;
  produtoImagemUrl: string | null;

  // valores
  quantidade: number;
  efedrina: number;
  poAluminio: number;
  embalagemPlastica: number;
  folhasPapel: number;
  valorDinheiro: number;

  observacao?: string;

  // comprovante
  imagemUrl?: string | null;
  imagemExpiresAt?: string | null; // ISO

  // status legado / único
  confirmado?: boolean;
  status?: StatusDeposito;

  // novas flags multi-status (ADM)
  flagMetaPaga?: boolean;
  flagFabricado?: boolean;
  flagConfirmado?: boolean;
  flagRecusado?: boolean;

  // auditoria
  criadoEm?: any;
  lastStatusByUid?: string | null;
  lastStatusByNome?: string | null;
  lastStatusAt?: any;
};

function ChipsStatusRead({ r }: { r: Partial<RegistroBau> }) {
  const chips: Array<{ label: string; cls: string; Icon: any }> = [];
  if (r.flagMetaPaga)  chips.push({ label: 'Meta Paga',  cls: 'bg-indigo-100 text-indigo-700', Icon: BanknotesIcon });
  if (r.flagFabricado) chips.push({ label: 'Fabricado',  cls: 'bg-sky-100 text-sky-700',       Icon: Cog6ToothIcon });
  if (r.flagConfirmado || r.confirmado) chips.push({ label: 'Confirmado', cls: 'bg-green-100 text-green-700', Icon: CheckCircleIcon });
  if (r.flagRecusado)  chips.push({ label: 'Recusado',   cls: 'bg-red-100 text-red-700',       Icon: XCircleIcon });

  if (chips.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-700">
        <Cog6ToothIcon className="w-4 h-4" /> Pendente
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((c, i) => (
        <span key={i} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${c.cls}`}>
          <c.Icon className="w-4 h-4" /> {c.label}
        </span>
      ))}
    </div>
  );
}

function computeStatusLabel(r: Partial<RegistroBau>): 'Confirmado'|'Recusado'|'Fabricado'|'Meta Paga'|'Pendente' {
  if (r.flagConfirmado || r.confirmado) return 'Confirmado';
  if (r.flagRecusado) return 'Recusado';
  if (r.flagFabricado) return 'Fabricado';
  if (r.flagMetaPaga) return 'Meta Paga';
  return 'Pendente';
}

/** ===== Página ===== */
export default function RegistroBauPage() {
  const [activePage, setActivePage] = useState('Registro do Baú');

  // Auth/role
  const [user, setUser] = useState<User | null>(null);
  const [hierarquia, setHierarquia] = useState<Hierarquia>('3');

  // Produtos
  const [produtos, setProdutos] = useState<ProdutoFarm[]>([]);
  const [produtoSel, setProdutoSel] = useState<string>('');
  const produtoAtual = useMemo(() => produtos.find(p => p.id === produtoSel), [produtos, produtoSel]);

  // Form
  const [quantidade, setQuantidade] = useState<number>(0);
  const [efedrina, setEfedrina] = useState<number>(0);
  const [poAluminio, setPoAluminio] = useState<number>(0);
  const [embalagemPlastica, setEmbalagemPlastica] = useState<number>(0);
  const [folhasPapel, setFolhasPapel] = useState<number>(0);
  const [valorDinheiro, setValorDinheiro] = useState<number>(0);
  const [observacao, setObservacao] = useState<string>('');
  const [arquivo, setArquivo] = useState<File | null>(null);

  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);

  // Lista / histórico
  const [registros, setRegistros] = useState<RegistroBau[]>([]);
  const [ordem, setOrdem] = useState<'desc'|'asc'>('desc');
  const [limite, setLimite] = useState<number>(20);
  const [filtroProduto, setFiltroProduto] = useState<string>('');
  const [apenasNaoConfirmados, setApenasNaoConfirmados] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Upload UX
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);

  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Bahia',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }),
    []
  );

  // Auth + role
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u: User | null) => {
      setUser(u);
      if (!u) return;
      try {
        const snap = await getDoc(doc(db, 'users', u.uid));
        const data = snap.exists() ? (snap.data() as any) : {};
        const raw = data.roleLevel ?? data.hierarquia ?? data.role ?? '3';
        setHierarquia(normalizeRole(raw));
      } catch { setHierarquia('3'); }
    });
    return () => unsub();
  }, []);

  // Produtos
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'produtosFarm'), orderBy('nome', 'asc')),
      (snap) => {
        const arr: ProdutoFarm[] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as any;
        const ativo = arr.find(p => p.ativo);
        setProdutos(arr);
        setProdutoSel(prev => prev || ativo?.id || arr[0]?.id || '');
      }
    );
    return () => unsub();
  }, []);

  // Registros (tempo real)
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'bau_registros'), orderBy('criadoEm', ordem), fsLimit(limite)),
      (snap) => {
        const rows: RegistroBau[] = [];
        snap.forEach(d => rows.push({ ...(d.data() as any), id: d.id }));
        setRegistros(rows);
      }
    );
    return () => unsub();
  }, [ordem, limite]);

  const registrosFiltrados = useMemo(() => {
    let arr = registros;
    if (hierarquia === '6' && user?.uid) arr = arr.filter(r => r.criadoPorUid === user.uid);
    if (filtroProduto) arr = arr.filter(r => r.produtoId === filtroProduto);
    if (apenasNaoConfirmados) arr = arr.filter(r => !(r.flagConfirmado || r.confirmado));
    return arr;
  }, [registros, hierarquia, user?.uid, filtroProduto, apenasNaoConfirmados]);

  // Dropzone: paste / drag-n-drop
  useEffect(() => {
    const el = dropRef.current; if (!el) return;

    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return;
      for (const item of e.clipboardData.items) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) setArquivo(f);
        }
      }
    };
    const onDragOver = (e: DragEvent) => { e.preventDefault(); el.classList.add('ring','ring-indigo-400'); };
    const onDragLeave = () => { el.classList.remove('ring','ring-indigo-400'); };
    const onDrop = (e: DragEvent) => {
      e.preventDefault(); el.classList.remove('ring','ring-indigo-400');
      if (e.dataTransfer?.files?.[0]) setArquivo(e.dataTransfer.files[0]);
    };

    el.addEventListener('paste', onPaste as any);
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('paste', onPaste as any);
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('dragleave', onDragLeave);
      el.removeEventListener('drop', onDrop);
    };
  }, []);

  // Helpers de ingredientes -> imagens
  function norm(s?: string) {
    return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }
  function getIngImg(nomeBusca: string): string | undefined {
    const list = (produtoAtual?.ingredientes ?? []) as IngredienteItem[];
    const alvo = norm(nomeBusca);
    const by = (pred: (i: IngredienteItem) => boolean) => list.find(pred);

    const hit =
      by(i => norm(i.nome) === alvo)
      ?? (alvo.includes('efedrina') ? by(i => norm(i.nome).includes('efedrin')) : undefined)
      ?? ((alvo.includes('aluminio') || alvo.includes('alumínio')) ? by(i => norm(i.nome).includes('alumin')) : undefined)
      ?? (alvo.includes('embalagem') ? by(i => norm(i.nome).includes('embalag')) : undefined)
      ?? (alvo.includes('papel') ? by(i => norm(i.nome).includes('papel')) : undefined);

    return hit?.imagemUrl || (alvo === 'meta' ? produtoAtual?.imagemUrl : undefined);
  }

  // Upload para Vercel Blob (pasta do usuário) com TTL
  async function uploadProvaParaVercel(uid: string, docId: string, file: File) {
    const form = new FormData();
    form.append('file', file);
    form.append('uid', uid);
    form.append('docId', docId);
    const res = await fetch('/api/upload-proof', { method: 'POST', body: form });
    if (!res.ok) throw new Error('Falha no upload do comprovante.');
    return res.json() as Promise<{ url: string; key: string; expiresAt: string }>;
  }

  // Resolve pastaNumero
  async function resolvePastaNumero(uid: string): Promise<string> {
    const usnap = await getDoc(doc(db, 'users', uid));
    const u = usnap.exists() ? (usnap.data() as any) : {};
    const pastaField = u.pasta;
    const num =
      u.numeroPastaCadastro ?? u.numeroPasta ?? u.numPasta ?? u.pastaNumero ??
      (typeof pastaField === 'string' && /^\d+/.test(pastaField) ? pastaField : null);
    const pn = String(num || '00').replace(/\D/g, '') || '00';
    return pn.padStart(2, '0');
  }

  // Alocar ID sequencial via transação
  async function allocDepositoId(pastaNumero: string): Promise<{ depositoId: string; depositoSeq: number }> {
    const pastaRef = doc(db, 'pastas', pastaNumero);
    const seq = await runTransaction(db, async (tx) => {
      const snap = await tx.get(pastaRef);
      const prev = (snap.exists() ? (snap.data() as any).seqBau : 0) || 0;
      const next = Number(prev) + 1;
      tx.set(pastaRef, { seqBau: next }, { merge: true });
      return next;
    });
    const depositoId = `${pastaNumero}-${String(seq).padStart(2, '0')}`;
    return { depositoId, depositoSeq: seq };
  }

  // Relay server-side (notificação)
  async function notify(uid: string, registro: any) {
    try {
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, registro }),
      });
      const json = await res.json().catch(() => ({}));
      console.log('/api/notify →', res.status, json);
    } catch (e) {
      console.warn('notify fail', e);
    }
  }

  // ===== Validação de “pelo menos um campo > 0” =====
  function aoMenosUmPreenchido() {
    return [
      quantidade,
      efedrina,
      poAluminio,
      embalagemPlastica,
      folhasPapel,
      valorDinheiro
    ].some(n => Number(n) > 0);
  }

  // Salvar
  async function handleSalvar(e: React.FormEvent) {
    e.preventDefault();
    setErroForm(null);

    if (!produtoSel) return setErroForm('Selecione um produto.');
    if (!aoMenosUmPreenchido()) return setErroForm('Preencha pelo menos um dos campos (quantidade/insumos/valor).');

    try {
      setSalvando(true);

      // 0) resolve pastaNumero e aloca ID
      const pn = user?.uid ? await resolvePastaNumero(user.uid) : '00';
      const { depositoId, depositoSeq } = await allocDepositoId(pn);

      // 0.1) resolve NOME preferido no doc do usuário (evita mostrar e-mail)
      let nomePreferido: string | null = null;
      if (user?.uid) {
        const us = await getDoc(doc(db, 'users', user.uid));
        const ud = us.exists() ? (us.data() as any) : {};
        nomePreferido =
          ud.name ??
          ud.nome ??
          ud.displayName ??
          user.displayName ??
          null;
      }

      // 1) cria o doc
      const payloadBase: Omit<RegistroBau, 'id'> = {
        depositoId,
        depositoSeq,
        pastaNumero: pn,

        criadoPorUid: user?.uid ?? null,
        criadoPorNome: nomePreferido || user?.email || null,

        produtoId: produtoSel,
        produtoNome: produtoAtual?.nome ?? null,
        produtoImagemUrl: produtoAtual?.imagemUrl ?? null,

        quantidade,
        efedrina,
        poAluminio,
        embalagemPlastica,
        folhasPapel,
        valorDinheiro,

        observacao: (observacao || '').trim(),

        imagemUrl: null,
        imagemExpiresAt: null,

        status: 'pendente',
        confirmado: false,

        flagMetaPaga: false,
        flagFabricado: false,
        flagConfirmado: false,
        flagRecusado: false,

        criadoEm: serverTimestamp(),
      };
      const refDoc = await addDoc(collection(db, 'bau_registros'), payloadBase);

      // 2) upload do comprovante
      let uploadedUrl: string | null = null;
      let expiresAtISO: string | null = null;
      if (arquivo && user?.uid) {
        const up = await uploadProvaParaVercel(user.uid, refDoc.id, arquivo);
        uploadedUrl = up.url;
        expiresAtISO = up.expiresAt;
        await updateDoc(doc(db, 'bau_registros', refDoc.id), {
          imagemUrl: uploadedUrl,
          imagemExpiresAt: expiresAtISO,
        });
      }

      // 3) webhook
      await notify(user?.uid || '', {
        id: refDoc.id,
        depositoId,
        depositoSeq,
        pastaNumero: pn,

        criadoPorNome: nomePreferido || user?.email || null,

        produtoId: produtoSel,
        produtoNome: produtoAtual?.nome ?? null,

        quantidade,
        efedrina,
        poAluminio,
        embalagemPlastica,
        folhasPapel,
        valorDinheiro,
        observacao: (observacao || '').trim(),

        imagemUrl: uploadedUrl,
        imagemExpiresAt: expiresAtISO,
        status: 'pendente',
      });

      // 4) limpar form
      setQuantidade(0);
      setEfedrina(0);
      setPoAluminio(0);
      setEmbalagemPlastica(0);
      setFolhasPapel(0);
      setValorDinheiro(0);
      setObservacao('');
      setArquivo(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      setErroForm(err?.message || 'Falha ao salvar depósito.');
    } finally {
      setSalvando(false);
    }
  }

  function fmtData(ts: any) {
    try {
      if (ts?.toDate) return timeFormatter.format(ts.toDate());
      const d = new Date(ts);
      if (!isNaN(d.getTime())) return timeFormatter.format(d);
    } catch {}
    return '—';
  }

  // Permissões
  const podeVerAdm = (['1','2','3','4','5'] as Hierarquia[]).includes(hierarquia);
  const podeLimpar = (['1','2'] as Hierarquia[]).includes(hierarquia);

  // imagens por insumo (para labels)
  function getIngImgSafe(nome: string) { try { return getIngImg(nome); } catch { return undefined; } }
  const imgMeta = produtoAtual?.imagemUrl;
  const imgEfedrina = getIngImgSafe('efedrina');
  const imgPoAl = getIngImgSafe('pó de alumínio');
  const imgEmb = getIngImgSafe('embalagem plástica');
  const imgPapel = getIngImgSafe('folhas de papel');

  // Helpers limpeza (se usar o botão aqui ainda)
  const extractBlobKey = (url: string) => {
    try {
      const u = new URL(url);
      return u.pathname.replace(/^\/+/, '');
    } catch { return ''; }
  };
  async function limparComprovantesAntigos() {
    try {
      const nowISO = new Date().toISOString();
      const qy = query(
        collection(db, 'bau_registros'),
        where('imagemExpiresAt', '<=', nowISO),
        orderBy('imagemExpiresAt', 'asc'),
        fsLimit(400)
      );
      const snap = await getDocs(qy);
      const keys: string[] = [];
      const ids: string[] = [];
      snap.forEach(d => {
        const data = d.data() as any;
        if (data.imagemUrl) {
          const k = extractBlobKey(data.imagemUrl);
          if (k) keys.push(k);
        }
        ids.push(d.id);
      });
      if (keys.length) {
        await fetch('/api/blob-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keys }),
        });
      }
      for (const id of ids) {
        await updateDoc(doc(db, 'bau_registros', id), { imagemUrl: null, imagemExpiresAt: null });
      }
      alert('Comprovantes expirados apagados.');
    } catch (e) {
      alert('Falha ao limpar comprovantes.');
    }
  }

  // UI helpers
  const toggleExpand = (id?: string) => {
    if (!id) return;
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="flex min-h-screen bg-[#f5f7fb]">
      <Sidebar activePage={activePage} setActivePage={setActivePage} />

      <main className="flex-1 p-4 md:p-6 max-w-6xl mx-auto w-full">
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Registro do Baú</h1>
            <p className="text-sm text-gray-600">
              Selecione o <span className="font-medium">Produto</span> e informe os campos necessários.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {podeVerAdm && (
              <a
                href="/registro-bau/pageadm"
                className="rounded-xl bg-black text-white px-3 py-2 text-sm hover:opacity-90"
              >
                Conferir Depósitos (ADM)
              </a>
            )}

            {podeLimpar && (
              <button
                onClick={limparComprovantesAntigos}
                className="rounded-xl bg-red-600 text-white px-3 py-2 text-sm hover:bg-red-700 disabled:opacity-60"
                title="Apaga os comprovantes (blobs) com mais de 7 dias e zera nos registros"
              >
                Apagar comprovantes &gt; 7 dias
              </button>
            )}
          </div>
        </header>

        {/* Produto selecionado */}
        <section className="bg-white border border-gray-200 rounded-2xl p-4 md:p-6 shadow-sm mb-6">
          <div className="flex items-center gap-4">
            {produtoAtual?.imagemUrl ? (
              <img src={produtoAtual.imagemUrl} alt={produtoAtual?.nome || 'Produto'} className="w-20 h-20 object-cover rounded-xl border border-gray-200" />
            ) : (
              <div className="w-20 h-20 rounded-xl border border-dashed border-gray-300 grid place-items-center text-xs text-gray-400">sem img</div>
            )}
            <div className="flex-1">
              <h2 className="text-lg font-semibold">Produto</h2>
              <p className="text-sm text-gray-600">{produtoAtual?.nome || '—'}</p>
            </div>

            <div className="min-w-[240px]">
              <label className="text-sm font-medium">Trocar produto</label>
              <select value={produtoSel} onChange={(e) => setProdutoSel(e.target.value)} className="w-full mt-1 rounded-xl border border-gray-300 p-2 bg-white">
                {produtos.map((p) => (
                  <option key={p.id} value={p.id}>{p.nome}{p.ativo ? ' • (Ativo)' : ''}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Formulário */}
        <section className="bg-white border border-gray-200 rounded-2xl p-4 md:p-6 shadow-sm mb-6">
          <h3 className="text-lg font-medium mb-4">Novo depósito</h3>
          <form onSubmit={handleSalvar} className="grid grid-cols-1 gap-4">
            {/* Linha 1: Quantidade (nome do produto) + Valor */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium flex items-center gap-2">
                  {imgMeta ? <img src={imgMeta} alt="Meta" className="w-6 h-6 rounded object-cover border" /> : <span className="inline-block w-6 h-6 rounded border border-dashed border-gray-300" />}
                  {produtoAtual?.nome ? `${produtoAtual.nome} (unidades)` : 'Quantidade (unidades)'}
                </label>
                <input
                  type="number"
                  className="w-full mt-1 rounded-xl border border-gray-300 p-2"
                  min={0}
                  value={quantidade}
                  onChange={(e) => setQuantidade(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="text-sm font-medium flex items-center gap-2">
                  <span className="inline-flex w-6 h-6 items-center justify-center rounded border border-dashed border-gray-300">R$</span>
                  Valor em dinheiro (R$)
                </label>
                <input
                  type="number" step="0.01" min={0}
                  className="w-full mt-1 rounded-xl border border-gray-300 p-2"
                  value={valorDinheiro}
                  onChange={(e) => setValorDinheiro(Number(e.target.value))}
                />
              </div>
            </div>

            {/* Linha 2: 4 insumos com imagem */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="text-sm font-medium flex items-center gap-2">
                  {imgEfedrina ? <img src={imgEfedrina} alt="Efedrina" className="w-6 h-6 rounded object-cover border" /> : <span className="inline-block w-6 h-6 rounded border border-dashed border-gray-300" />}
                  Efedrina
                </label>
                <input type="number" min={0} className="w-full mt-1 rounded-xl border border-gray-300 p-2" value={efedrina} onChange={(e) => setEfedrina(Number(e.target.value))} />
              </div>
              <div>
                <label className="text-sm font-medium flex items-center gap-2">
                  {imgPoAl ? <img src={imgPoAl} alt="Pó de alumínio" className="w-6 h-6 rounded object-cover border" /> : <span className="inline-block w-6 h-6 rounded border border-dashed border-gray-300" />}
                  Pó de alumínio
                </label>
                <input type="number" min={0} className="w-full mt-1 rounded-xl border border-gray-300 p-2" value={poAluminio} onChange={(e) => setPoAluminio(Number(e.target.value))} />
              </div>
              <div>
                <label className="text-sm font-medium flex items-center gap-2">
                  {imgEmb ? <img src={imgEmb} alt="Embalagem plástica" className="w-6 h-6 rounded object-cover border" /> : <span className="inline-block w-6 h-6 rounded border border-dashed border-gray-300" />}
                  Embalagem plástica
                </label>
                <input type="number" min={0} className="w-full mt-1 rounded-xl border border-gray-300 p-2" value={embalagemPlastica} onChange={(e) => setEmbalagemPlastica(Number(e.target.value))} />
              </div>
              <div>
                <label className="text-sm font-medium flex items-center gap-2">
                  {imgPapel ? <img src={imgPapel} alt="Folhas de papel" className="w-6 h-6 rounded object-cover border" /> : <span className="inline-block w-6 h-6 rounded border border-dashed border-gray-300" />}
                  Folhas de papel
                </label>
                <input type="number" min={0} className="w-full mt-1 rounded-xl border border-gray-300 p-2" value={folhasPapel} onChange={(e) => setFolhasPapel(Number(e.target.value))} />
              </div>
            </div>

            {/* Observação + Comprovante (compacto) */}
            <div className="grid grid-cols-1 gap-3">
              <div className="grid grid-cols-1 md:grid-cols-[1fr,auto] gap-3">
                <div>
                  <label className="text-sm font-medium">Observação</label>
                  <textarea className="w-full mt-1 rounded-xl border border-gray-300 p-2" rows={3} value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex.: Depósito conferido, lote X…" />
                </div>

                {/* Bloco do comprovante — reduzido */}
                <div>
                  <label className="text-sm font-medium">Comprovante (imagem)</label>
                  <div
                    ref={dropRef}
                    tabIndex={0}
                    className="rounded-xl border border-dashed border-gray-300 p-3 text-sm text-gray-600 bg-gray-50 focus:outline-none"
                  >
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="text-[13px]">
                        {arquivo ? (
                          <span className="text-gray-800">Selecionado: <strong>{arquivo.name}</strong></span>
                        ) : (
                          <span>Solte uma imagem aqui, <span className="underline">cole um print (Ctrl+V)</span> ou use os botões →</span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <input
                          ref={fileInputRef}
                          id="arquivo"
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={(e) => setArquivo(e.target.files?.[0] || null)}
                        />
                        <button
                          type="button"
                          className="rounded-lg border px-3 py-2 bg-white hover:bg-gray-100"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          Enviar
                        </button>
                        {arquivo && (
                          <button
                            type="button"
                            className="rounded-lg border px-3 py-2 bg-white hover:bg-gray-100"
                            onClick={() => { setArquivo(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                          >
                            Remover
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {erroForm && <div className="text-sm text-red-600">{erroForm}</div>}

              <div className="flex gap-2">
                <button type="submit" disabled={salvando} className="rounded-2xl bg-black text-white px-4 py-2 hover:opacity-90 disabled:opacity-60">
                  {salvando ? 'Salvando...' : 'Salvar depósito'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuantidade(0); setEfedrina(0); setPoAluminio(0); setEmbalagemPlastica(0);
                    setFolhasPapel(0); setValorDinheiro(0); setObservacao(''); setArquivo(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="rounded-2xl border border-gray-300 px-4 py-2 bg-white hover:bg-gray-50"
                >
                  Limpar
                </button>
              </div>
            </div>
          </form>
        </section>

        {/* Filtros da lista */}
        <section className="mb-3 flex flex-col md:flex-row items-start md:items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-sm">Ordenar:</label>
            <select value={ordem} onChange={(e) => setOrdem(e.target.value as 'asc'|'desc')} className="rounded-xl border border-gray-300 p-2">
              <option value="desc">Mais recentes</option>
              <option value="asc">Mais antigas</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm">Mostrar:</label>
            <select value={limite} onChange={(e) => setLimite(Number(e.target.value))} className="rounded-xl border border-gray-300 p-2">
              <option value={10}>10</option><option value={20}>20</option><option value={50}>50</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm">Produto:</label>
            <select value={filtroProduto} onChange={(e) => setFiltroProduto(e.target.value)} className="rounded-xl border border-gray-300 p-2 bg-white">
              <option value="">Todos</option>
              {produtos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </div>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={apenasNaoConfirmados} onChange={(e) => setApenasNaoConfirmados(e.target.checked)} />
            <span className="text-sm">Ocultar “Confirmados”</span>
          </label>
        </section>

        {/* Lista — linhas que expandem ao clicar */}
        <section className="grid grid-cols-1 gap-3">
          {registrosFiltrados.map(r => {
            const isOpen = !!expanded[r.id!];

            const itens = [
              { k: 'meta',        label: r.produtoNome || 'Meta (unid.)', valor: Number(r.quantidade || 0), img: r.produtoImagemUrl || undefined },
              { k: 'efedrina',    label: 'Efedrina',                      valor: Number(r.efedrina || 0),   img: getIngImg('efedrina') },
              { k: 'po_aluminio', label: 'Pó de alumínio',                valor: Number(r.poAluminio || 0), img: getIngImg('pó de alumínio') },
              { k: 'embalagem',   label: 'Embalagem plástica',            valor: Number(r.embalagemPlastica || 0), img: getIngImg('embalagem plástica') },
              { k: 'papel',       label: 'Folhas de papel',               valor: Number(r.folhasPapel || 0), img: getIngImg('folhas de papel') },
            ].filter(i => i.valor > 0);

            const dinheiro = Number(r.valorDinheiro || 0);
            const statusLabel = computeStatusLabel(r);

            return (
              <article key={r.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {/* Cabeçalho da linha (mostra NOME) */}
                <button
                  className="w-full flex items-center justify-between gap-3 p-3 hover:bg-gray-50 text-left"
                  onClick={() => toggleExpand(r.id)}
                  title="Clique para expandir"
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <ChipsStatusRead r={r} />
                    <div className="font-medium">
                      {r.depositoId ? `Id: ${r.depositoId}` : (r.id ? `#${r.id.slice(0,6)}` : '—')}
                    </div>
                    <div className="text-xs text-gray-600">
                      • {r.criadoPorNome || '—'}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500">{fmtData(r.criadoEm)}</div>
                </button>

                {/* Conteúdo expandido */}
                {isOpen && (
                  <div className="px-4 pb-4">
                    {/* Resumo */}
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 text-sm mt-2">
                      {itens.map((i) => (
                        <div key={i.k} className="rounded-xl border border-gray-200 p-2 flex items-center gap-2">
                          {i.img
                            ? <img src={i.img} alt={i.label} className="w-6 h-6 rounded object-cover border" />
                            : <span className="inline-block w-6 h-6 rounded border border-dashed border-gray-300" />
                          }
                          <div>
                            <div className="text-gray-500">{i.label}</div>
                            <div className="font-medium">{i.valor}</div>
                          </div>
                        </div>
                      ))}
                      {dinheiro > 0 && (
                        <div className="rounded-xl border border-gray-200 p-2 flex items-center gap-2">
                          <span className="inline-flex w-6 h-6 items-center justify-center rounded border border-dashed border-gray-300">R$</span>
                          <div>
                            <div className="text-gray-500">Dinheiro</div>
                            <div className="font-medium">
                              {dinheiro.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                            </div>
                          </div>
                        </div>
                      )}
                      {(!itens.length && dinheiro <= 0) && (
                        <div className="text-gray-500">Sem valores.</div>
                      )}
                    </div>

                    {/* Comprovante com lightbox */}
                    <div className="mt-3">
                      <h4 className="text-sm font-semibold mb-2">Comprovante</h4>
                      {r.imagemUrl ? (
                        <button
                          type="button"
                          onClick={() => setLightboxUrl(r.imagemUrl!)}
                          className="inline-block"
                          title="Ver comprovante"
                        >
                          <img
                            src={r.imagemUrl}
                            alt="Comprovante"
                            className="w-full max-w-[220px] h-auto rounded border shadow-sm hover:opacity-90 transition"
                          />
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

                    {/* 🔹 Linha pedida: quem mudou e quando */}
                    <div className="mt-3 text-sm text-gray-800">
                      {r.lastStatusByNome && r.lastStatusAt ? (
                        <span>
                          {statusLabel} por <strong>{r.lastStatusByNome}</strong> – {fmtData(r.lastStatusAt)}
                        </span>
                      ) : (
                        <span>Status: <strong>{statusLabel}</strong></span>
                      )}
                    </div>

                    {r.observacao && (
                      <p className="mt-3 text-sm text-gray-700">
                        <span className="text-gray-500">Obs:</span> {r.observacao}
                      </p>
                    )}
                  </div>
                )}
              </article>
            );
          })}

          {registrosFiltrados.length === 0 && (
            <div className="text-center text-gray-500 py-10">Nenhum depósito encontrado.</div>
          )}
        </section>
      </main>

      {/* Lightbox para o comprovante */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 bg-black/70 z-50 grid place-items-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <img
            src={lightboxUrl}
            alt="Comprovante grande"
            className="max-h-[90vh] w-auto rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 bg-white/90 px-3 py-1 rounded-md text-sm shadow"
            onClick={() => setLightboxUrl(null)}
          >
            Fechar
          </button>
        </div>
      )}
    </div>
  );
}
