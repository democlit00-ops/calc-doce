'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Sidebar from '@/components/ui/sidebar';
import { auth, db } from '@/lib/firebase';
import {
  onAuthStateChanged,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

/* =========================
   Tipos
========================= */
type LoggedUser = {
  uid: string;
  id?: string;
  nome: string;
  email?: string | null;
  roleLevel: number;
};

type UserRow = {
  uid: string;
  nome: string;
  roleLevel: number;
  basePoints: number;
  bonusPoints: number;
  totalPoints: number;
  unitValue: number;
  amountInt: number;
  status: 'pending' | 'pago' | 'negado';
};

type WeightsByRole = Record<number, number>;

type WeekOption = {
  id: string;        // YYYY-WW
  label: string;     // "YYYY-WW — dd/mm a dd/mm"
  start: Date;       // segunda 00:00 (local)
  end: Date;         // domingo 23:59:59 (local)
};

/* =========================
   Timezone / Semana helpers
========================= */
const TIMEZONE = 'America/Sao_Paulo';
const TZ_OFFSET_HOURS = -3; // revisar se o Brasil voltar com DST
const TZ_OFFSET_MS = Math.abs(TZ_OFFSET_HOURS) * 60 * 60 * 1000;

function fmtDM(date: Date) {
  const f = new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE,
    day: '2-digit',
    month: '2-digit',
  });
  return f.format(date);
}

function getISOWeekId(date = new Date()) {
  const local = new Date(date.getTime() + TZ_OFFSET_MS);
  const anyDay = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  const d = new Date(anyDay);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // quinta
  const year = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((+d - +yearStart) / 86400000 + 1) / 7);
  return `${year}-${String(week).padStart(2, '0')}`;
}

/** Dado "YYYY-WW", retorna segunda 00:00 → domingo 23:59:59 (em horário local SP) */
function getRangeFromWeekId(weekId: string): { start: Date; end: Date } {
  const [yStr, wStr] = weekId.split('-');
  const year = Number(yStr);
  const week = Number(wStr);

  const anyDay = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = anyDay.getUTCDay() || 7;
  const thursday = new Date(anyDay);
  thursday.setUTCDate(anyDay.getUTCDate() + (4 - dow));

  const mondayUTC = new Date(thursday);
  mondayUTC.setUTCDate(thursday.getUTCDate() - 3);
  mondayUTC.setUTCHours(0, 0, 0, 0);

  const startLocal = new Date(mondayUTC.getTime() + TZ_OFFSET_MS);
  startLocal.setHours(0, 0, 0, 0);

  const endLocal = new Date(startLocal);
  endLocal.setDate(endLocal.getDate() + 6);
  endLocal.setHours(23, 59, 59, 999);

  return { start: startLocal, end: endLocal };
}

function weeksInISOYear(year: number): number {
  const wid = getISOWeekId(new Date(Date.UTC(year, 11, 28)));
  return Number(wid.split('-')[1]);
}

function getPrevWeekId(curWeekId: string): string {
  const [yStr, wStr] = curWeekId.split('-');
  let year = Number(yStr);
  let week = Number(wStr) - 1;

  if (week < 1) {
    year -= 1;
    week = weeksInISOYear(year);
  }
  return `${year}-${String(week).padStart(2, '0')}`;
}

function buildLastNWeekOptions(n = 12): WeekOption[] {
  const opts: WeekOption[] = [];
  let wid = getISOWeekId(new Date());
  for (let i = 0; i < n; i++) {
    const { start, end } = getRangeFromWeekId(wid);
    opts.push({
      id: wid,
      label: `${wid} — ${fmtDM(start)} a ${fmtDM(end)}`,
      start,
      end,
    });
    wid = getPrevWeekId(wid);
  }
  return opts;
}

/* =========================
   Pesos padrão
========================= */
function roleNameFromLevel(roleLevel: number): string {
  switch (roleLevel) {
    case 1: return 'CHEFE';
    case 2: return 'GERENTE GERAL';
    case 3: return 'GERENTE DE AÇÃO';
    case 4: return 'GERENTE DE FARM';
    case 5: return 'GERENTE DE VENDAS';
    case 6: return 'SOLDADO FARM';
    case 7: return 'SOLDADO AÇÃO';
    case 8: return 'VAPOR';
    case 9: return 'AVIÃO';
    default: return `ROLE ${roleLevel}`;
  }
}

