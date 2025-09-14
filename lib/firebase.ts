// lib/firebase.ts
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Configuração do Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCefFOCOrjM2MoJqQ5Tr21QaiySYTqDrCk",
  authDomain: "calculadora-doce.firebaseapp.com",
  projectId: "calculadora-doce",
  storageBucket: "calculadora-doce.appspot.com",
  messagingSenderId: "67214237353",
  appId: "1:67214237353:web:94a212d1c3cf194f3413b8"
};

// Inicializa o app Firebase
const app = initializeApp(firebaseConfig);

// Exporta Auth e Firestore
export const auth = getAuth(app);
export const db = getFirestore(app);
