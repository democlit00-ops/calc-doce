// components/webhook/vendasWebhook.ts
import "server-only";

type PayloadVenda = {
  tipo: "nova_venda";
  cadastradoPor: string;
  userId: string;
  roleLevel: number;
  produto: string;
  quantidade: number;
  valor: number;
  createdAt: string; // ISO
};

// Personalização opcional do bot no Discord
const BOT_NAME = process.env.WEBHOOK_BOT_NAME || "Registro de Vendas";
const BOT_AVATAR = process.env.WEBHOOK_BOT_AVATAR || ""; // URL opcional
const EMBED_ONLY = process.env.WEBHOOK_DISCORD_EMBED_ONLY === "true";

// Formatação BRL
function brl(v: number) {
  try {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  } catch {
    return `R$ ${Number(v).toFixed(2)}`;
  }
}

// Monta payload COMPATÍVEL com Discord Webhook
function buildDiscordMessage(p: PayloadVenda) {
  const unit = p.quantidade > 0 ? p.valor / p.quantidade : 0;

  const embeds = [
    {
      title: "Venda",
      color: 0x2ecc71, // verde
      fields: [
        // Nome = quem registrou
        { name: "Nome", value: p.cadastradoPor || "—", inline: false },
        { name: "Quantidade", value: String(p.quantidade), inline: true },
        { name: "Valor total", value: brl(p.valor), inline: true },
        { name: "Preço/un", value: brl(unit), inline: true },
        { name: "UserID", value: p.userId, inline: false },
      ],
      // Se quiser, pode incluir o produto na descrição
      description: p.produto ? `Produto: **${p.produto}**` : undefined,
      timestamp: p.createdAt,
    },
  ];

  const body: any = {
    username: BOT_NAME,
    embeds,
  };

  // Se não estiver em modo "apenas embed", manda também um content curtinho
  if (!EMBED_ONLY) {
    body.content = `🧾 **Nova venda registrada**`;
  }
  if (BOT_AVATAR) body.avatar_url = BOT_AVATAR;

  return body;
}

export async function enviarVendaParaWebhook(payload: PayloadVenda) {
  // Use a URL privada da webhook (definida no .env.local)
  const url = process.env.VENDAS_WEBHOOK_URL;
  if (!url) {
    console.warn("VENDAS_WEBHOOK_URL não definida. Pulando envio de webhook.");
    return { ok: false, skipped: true };
  }

  // Detecta se é Discord; se for, formata; senão, envia payload cru
  const isDiscord =
    url.includes("discord.com/api/webhooks") || process.env.WEBHOOK_FORMAT === "discord";

  const body = isDiscord ? buildDiscordMessage(payload) : payload;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`Falha ao enviar para webhook: ${res.status} ${text}`);
  }

  return { ok: true, status: res.status, body: text || "OK" };
}
