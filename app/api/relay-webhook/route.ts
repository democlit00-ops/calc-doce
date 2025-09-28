import { NextResponse } from 'next/server';

type WebhookBody = {
  tipo?: string;
  depositoId?: string;
  criadoPorUid?: string | null;
  criadoPorNome?: string | null;
  produto?: { id?: string | null; nome?: string | null; imagemUrl?: string | null };
  quantidade?: number;
  insumos?: {
    efedrina?: number;
    poAluminio?: number;
    embalagemPlastica?: number;
    folhasPapel?: number;
    valorDinheiro?: number;
  };
  observacao?: string;
  comprovanteUrl?: string | null;
  criadoEmISO?: string;
};

function isDiscordUrl(url: string) {
  // cobre discord.com e discordapp.com
  return /https?:\/\/(ptb\.|canary\.)?discord(app)?\.com\/api\/webhooks\//i.test(url);
}

function toDiscordEmbed(body: WebhookBody) {
  const {
    tipo = 'deposito_bau',
    depositoId,
    criadoPorNome,
    produto,
    quantidade,
    insumos = {},
    observacao,
    comprovanteUrl,
    criadoEmISO,
  } = body;

  const fields = [
    { name: 'Produto', value: produto?.nome || '—', inline: true },
    { name: 'Quantidade', value: String(quantidade ?? 0), inline: true },
  ];

  const money = (n?: number) =>
    typeof n === 'number' && !isNaN(n) ? n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—';

  const maybePush = (name: string, val?: number) => {
    if (typeof val === 'number' && val > 0) fields.push({ name, value: String(val), inline: true });
  };

  maybePush('Efedrina', insumos.efedrina);
  maybePush('Pó de alumínio', insumos.poAluminio);
  maybePush('Embalagem plástica', insumos.embalagemPlastica);
  maybePush('Folhas de papel', insumos.folhasPapel);

  if (typeof insumos.valorDinheiro === 'number' && insumos.valorDinheiro > 0) {
    fields.push({ name: 'Valor em dinheiro', value: money(insumos.valorDinheiro), inline: true });
  }

  const embed: any = {
    title: '📦 Novo depósito no Baú',
    description: observacao ? `**Obs:** ${observacao}` : undefined,
    color: 0x2b6cb0, // azul discreto
    timestamp: criadoEmISO || new Date().toISOString(),
    footer: { text: `${tipo}${depositoId ? ` • ID: ${depositoId}` : ''}` },
    author: criadoPorNome ? { name: criadoPorNome } : undefined,
    fields,
    thumbnail: produto?.imagemUrl ? { url: produto.imagemUrl } : undefined,
    image: comprovanteUrl ? { url: comprovanteUrl } : undefined,
  };

  return { embeds: [embed] };
}

export async function POST(req: Request) {
  try {
    const { url, body } = (await req.json()) as { url?: string; body?: WebhookBody };

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ ok: false, error: 'Missing webhook url' }, { status: 400 });
    }
    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json({ ok: false, error: 'Invalid webhook url' }, { status: 400 });
    }

    // Se for Discord, formata como embed; caso contrário, envia JSON cru
    const isDiscord = isDiscordUrl(url);
    const payload = isDiscord ? toDiscordEmbed(body || {}) : (body ?? {});

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': isDiscord ? 'application/json' : 'application/json' },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();
    return NextResponse.json({ ok: resp.ok, status: resp.status, body: text });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Relay failed' }, { status: 500 });
  }
}
