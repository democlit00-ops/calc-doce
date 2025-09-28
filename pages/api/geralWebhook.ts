import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { acao, autor, usuario, alteracoes } = req.body;

    const url = process.env.DISCORD_WEBHOOK_URL;
    if (!url) {
      console.error("❌ Variável DISCORD_WEBHOOK_URL não configurada");
      return res.status(500).json({ error: "Webhook geral não configurado" });
    }

    const agora = new Date().toLocaleString("pt-BR");

    // Títulos e cores das mensagens
    let title = "";
    let fields: any[] = [];
    let color = 0x00ff99; // Padrão verde

    // Formatação para criação de usuário
    if (acao === "criado") {
      title = `🟢 Novo usuário criado`;
      fields = [
        { name: "🧍 Nome", value: usuario.nome, inline: true },
        { name: "📧 Email (Login)", value: `\`${usuario.email}\``, inline: true },
        { name: "💬 Discord", value: usuario.discord || "Não informado", inline: true },
        { name: "🆔 Passaporte", value: usuario.passaport || "Não informado", inline: true },
        { name: "🏷️ Hierarquia", value: usuario.roleLevel, inline: true },
      ];
    }

    // Formatação para exclusão de usuário
    if (acao === "excluido") {
      title = `⚠️ Usuário excluído`;
      fields = [
        { name: "🧍 Nome", value: usuario.nome, inline: true },
        { name: "📧 Email (Login)", value: `\`${usuario.email}\``, inline: true },
        { name: "💬 Discord", value: usuario.discord || "Não informado", inline: true },
        { name: "🆔 Passaporte", value: usuario.passaport || "Não informado", inline: true },
        { name: "🏷️ Hierarquia", value: usuario.roleLevel, inline: true },
      ];
      color = 0xff3333; // Vermelho para exclusão
    }

    // Formatação para edição de usuário
    if (acao === "editado") {
      title = `✏️ Usuário editado`;
      const lista = (alteracoes ?? [])
        .map((alt: string) => `• ${alt}`)
        .join("\n") || "Nenhuma alteração detectada";
      fields = [
        { name: "🧍 Nome", value: usuario.nome, inline: true },
        { name: "📋 Alterações", value: lista, inline: false },
      ];
      color = 0xffcc00; // Amarelo para edição
    }

    const embed = {
      author: {
        name: `${acao === "criado" ? "Cadastrado" : acao === "editado" ? "Editado" : "Excluído"} por ${autor ?? "Desconhecido"}`
      },
      title,
      color,
      fields,
      footer: { text: `🕒 ${acao === "criado" ? "Criado" : acao === "editado" ? "Editado" : "Excluído"} em ${agora}` },
    };

    const resposta = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Log de Contas",
        embeds: [embed],
      }),
    });

    if (!resposta.ok) {
      const txt = await resposta.text().catch(() => "");
      console.error("❌ Erro do Discord:", resposta.status, txt);
      return res.status(500).json({ error: "Falha ao enviar para o Discord" });
    }

    console.log("✅ Log enviado com sucesso");
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("❌ Erro no servidor:", e);
    res.status(500).json({ error: "Erro interno" });
  }
}