function defaultWeights(): WeightsByRole {
  return {
    1: 0,
    2: 6,
    3: 6,
    4: 6,
    5: 6,
    6: 4,
    7: 3,
    8: 2,
    9: 2,
  };
}

/* =========================
   Helpers de reconstrução / cálculo
========================= */
// Recria rows a partir dos users e weights, preservando bonus/status atuais
function rebuildRowsFromUsers(
  users: LoggedUser[],
  weights: WeightsByRole,
  prevRows: UserRow[]
): UserRow[] {
  const prevByUid = new Map(prevRows.map(r => [r.uid, r]));
  return users
    .filter(u => u.roleLevel >= 2 && u.roleLevel <= 9)
    .map(u => {
      const prev = prevByUid.get(u.uid);
      const basePoints = Number(weights[u.roleLevel] ?? 0);
      const bonusPoints = prev?.bonusPoints ?? 0;
      const totalPoints = Math.max(0, basePoints + bonusPoints);
      const status = (prev?.status ?? 'pending') as UserRow['status'];
      return {
        uid: u.uid,
        nome: u.nome,
        roleLevel: u.roleLevel,
        basePoints,
        bonusPoints,
        totalPoints,
        unitValue: 0,
        amountInt: 0,
        status,
      };
    });
}

// Recalcula unitValue/amountInt/sum e retorna tudo
function computeTotals(rows: UserRow[], totalPool: number) {
  const sumPoints = rows.reduce((acc, r) => acc + Number(r.totalPoints || 0), 0);
  const unitValue = sumPoints > 0 ? Number(totalPool) / sumPoints : 0;
  const nextRows = rows.map(r => {
    const amountInt = Math.floor(unitValue * r.totalPoints);
    return { ...r, unitValue, amountInt };
  });
  const paid = nextRows.reduce((acc, r) => acc + r.amountInt, 0);
  const leftover = Number(totalPool) - paid;
  return { nextRows, unitValue, sumPoints, leftover };
}

