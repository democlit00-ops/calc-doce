

// lib/firebase.ts
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  limit,
  onSnapshot,
  type QueryDocumentSnapshot,
  type DocumentData
} from "firebase/firestore";
  
const firebaseConfig = {
  apiKey: "AIzaSyCefFOCOrjM2MoJqQ5Tr21QaiySYTqDrCk",
  authDomain: "calculadora-doce.firebaseapp.com",
  projectId: "calculadora-doce",
  storageBucket: "calculadora-doce.appspot.com", // ✅ corrigido
  messagingSenderId: "67214237353",
  appId: "1:67214237353:web:94a212d1c3cf194f3413b8"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// funções utilitárias (valores)
export {
  collection,
  addDoc,
  getDocs,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  limit,
  onSnapshot
};

// tipos (necessário `export type` por causa do isolatedModules)
export type { QueryDocumentSnapshot, DocumentData };

/** util: obter ingrediente único (se ainda quiser usar em outro lugar) */
export async function getIngredienteUnico<T = any>(): Promise<T | null> {
  try {
    const snap = await getDoc(doc(db, "ingredienteUnico", "principal"));
    return snap.exists() ? (snap.data() as T) : null;
  } catch (e) {
    console.error("Erro ao buscar ingrediente principal:", e);
    return null;
  }
}

/** util: salvar ingrediente único */
export async function setIngredienteUnico<T = any>(dados: T): Promise<boolean> {
  try {
    await setDoc(doc(db, "ingredienteUnico", "principal"), dados as any);
    return true;
  } catch (e) {
    console.error("Erro ao salvar ingrediente principal:", e);
    return false;
  }
} 