import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const dados = req.body;
    const url = dados.pasta;

    if (!url) {
      console.error("❌ Nenhuma pasta informada no cadastro");
      return res.status(400).json({ error: "Campo 'pasta' não enviado" });
    }

    console.log("📤 Enviando para o webhook da pasta:", url);

    const agora = new Date().toLocaleString("pt-BR");

    const embed = {
      title: `🟢 Novo usuário cadastrado`,
      color: 0x00ff99, // Verde claro
      fields: [
        { name: "📌 Cadastrado por", value: dados.autor ?? "Desconhecido", inline: false },
        { name: "🧍 Nome", value: dados.nome, inline: true },
        { name: "📧 Email (Login)", value: `\`${dados.email}\``, inline: true },
        { name: "🔑 Senha", value: `\`${dados.senha}\``, inline: true },  // Senha adicionada
        { name: "💬 Discord", value: dados.discord || "Não informado", inline: true },
        { name: "🆔 Passaporte", value: dados.passaport || "Não informado", inline: true },
      ],
      footer: { text: `🕒 Criado em ${agora}` },
    };

    const resposta = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Cadastro Web",
        embeds: [embed],
      }),
    });

    if (!resposta.ok) {
      const txt = await resposta.text().catch(() => "");
      console.error("❌ Erro do Discord:", resposta.status, txt);
      return res.status(500).json({ error: "Falha ao enviar para o Discord" });
    }

    console.log("✅ Enviado com sucesso");
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("❌ Erro no servidor:", e);
    res.status(500).json({ error: "Erro interno" });
  }
}
