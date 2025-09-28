"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
} from "firebase/firestore";

type RoleLevel = 1|2|3|4|5|6|7|8|9;

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

type AlertDoc = {
  id: string;
  message: string;
  authorUid: string;
  authorName: string;
  authorRole: RoleLevel;
  createdAt: Timestamp | null;
};

export default function GlobalAlertsClient() {
  const [uid, setUid] = useState<string | null>(null);
  const [latestAlert, setLatestAlert] = useState<AlertDoc | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  // autenticação (somente logado vê)
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUid(u?.uid || null);
    });
    return () => unsub();
  }, []);

  // assina o alerta mais recente e verifica se o usuário já leu
  useEffect(() => {
    if (!uid) {
      setLatestAlert(null);
      return;
    }

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
        const ackRef = doc(db, "users", uid, "alert_acks", last.id);
        const ackSnap = await getDoc(ackRef);
        if (!ackSnap.exists()) {
          setLatestAlert(last);      // não lido -> mostra botão
        } else {
          setLatestAlert(null);      // lido -> some
        }
      } catch {
        setLatestAlert(last);        // erro ao checar -> mostra por segurança
      }
    });

    return () => unsub();
  }, [uid]);

  // marcar como lido
  async function markAsRead() {
    if (!uid || !latestAlert) return;
    try {
      const ackRef = doc(db, "users", uid, "alert_acks", latestAlert.id);
      await setDoc(ackRef, { readAt: serverTimestamp() }, { merge: true });
      setShowDialog(false);
      setLatestAlert(null); // botão some
    } catch {
      // silencioso
    }
  }

  // sem autenticação ou sem alerta não lido -> nada
  if (!uid || !latestAlert) return null;

  return (
    <>
      {/* Botão flutuante global — canto ESQUERDO para não trombar com “Doar” */}
      <button
        onClick={() => setShowDialog(true)}
        className="fixed bottom-4 left-4 z-50 rounded-full px-4 py-2 text-sm font-semibold shadow-lg border
                   bg-amber-600 text-white hover:bg-amber-700 border-amber-700"
        aria-label="Abrir alerta"
      >
        🔔 Alerta
      </button>

      {/* Modal do alerta mais recente */}
      {showDialog && (
        <div
          className="fixed inset-0 z-[9999] bg-black/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowDialog(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 w-full max-w-md rounded-xl shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-semibold">Alerta</h3>
              <button
                onClick={() => setShowDialog(false)}
                className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-2">
              <div className="text-sm font-semibold">
                {latestAlert.authorName} — {ROLE_LABELS[latestAlert.authorRole]}
              </div>
              <div className="text-sm whitespace-pre-wrap">{latestAlert.message}</div>
              <div className="text-[11px] text-gray-500 mt-1">
                {latestAlert.createdAt?.toDate
                  ? latestAlert.createdAt.toDate().toLocaleString()
                  : "—"}
              </div>
            </div>

            <div className="p-3 border-t flex justify-end gap-2">
              <button
                onClick={() => setShowDialog(false)}
                className="px-3 py-1.5 rounded-lg border text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                Ver depois
              </button>
              <button
                onClick={markAsRead}
                className="px-3 py-1.5 rounded-lg border text-sm font-semibold
                           bg-emerald-600 text-white hover:bg-emerald-700 border-emerald-700"
              >
                Marcar como lido
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
