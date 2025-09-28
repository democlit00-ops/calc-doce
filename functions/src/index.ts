import { setGlobalOptions } from "firebase-functions";
import { onRequest } from "firebase-functions/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

admin.initializeApp();
setGlobalOptions({ maxInstances: 10 });

const db = admin.firestore();

// Função para criar usuário
export const createUser = onRequest(async (req, res) => {
  try {
    const { email, senha, nome, passaport, discord, roleLevel, pasta } = req.body;

    if (!email || !senha || !nome || roleLevel === undefined) {
      res.status(400).send("Campos obrigatórios ausentes");
      return;
    }

    // Criar usuário no Firebase Auth
    const userRecord = await admin.auth().createUser({
      email,
      password: senha,
    });

    // Criar documento no Firestore
    await db.collection("users").doc(userRecord.uid).set({
      nome,
      passaport: passaport || "",
      discord: discord || "",
      roleLevel,
      pasta: pasta || "",
    });

    res.status(200).send({ uid: userRecord.uid });
  } catch (error) {
    logger.error("Erro ao criar usuário:", error);
    res.status(500).send(error);
  }
});

// Função para atualizar usuário
export const updateUser = onRequest(async (req, res) => {
  try {
    const { uid, nome, passaport, discord, roleLevel, pasta, senha } = req.body;

    if (!uid) {
      res.status(400).send("UID é obrigatório");
      return;
    }

    // Atualiza Auth
    if (senha) {
      await admin.auth().updateUser(uid, { password: senha });
    }

    // Atualiza Firestore
    const updateData: any = {};
    if (nome) updateData.nome = nome;
    if (passaport) updateData.passaport = passaport;
    if (discord) updateData.discord = discord;
    if (roleLevel !== undefined) updateData.roleLevel = roleLevel;
    if (pasta) updateData.pasta = pasta;

    if (Object.keys(updateData).length > 0) {
      await db.collection("users").doc(uid).update(updateData);
    }

    res.status(200).send("Usuário atualizado com sucesso");
  } catch (error) {
    logger.error("Erro ao atualizar usuário:", error);
    res.status(500).send(error);
  }
});

// Função para deletar usuário
export const deleteUser = onRequest(async (req, res) => {
  try {
    const { uid } = req.body;
    if (!uid) {
      res.status(400).send("UID é obrigatório");
      return;
    }

    // Deleta do Auth
    await admin.auth().deleteUser(uid);

    // Deleta do Firestore
    await db.collection("users").doc(uid).delete();

    res.status(200).send("Usuário deletado com sucesso");
  } catch (error) {
    logger.error("Erro ao deletar usuário:", error);
    res.status(500).send(error);
  }
});
