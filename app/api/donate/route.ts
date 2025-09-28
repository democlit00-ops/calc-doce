import { NextResponse } from "next/server";

// Evita cache estático
export const dynamic = "force-dynamic";

export async function GET() {
  const paypalUrl = process.env.DONATE_PAYPAL_URL || "";
  const paypalLabel = process.env.DONATE_PAYPAL_LABEL || "Doação via PayPal";

  const pixPayload = process.env.DONATE_PIX_PAYLOAD || "";
  const pixLabel = process.env.DONATE_PIX_LABEL || "Doação via Pix";
  const pixValue = process.env.DONATE_PIX_VALUE || "";

  const hasPayPal = Boolean(paypalUrl);
  const hasPix = Boolean(pixPayload);

  if (!hasPayPal && !hasPix) {
    return NextResponse.json(
      { error: "NO_METHODS_CONFIGURED" },
      { status: 503, headers: { "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate" } }
    );
  }

  return NextResponse.json(
    {
      paypal: hasPayPal ? { url: paypalUrl, label: paypalLabel } : null,
      pix: hasPix ? { payload: pixPayload, label: pixLabel, value: pixValue } : null,
    },
    { headers: { "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate" } }
  );
}