/* =========================
   Componente
========================= */
export default function PagePLR() {
  // Sidebar
  const [activePage, setActivePage] = useState('plr');

  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null);
  const [logged, setLogged] = useState<LoggedUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Semana (select + rótulos)
  const weekOptions = useMemo(() => buildLastNWeekOptions(12), []);
  const [weekId, setWeekId] = useState<string>(getISOWeekId());

  const weekLabel = useMemo(() => {
    const { start, end } = getRangeFromWeekId(weekId);
    return `Semana, ${fmtDM(start)} a ${fmtDM(end)}`;
  }, [weekId]);

  const prevWeekId = useMemo(() => getPrevWeekId(weekId), [weekId]);
  const prevWeekLabel = useMemo(() => {
    const { start, end } = getRangeFromWeekId(prevWeekId);
    return `Semana passada, ${fmtDM(start)} a ${fmtDM(end)}`;
  }, [prevWeekId]);

  // PLR (admin)
  const [totalPool, setTotalPool] = useState<number>(200);
  const [weights, setWeights] = useState<WeightsByRole>(defaultWeights());
  const [allUsers, setAllUsers] = useState<LoggedUser[]>([]);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [unitValue, setUnitValue] = useState<number>(0);
  const [sumPoints, setSumPoints] = useState<number>(0);
  const [leftover, setLeftover] = useState<number>(0);

  // Aba de pesos (só role 1)
  const [weightsOpen, setWeightsOpen] = useState(false);

  const isAdmin = useMemo(() => !!logged && (logged.roleLevel === 1 || logged.roleLevel === 2), [logged]);
  const isBoss = useMemo(() => !!logged && logged.roleLevel === 1, [logged]);
  const isCommonUser = !isAdmin; // roles 3–9

  // auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setAuthUser(u);
      if (!u) {
        setLogged(null);
        setLoading(false);
        return;
      }
      const userDoc = await getDoc(doc(db, 'users', u.uid));
      const data = userDoc.exists() ? userDoc.data() : null;
      const user: LoggedUser = {
        uid: u.uid,
        id: u.uid,
        nome: data?.nome ?? (u.displayName ?? 'Sem nome'),
        email: u.email,
        roleLevel: Number(data?.roleLevel ?? 9),
      };
      setLogged(user);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // users em tempo real
  useEffect(() => {
    if (!authUser) return;
    const usersRef = collection(db, 'users');
    const unsub = onSnapshot(usersRef, (qs) => {
      const list: LoggedUser[] = [];
      qs.forEach((d) => {
        const u = d.data() as any;
        list.push({
          uid: d.id,
          id: d.id,
          nome: u?.nome ?? 'Sem nome',
          email: u?.email ?? null,
          roleLevel: Number(u?.roleLevel ?? 9),
        });
      });
      setAllUsers(list);
    });
    return () => unsub();
  }, [authUser]);

  // reconstrói rows e recalcula quando users/weights/totalPool mudam
  useEffect(() => {
    const rebuilt = rebuildRowsFromUsers(allUsers, weights, rows);
    const { nextRows, unitValue, sumPoints, leftover } = computeTotals(rebuilt, totalPool);
    setRows(nextRows);
    setUnitValue(unitValue);
    setSumPoints(sumPoints);
    setLeftover(leftover);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allUsers, weights, totalPool]);

  // carrega dados existentes da semana (merge sem sobrescrever basePoints)
  useEffect(() => {
    if (!authUser || !weekId) return;
    const weekRef = doc(db, 'plrWeeks', weekId);
    const unsub = onSnapshot(weekRef, async (snap) => {
      if (!snap.exists()) return;
      const w = snap.data() as any;
      if (typeof w?.totalPool === 'number') setTotalPool(w.totalPool);
      if (w?.weights) setWeights(w.weights as WeightsByRole);

      const distQs = await getDocs(
        query(collection(db, 'plrWeeks', weekId, 'distribuicoes'))
      );
      if (distQs.empty) return;

      const mapByUid: Record<string, any> = {};
      distQs.forEach(d => { mapByUid[d.id] = d.data(); });

      setRows(prev => {
        // usa prev (já reconstruído conforme users/weights)
        const merged = prev.map(r => {
          const x = mapByUid[r.uid];
          if (!x) return r;
          const raw = (x.status as string | undefined) ?? r.status;
          const normalized = raw === 'confirmado' ? 'pago' : raw; // migração
          const bonus = typeof x.bonusPoints === 'number' ? x.bonusPoints : r.bonusPoints;
          const totalPoints = Math.max(0, r.basePoints + bonus); // base SEMPRE do cálculo atual
          return {
            ...r,
            bonusPoints: bonus,
            totalPoints,
            // unit/amount serão recalculados abaixo via computeTotals
            unitValue: r.unitValue,
            amountInt: r.amountInt,
            status: (normalized as UserRow['status']),
          };
        });

        const { nextRows, unitValue, sumPoints, leftover } =
          computeTotals(merged, Number(w.totalPool ?? totalPool));
        setUnitValue(unitValue);
        setSumPoints(sumPoints);
        setLeftover(leftover);
        return nextRows;
      });
    });
    return () => unsub();
  }, [authUser, weekId, totalPool]);

  // handlers
  const handleWeightChange = (role: number, val: number) => {
    setWeights(prev => ({ ...prev, [role]: Number(val) }));
  };

  const handleBonusChange = (uid: string, val: number) => {
    setRows(prev => {
      const updated = prev.map(r => r.uid === uid ? {
        ...r,
        bonusPoints: Number(val),
        totalPoints: Math.max(0, r.basePoints + Number(val)),
      } : r);
      const { nextRows } = computeTotals(updated, totalPool);
      return nextRows;
    });
  };

  const toggleStatus = async (uid: string, next: 'pago' | 'negado' | 'pending') => {
    setRows(prev => prev.map(r => r.uid === uid ? { ...r, status: next } : r));
    const distRef = doc(db, 'plrWeeks', weekId, 'distribuicoes', uid);
    const exists = await getDoc(distRef);
    if (exists.exists()) {
      await updateDoc(distRef, {
        status: next,
        updatedAt: serverTimestamp(),
      });
    }
  };

  const recalc = () => {
    setRows(prev => {
      const { nextRows, unitValue, sumPoints, leftover } = computeTotals(prev, totalPool);
      setUnitValue(unitValue);
      setSumPoints(sumPoints);
      setLeftover(leftover);
      return nextRows;
    });
  };

  const saveWeek = async () => {
    // garante cálculo fresco antes de salvar
    const { nextRows, unitValue: u, sumPoints: s, leftover: _l } = computeTotals(rows, totalPool);
    setRows(nextRows);
    setUnitValue(u);
    setSumPoints(s);
    setLeftover(_l);

    const batch = writeBatch(db);
    const weekRef = doc(db, 'plrWeeks', weekId);

    batch.set(weekRef, {
      totalPool: Number(totalPool),
      unitValue: Number(u),
      sumPoints: Number(s),
      weights,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });

    nextRows.forEach(r => {
      const distRef = doc(db, 'plrWeeks', weekId, 'distribuicoes', r.uid);
      batch.set(distRef, {
        uid: r.uid,
        nome: r.nome,
        roleLevel: r.roleLevel,
        basePoints: Number(r.basePoints),
        bonusPoints: Number(r.bonusPoints),
        totalPoints: Number(r.totalPoints),
        unitValue: Number(u),
        amountInt: Number(r.amountInt),
        status: r.status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });

      const histRef = doc(db, 'plrHistory', r.uid, 'items', weekId);
      batch.set(histRef, {
        weekId,
        amountInt: Number(r.amountInt),
        unitValue: Number(u),
        totalPoints: Number(r.totalPoints),
        roleLevel: r.roleLevel,
        createdAt: serverTimestamp(),
      }, { merge: true });
    });

    await batch.commit();
    alert('PLR da semana salvo!');
  };

  // === VISÃO DO USUÁRIO COMUM (3–9): mostrar SEMANA PASSADA ===
  const [myThisWeek, setMyThisWeek] = useState<null | {
    amountInt: number;
    status: 'pending' | 'pago' | 'negado';
    unitValue: number;
    totalPoints: number;
  }>(null);
  const [myHistory, setMyHistory] = useState<Array<{ weekId: string; amountInt: number }>>([]);

  useEffect(() => {
    if (!logged) return;
    (async () => {
      const targetWeekId = prevWeekId;
      const distRef = doc(db, 'plrWeeks', targetWeekId, 'distribuicoes', logged.uid);
      const d = await getDoc(distRef);
      if (d.exists()) {
        const x = d.data() as any;
        const raw = (x.status as string | undefined) ?? 'pending';
        const normalized = (raw === 'confirmado' ? 'pago' : raw) as 'pending' | 'pago' | 'negado';
        setMyThisWeek({
          amountInt: x.amountInt ?? 0,
          status: normalized,
          unitValue: x.unitValue ?? 0,
          totalPoints: x.totalPoints ?? 0,
        });
      } else {
        setMyThisWeek(null);
      }
      const histQs = await getDocs(
        query(
          collection(db, 'plrHistory', logged.uid, 'items'),
          orderBy('createdAt', 'desc')
        )
      );
      const arr: Array<{ weekId: string; amountInt: number }> = [];
      histQs.forEach(h => {
        const x = h.data() as any;
        arr.push({
          weekId: x.weekId ?? h.id,
          amountInt: x.amountInt ?? 0,
        });
      });
      setMyHistory(arr.slice(0, 10));
    })();
  }, [logged, prevWeekId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f5f7fb] text-gray-900">
        <div className="flex">
          <Sidebar activePage={activePage} setActivePage={setActivePage} />
          <main className="flex-1 p-4">Carregando...</main>
        </div>
      </div>
    );
  }

  if (!logged) {
    return (
      <div className="min-h-screen bg-[#f5f7fb] text-gray-900">
        <div className="flex">
          <Sidebar activePage={activePage} setActivePage={setActivePage} />
          <main className="flex-1 p-4">Faça login para ver o PLR.</main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f7fb] text-gray-900">
      <div className="flex">
        <Sidebar activePage={activePage} setActivePage={setActivePage} />

        <main className="flex-1 p-4 max-w-6xl">
          <h1 className="text-2xl font-bold mb-3">PLR Semanal</h1>

          {/* Cabeçalho / Semana */}
          <div className="flex flex-col md:flex-row items-start md:items-end gap-3 mb-6">
            <div>
              <label className="block text-sm font-medium">Semana</label>
              <select
                className="border rounded px-3 py-2 w-60 bg-white"
                value={weekId}
                onChange={(e) => setWeekId(e.target.value)}
                disabled={!isAdmin}
              >
                {weekOptions.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">{weekLabel}</p>
              {!isAdmin && (
                <p className="text-xs text-gray-500 mt-1">
                  Exibindo sua PLR da <b>semana passada</b>: {prevWeekLabel}.
                </p>
              )}
            </div>

            {isAdmin && (
              <>
                <div>
                  <label className="block text-sm font-medium">Valor total (R$)</label>
                  <input
                    type="number"
                    className="border rounded px-3 py-2 w-40 bg-white"
                    value={totalPool}
                    onChange={(e) => setTotalPool(Number(e.target.value))}
                  />
                </div>

                <button
                  onClick={recalc}
                  className="ml-auto bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2"
                >
                  Recalcular
                </button>

                <button
                  onClick={saveWeek}
                  className="bg-green-600 hover:bg-green-700 text-white rounded px-4 py-2"
                >
                  Salvar distribuição
                </button>
              </>
            )}
          </div>

          {/* Aba: Pesos por Hierarquia (só role 1) */}
          {isBoss && (
            <div className="bg-white rounded-2xl shadow p-0 mb-6 overflow-hidden">
              <button
                onClick={() => setWeightsOpen((s) => !s)}
                className="w-full text-left px-4 py-3 bg-gray-100 hover:bg-gray-200 flex items-center justify-between"
              >
                <span className="font-semibold">Pesos por Hierarquia (editável)</span>
                <span className="text-sm text-gray-600">{weightsOpen ? 'Recolher' : 'Expandir'}</span>
              </button>

              {weightsOpen && (
                <div className="p-4">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[1,2,3,4,5,6,7,8,9].map((rl) => (
                      <div key={rl} className="border rounded p-3">
                        <div className="text-xs text-gray-500">Role {rl}</div>
                        <div className="font-medium mb-2">{roleNameFromLevel(rl)}</div>
                        <input
                          type="number"
                          className="border rounded px-2 py-1 w-full"
                          value={Number(weights[rl] ?? 0)}
                          onChange={(e) => handleWeightChange(rl, Number(e.target.value))}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-3">
                    Ex.: gerente (2–5)=6, soldado farm (6)=4, soldado ação (7)=3, vapor/avião (8–9)=2. Chefe (1) normalmente 0.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Admin view (role 1 e 2) */}
          {isAdmin ? (
            <>
              {/* Resumo */}
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className="inline-flex items-center gap-2 bg-white rounded-xl shadow px-3 py-2">
                  <span className="text-sm text-gray-500">Pontos totais</span>
                  <span className="font-bold">{sumPoints}</span>
                </span>
                <span className="inline-flex items-center gap-2 bg-white rounded-xl shadow px-3 py-2">
                  <span className="text-sm text-gray-500">Valor por ponto (R$)</span>
                  <span className="font-bold">{unitValue.toFixed(2)}</span>
                </span>
                <span className="inline-flex items-center gap-2 bg-white rounded-xl shadow px-3 py-2">
                  <span className="text-sm text-gray-500">Sobra (R$)</span>
                  <span className={`font-bold ${leftover < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                    {leftover}
                  </span>
                </span>
              </div>

              {/* Tabela principal */}
              <div className="bg-white rounded-2xl shadow overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-2">Nome</th>
                      <th className="text-left p-2">Hierarquia</th>
                      <th className="text-right p-2">Base</th>
                      <th className="text-right p-2">+ Bônus</th>
                      <th className="text-right p-2">Pts Totais</th>
                      <th className="text-right p-2">R$/Ponto</th>
                      <th className="text-right p-2">Valor (int)</th>
                      <th className="text-center p-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.uid} className="border-t">
                        <td className="p-2">{r.nome}</td>
                        <td className="p-2">{roleNameFromLevel(r.roleLevel)}</td>
                        <td className="p-2 text-right">{r.basePoints}</td>
                        <td className="p-2 text-right">
                          <input
                            type="number"
                            className="border rounded px-2 py-1 w-20 text-right"
                            value={r.bonusPoints}
                            onChange={(e) => handleBonusChange(r.uid, Number(e.target.value))}
                          />
                        </td>
                        <td className="p-2 text-right">{r.totalPoints}</td>
                        <td className="p-2 text-right">{unitValue.toFixed(2)}</td>
                        <td className="p-2 text-right font-semibold">{r.amountInt}</td>
                        <td className="p-2">
                          {/* Badge de status */}
                          <div className={`px-2 py-0.5 rounded text-xs text-center mb-2
                            ${r.status === 'pago' ? 'bg-green-100 text-green-800'
                              : r.status === 'negado' ? 'bg-red-100 text-red-800'
                              : 'bg-gray-100 text-gray-800'}`}>
                            {r.status}
                          </div>
                          {/* Ações */}
                          <div className="flex gap-2 justify-center">
                            <button
                              onClick={() => toggleStatus(r.uid, 'pago')}
                              className={`px-2 py-1 rounded text-xs ${r.status === 'pago' ? 'bg-green-600 text-white' : 'bg-green-100 text-green-700'}`}
                            >
                              Pagar
                            </button>
                            <button
                              onClick={() => toggleStatus(r.uid, 'negado')}
                              className={`px-2 py-1 rounded text-xs ${r.status === 'negado' ? 'bg-red-600 text-white' : 'bg-red-100 text-red-700'}`}
                            >
                              Negar
                            </button>
                            <button
                              onClick={() => toggleStatus(r.uid, 'pending')}
                              className={`px-2 py-1 rounded text-xs ${r.status === 'pending' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-800'}`}
                            >
                              Pendente
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t">
                    <tr>
                      <td className="p-2 font-semibold" colSpan={2}>Totais</td>
                      <td className="p-2 text-right font-semibold" colSpan={3}>
                        {sumPoints} pts
                      </td>
                      <td className="p-2 text-right font-semibold">
                        {unitValue.toFixed(2)}
                      </td>
                      <td className="p-2 text-right font-semibold">
                        {rows.reduce((acc, r) => acc + r.amountInt, 0)}
                      </td>
                      <td className="p-2 text-center">
                        <span className={`px-2 py-1 rounded text-xs ${leftover < 0 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                          Sobra: {leftover}
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          ) : (
            /* Visão do usuário (3–9): SEMANA PASSADA */
            <div className="space-y-6">
              <div className="bg-white rounded-2xl shadow p-4">
                <div className="text-lg font-semibold mb-1">Sua PLR da semana passada</div>
                <div className="text-xs text-gray-500 mb-2">{prevWeekLabel}</div>
                {myThisWeek ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center gap-2 bg-gray-50 rounded px-3 py-2">
                      <span className="text-sm text-gray-500">Valor</span>
                      <span className="font-bold text-lg">R$ {myThisWeek.amountInt}</span>
                    </span>
                    <span className={`inline-flex items-center gap-2 rounded px-3 py-2 ${
                      myThisWeek.status === 'pago' ? 'bg-green-100 text-green-800'
                      : myThisWeek.status === 'negado' ? 'bg-red-100 text-red-800'
                      : 'bg-gray-100 text-gray-800'
                    }`}>
                      <span className="text-sm opacity-80">Status</span>
                      <span className="font-semibold capitalize">{myThisWeek.status}</span>
                    </span>
                  </div>
                ) : (
                  <div className="text-gray-500">
                    Ainda não há PLR registrada para sua conta na semana passada.
                  </div>
                )}
              </div>

              <div className="bg-white rounded-2xl shadow p-4">
                <div className="text-lg font-semibold mb-3">Histórico (últimas 10)</div>
                {myHistory.length === 0 ? (
                  <div className="text-gray-500">Sem histórico ainda.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left p-2">Semana</th>
                          <th className="text-right p-2">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {myHistory.map((h) => (
                          <tr key={h.weekId} className="border-t">
                            <td className="p-2">{h.weekId}</td>
                            <td className="p-2 text-right">R$ {h.amountInt}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
