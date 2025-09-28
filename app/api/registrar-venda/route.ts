// app/api/registrar-venda/route.ts
import { NextResponse } from "next/server";
import { enviarVendaParaWebhook } from "@/components/webhook/vendasWebhook";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const {
      cadastradoPor,
      userId,
      roleLevel,
      produto,
      quantidade,
      valor,
      createdAt,
    } = body ?? {};

    // Validação leve (igual ao que já usamos em outras pages)
    if (
      !cadastradoPor ||
      !userId ||
      typeof roleLevel !== "number" ||
      !produto ||
      typeof quantidade !== "number" ||
      typeof valor !== "number" ||
      !createdAt
    ) {
      return NextResponse.json(
        { ok: false, error: "Payload inválido" },
        { status: 400 }
      );
    }

    const result = await enviarVendaParaWebhook({
      tipo: "nova_venda",
      cadastradoPor,
      userId,
      roleLevel,
      produto,
      quantidade,
      valor,
      createdAt,
    });

    return NextResponse.json({ ok: true, webhook: result }, { status: 200 });
  } catch (err: any) {
    console.error("Erro em /api/registrar-venda:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Erro interno" },
      { status: 500 }
    );
  }
}
