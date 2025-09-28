// app/api/notify/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

type RegistroPayload = {
  id: string;
  depositoId?: string | null;
  pastaNumero?: string | number | null;

  criadoPorNome?: string | null;
  produtoId?: string | null;
  produtoNome?: string | null;
  quantidade?: number;
  efedrina?: number;
  poAluminio?: number;
  embalagemPlastica?: number;
  folhasPapel?: number;
  valorDinheiro?: number;
  observacao?: string | null;

  imagemUrl?: string | null;
  imagemExpiresAt?: string | null;

  status?: string;
  flagMetaPaga?: boolean;
  flagFabricado?: boolean;
  flagConfirmado?: boolean;
  flagRecusado?: boolean;
  confirmado?: boolean;

  // auditoria de status (mantidos, mas não exibimos "Por:")
  lastStatusByNome?: string | null;
  statusLastUpdatedByNome?: string | null;
  lastStatusAt?: any;
  statusLastUpdatedAt?: any;

  criadoEm?: any;
};

function isHttpUrl(v: unknown): v is string {
  return typeof v === 'string' && /^https?:\/\//i.test(v.trim());
}
function mask(url: string | null): string {
  if (!url) return 'missing';
  try {
    const u = new URL(url);
    const tail = u.pathname.split('/').pop() || '';
    return `${u.host}/…/${tail.slice(0, 8)}…`;
  } catch { return 'invalid'; }
}
function asDateStringBR(ts: any): string | null {
  try {
    if ((ts as any)?.toDate) return (ts as any).toDate().toLocaleString('pt-BR');
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d.toLocaleString('pt-BR');
  } catch {}
  return null;
}
function activeStatusLabels(r: RegistroPayload): string[] {
  const labels: string[] = [];
  if (r.flagMetaPaga) labels.push('Meta paga');
  if (r.flagFabricado) labels.push('Fabricado');
  if (r.flagConfirmado || r.confirmado) labels.push('Confirmado');
  if (r.flagRecusado) labels.push('Recusado');
  if (labels.length === 0) labels.push('Pendente');
  return labels;
}
function decideColor(r: RegistroPayload): number {
  const rec = !!r.flagRecusado;
  const conf = !!(r.flagConfirmado || r.confirmado);
  const fab = !!r.flagFabricado;
  if (rec) return 0xEF4444;         // red
  if (conf && fab) return 0x3B82F6; // blue
  if (conf) return 0x10B981;        // green
  return 0xF59E0B;                  // amber
}

