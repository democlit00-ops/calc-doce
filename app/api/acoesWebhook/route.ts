import { NextResponse } from "next/server";

function clamp(str: string, max = 1024) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}
function fmtDate(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return "—";
  }
}
function fmtMoney(val?: number | null) {
  if (typeof val !== "number" || isNaN(val)) return "—";
  return `$ ${Math.trunc(val).toLocaleString("en-US")}`;
}

function buildRegistroAcaoEmbed(payload: any) {
  const {
    docId,
    acao,
    winLose,
    valorGanho,
    horarioISO,
    membros = [],
    registradoPor,
    obs,
    createdAtISO,
  } = payload || {};

  const isWin = winLose === "win";
  const color = isWin ? 0x10b981 /* emerald-500 */ : 0xef4444 /* red-500 */;
  const title = acao || "Ação"; // título sem WIN/LOSE

  const membrosFmt = Array.isArray(membros) && membros.length
    ? membros
        .map((m: any, idx: number) => {
          const tag = idx === 0 ? " (registrador)" : "";
          const hier = m?.hierarquia ? ` — ${m.hierarquia}` : "";
          return `• ${m?.nome ?? "(sem nome)"}${hier}${tag}`;
        })
        .join("\n")
    : "(sem membros)";

  const fields = [
    { name: "Resultado", value: isWin ? "WIN" : "LOSE", inline: true },
    { name: "Valor", value: fmtMoney(valorGanho), inline: true },
    { name: "Horário da ação", value: fmtDate(horarioISO), inline: true },
    {
      name: "Registrado por",
      value:
        registradoPor?.nome
          ? `${registradoPor.nome}${registradoPor?.hierarquia ? ` — ${registradoPor.hierarquia}` : ""}`
          : "—",
      inline: true,
    },
    {
      name: `Membros (${Array.isArray(membros) ? membros.length : 0})`,
      value: clamp(membrosFmt, 1024),
      inline: false,
    },
  ];

  if (obs) {
    fields.push({
      name: "Observações",
      value: clamp(String(obs), 1024),
      inline: false,
    });
  }

  return {
    title,
    color,
    timestamp: createdAtISO || new Date().toISOString(),
    footer: { text: docId ? `ID: ${docId}` : "Registro de Ações" },
    fields,
  };
}

function buildExclusaoAcaoEmbed(payload: any) {
  const {
    docId,
    acao,
    winLose,
    valorGanho,
    horarioISO,
    membros = [],
    registradoPor,
    obs,
    deletedBy,          // opcional: quem excluiu (mandado pela página)
    createdAtISO,
  } = payload || {};

  const color = 0x3B82F6; // azul (tailwind blue-500)
  const title = `${acao || "Ação"} Excluída`;

  const membrosFmt = Array.isArray(membros) && membros.length
    ? membros
        .map((m: any, idx: number) => {
          const tag = idx === 0 ? " (registrador)" : "";
          const hier = m?.hierarquia ? ` — ${m.hierarquia}` : "";
          return `• ${m?.nome ?? "(sem nome)"}${hier}${tag}`;
        })
        .join("\n")
    : "(sem membros)";

  const fields = [
    { name: "Resultado", value: winLose === "win" ? "WIN" : "LOSE", inline: true },
    { name: "Valor", value: fmtMoney(valorGanho), inline: true },
    { name: "Horário da ação", value: fmtDate(horarioISO), inline: true },
    {
      name: "Registrado por",
      value:
        registradoPor?.nome
          ? `${registradoPor.nome}${registradoPor?.hierarquia ? ` — ${registradoPor.hierarquia}` : ""}`
          : "—",
      inline: true,
    },
    {
      name: `Membros (${Array.isArray(membros) ? membros.length : 0})`,
      value: clamp(membrosFmt, 1024),
      inline: false,
    },
  ];

  if (deletedBy?.nome) {
    fields.push({
      name: "Excluída por",
      value: `${deletedBy.nome}${deletedBy?.hierarquia ? ` — ${deletedBy.hierarquia}` : ""}`,
      inline: true,
    });
  }

  if (obs) {
    fields.push({
      name: "Observações",
      value: clamp(String(obs), 1024),
      inline: false,
    });
  }

  return {
    title,
    color,
    timestamp: createdAtISO || new Date().toISOString(),
    footer: { text: docId ? `ID: ${docId}` : "Ação excluída" },
    fields,
  };
}

export async function POST(req: Request) {
  try {
    const payload = await req.json();

    const webhookUrl =
      process.env.ACOES_WEBHOOK_URL ||
      process.env.NEXT_PUBLIC_ACOES_WEBHOOK_URL;

    if (!webhookUrl) {
      console.warn("[acoesWebhook] Nenhuma URL de webhook configurada.");
      return NextResponse.json(
        { ok: false, error: "Webhook URL not configured" },
        { status: 500 }
      );
    }

    // criação
    if (payload?.tipo === "registro_acao") {
      const embed = buildRegistroAcaoEmbed(payload);
      const body = {
        username: "Registros • Ações",
        avatar_url:
          "https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/discord.svg",
        allowed_mentions: { parse: [] },
        embeds: [embed],
      };
      const r = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        console.error("[acoesWebhook] Falha no POST (registro):", r.status, text);
        return NextResponse.json({ ok: false, status: r.status, error: text }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    // exclusão
    if (payload?.tipo === "exclusao_acao") {
      const embed = buildExclusaoAcaoEmbed(payload);
      const body = {
        username: "Registros • Ações",
        avatar_url:
          "https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/discord.svg",
        allowed_mentions: { parse: [] },
        embeds: [embed],
      };
      const r = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        console.error("[acoesWebhook] Falha no POST (exclusao):", r.status, text);
        return NextResponse.json({ ok: false, status: r.status, error: text }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }

    // fallback: repassa como veio
    const r = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      console.error("[acoesWebhook] Falha no POST (fallback):", r.status, text);
      return NextResponse.json({ ok: false, status: r.status, error: text }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[acoesWebhook] Erro:", e?.message || e);
    return NextResponse.json({ ok: false, error: e?.message || "unknown" }, { status: 500 });
  }
}
