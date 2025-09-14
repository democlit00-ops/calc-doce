// createadm.js
import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, addDoc } from "firebase/firestore";

// Configuração do Firebase (substitua pelos seus dados)
const firebaseConfig = {
  apiKey: "AIzaSyCefFOCOrjM2MoJqQ5Tr21QaiySYTqDrCk",
  authDomain: "calculadora-doce.firebaseapp.com",
  projectId: "calculadora-doce",
  storageBucket: "calculadora-doce.appspot.com",
  messagingSenderId: "67214237353",
  appId: "1:67214237353:web:94a212d1c3cf194f3413b8"
};

// Inicializa Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

async function createMasterAdmin() {
  const email = "democlit00@gmail.com";
  const password = "striker87";
  const nome = "Adm Geral Kito Biten";
  const roleLevel = 1;
  const discord = "kitobiten";
  const passaport = "10057";
  const pasta =
    "https://discord.com/api/webhooks/1416494036310823003/hiN7PF-0Mq0ZGchmtKzv3mKDCAHOBm3ozit9IAGs58HjxJibwno_1VLny3FYV_VIQAwd";

  try {
    // Criar no Firebase Auth
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    console.log("Usuário Auth criado com sucesso!");

    // Criar no Firestore
    await addDoc(collection(db, "users"), {
      email: email.toLowerCase(),
      senha: password,
      nome,
      discord,
      passaport,
      pasta,
      roleLevel,
    });

    console.log("Usuário Mestre adicionado ao Firestore com sucesso!");
  } catch (err) {
    console.error("Erro ao criar usuário mestre:", err.message);
  }
}

createMasterAdmin();