/** baixa um arquivo binário de uma URL http(s) para anexar no webhook */
async function fetchBinary(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch image ${r.status}`);
  const ct = r.headers.get('content-type') || '';
  const buf = Buffer.from(await r.arrayBuffer());
  return { buf, contentType: ct };
}

/** envia embed somente-JSON (sem arquivo) */
async function postDiscordJson(url: string, payload: any) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await r.text().catch(() => '');
  return { ok: r.ok, status: r.status, text: text?.slice(0, 300) ?? '' };
}

/** envia embed + arquivo via multipart (usa attachment://) */
async function postDiscordMultipart(url: string, payload: any, fileBuf: Buffer, filename: string, contentType?: string) {
  // @ts-ignore - FormData nativa do runtime nodejs (Next 14+) suporta append(Buffer, filename, {contentType})
  const form = new FormData();
  form.append('payload_json', JSON.stringify(payload));
  // @ts-ignore
  form.append('files[0]', new Blob([fileBuf], { type: contentType || 'application/octet-stream' }), filename);
  const r = await fetch(url, { method: 'POST', body: form as any });
  const text = await r.text().catch(() => '');
  return { ok: r.ok, status: r.status, text: text?.slice(0, 300) ?? '' };
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const debugMode = url.searchParams.get('debug') === '1';

  try {
    const body = await req.json().catch(() => ({}));
    const uid: string | undefined = body?.uid;
    const registro: RegistroPayload | undefined = body?.registro;
    // vem do front: users/{uid}.pasta (URL)
    const userWebhookOverride: unknown = body?.userWebhookOverride;

    if (!uid || !registro?.id) {
      return NextResponse.json({ ok: false, error: 'Campos obrigatórios: uid e registro.id' }, { status: 400 });
    }

    const userWebhook = isHttpUrl(userWebhookOverride) ? String(userWebhookOverride).trim() : null;
    const webhookBau = process.env.WEBHOOK_BAU || null;
    const embedOnly = String(process.env.WEBHOOK_DISCORD_EMBED_ONLY ?? 'true').toLowerCase() !== 'false';

    // ===== monta embed =====
    const statusAtivos = activeStatusLabels(registro).join(', ');
    const color = decideColor(registro);
    const criadoEmStr = asDateStringBR(registro.criadoEm) ?? 'Hoje';
    const idCurto = registro.depositoId || registro.id.slice(-6);
    const pastaStr = registro.pastaNumero != null ? String(registro.pastaNumero) : '—';

    // 🔻 descrição sem "Por:"
    const descLines: string[] = [
      `**Status:** ${statusAtivos}`,
    ];
    if (registro.observacao) descLines.push(`**Obs:** ${registro.observacao}`);

    const fields = [
      { name: 'Efedrina', value: String(registro.efedrina ?? 0), inline: true },
      { name: 'Pó de alumínio', value: String(registro.poAluminio ?? 0), inline: true },
      { name: 'Folhas de papel', value: String(registro.folhasPapel ?? 0), inline: true },
      { name: 'Embalagem plástica', value: String(registro.embalagemPlastica ?? 0), inline: true },
      { name: registro.produtoNome ?? 'Meta (unid.)', value: String(registro.quantidade ?? 0), inline: true },
      { name: 'Dinheiro', value: (registro.valorDinheiro ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), inline: true },
    ].filter(f => f.value !== '0' && f.value !== 'R$\u00A00,00');

    // monta objeto do embed
    const baseEmbed: any = {
      title: `Registro de Depósito — ${registro.criadoPorNome ?? 'Usuário'} ${pastaStr}`,
      description: descLines.join('\n'),
      color,
      fields,
      footer: { text: `ID: ${idCurto} • UID: ${uid} • ${criadoEmStr}` },
    };

    // se conseguirmos baixar o comprovante, vamos anexar como arquivo
    const imageUrl = isHttpUrl(registro.imagemUrl) ? registro.imagemUrl!.trim() : null;

    // destinos
    const targets = [userWebhook, webhookBau].filter(Boolean) as string[];

    if (debugMode) {
      return NextResponse.json({
        ok: true,
        debug: {
          note: 'debug=1: não enviou; mostra alvos e se tentaria anexar imagem.',
          hasImagemUrl: !!imageUrl,
        },
        targets: { userWebhook: mask(userWebhook), webhookBau: mask(webhookBau) },
        embedPreview: {
          title: baseEmbed.title,
          description: baseEmbed.description,
        },
      });
    }

    if (targets.length === 0) {
      return NextResponse.json({
        ok: false,
        error: 'Sem destinos: envie userWebhookOverride (users/{uid}.pasta) ou defina WEBHOOK_BAU no .env.',
        targets: { userWebhook: mask(userWebhook), webhookBau: mask(webhookBau) },
      }, { status: 400 });
    }

    // payload JSON comum (sem arquivo)
    const jsonPayload: any = { embeds: [baseEmbed], username: 'Registro Baú' };
    if (!embedOnly) jsonPayload.content = `Novo evento de depósito (${statusAtivos})`;

    // tenta baixar imagem (se tiver) para anexar
    let attachBuf: Buffer | null = null;
    let attachName = 'comprovante';
    let contentType = 'application/octet-stream';
    if (imageUrl) {
      try {
        const { buf, contentType: ct } = await fetchBinary(imageUrl);
        attachBuf = buf;
        contentType = ct || contentType;
        // deduz extensão pelo content-type
        if (/png/i.test(contentType)) attachName += '.png';
        else if (/jpe?g/i.test(contentType)) attachName += '.jpg';
        else if (/webp/i.test(contentType)) attachName += '.webp';
        else if (/gif/i.test(contentType)) attachName += '.gif';
      } catch {
        // se falhar o download, usa URL no embed (se pública o Discord tenta buscar)
        baseEmbed.image = { url: imageUrl };
        baseEmbed.thumbnail = { url: imageUrl };
      }
    }

    // envia para cada destino
    const results = await Promise.allSettled(
      targets.map(async (hook) => {
        // se temos arquivo, usa multipart + attachment://
        if (attachBuf) {
          const embedWithAttachment = {
            ...baseEmbed,
            image: { url: `attachment://${attachName}` },
          };
          const payload = { embeds: [embedWithAttachment], username: 'Registro Baú' };
          if (!embedOnly) (payload as any).content = `Novo evento de depósito (${statusAtivos})`;
          return postDiscordMultipart(hook, payload, attachBuf!, attachName, contentType);
        }
        // senão, vai JSON puro (com image url se setado acima)
        return postDiscordJson(hook, jsonPayload);
      })
    );

    const sentTo = results.map((r) => r.status === 'fulfilled' ? r.value : { ok: false, error: 'rejected' });
    const anyOk = sentTo.some((r: any) => r?.ok);

    return NextResponse.json({
      ok: anyOk,
      targets: { userWebhook: mask(userWebhook), webhookBau: mask(webhookBau) },
      sent: sentTo,
    }, { status: anyOk ? 200 : 502 });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
