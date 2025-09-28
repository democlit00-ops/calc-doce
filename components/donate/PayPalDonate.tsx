"use client";

import { useEffect, useState } from "react";

type DonateData = {
  paypalUrl: string;
  label?: string;
  error?: string;
};

export default function PayPalDonate() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DonateData | null>(null);
  const [qrUrl, setQrUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Busca segura no cliente
  useEffect(() => {
    fetch("/api/donate", { cache: "no-store" })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw json?.error || "DONATE_FETCH_ERROR";
        return json as DonateData;
      })
      .then((res) => {
        setData(res);
        setErrorMsg("");
      })
      .catch((err) => {
        setData({ paypalUrl: "", label: "Doação via PayPal", error: String(err) });
        setErrorMsg("PayPal não configurado. Defina DONATE_PAYPAL_URL no ambiente.");
      });
  }, []);

  // Gera QR do link PayPal (dynamic import só no client)
  useEffect(() => {
    let cancelled = false;
    async function gen() {
      try {
        if (!data?.paypalUrl) return;
        const QR = await import("qrcode");
        const url = await QR.toDataURL(data.paypalUrl, {
          errorCorrectionLevel: "M",
          margin: 2,
          scale: 6,
        });
        if (!cancelled) setQrUrl(url);
      } catch {
        if (!cancelled) setQrUrl("");
      }
    }
    gen();
    return () => { cancelled = true; };
  }, [data?.paypalUrl]);

  const label = data?.label || "Doação via PayPal";

  const handleCopyLink = async () => {
    if (!data?.paypalUrl) return;
    try {
      await navigator.clipboard.writeText(data.paypalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silencioso
    }
  };

  const handleDownloadQR = () => {
    if (!qrUrl) return;
    const a = document.createElement("a");
    a.href = qrUrl;
    a.download = "paypal-donate-qr.png";
    a.click();
  };

  const handleOpenPayPal = () => {
    if (!data?.paypalUrl) return;
    window.open(data.paypalUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      {/* Botão flutuante em TODAS as páginas */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 rounded-full px-4 py-2 text-sm font-semibold shadow-lg border bg-emerald-600 text-white hover:bg-emerald-700 border-emerald-700"
        aria-label="Abrir doação PayPal"
      >
        💖 Doar via PayPal
      </button>

      {/* Modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-lg font-semibold">{label}</h2>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md border px-2 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 flex flex-col items-center gap-4">
              {/* Fallback quando não tiver ENV */}
              {!data?.paypalUrl ? (
                <div className="w-full text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                  {errorMsg || "PayPal não configurado."}
                </div>
              ) : (
                <>
                  {/* QR do link PayPal */}
                  {qrUrl ? (
                    <img
                      src={qrUrl}
                      alt="QR Code PayPal"
                      className="w-56 h-56 rounded-lg border bg-white"
                    />
                  ) : (
                    <div className="w-56 h-56 grid place-items-center rounded-lg border">
                      <span className="text-sm text-zinc-500">Gerando QR…</span>
                    </div>
                  )}

                  <div className="flex w-full items-center justify-between gap-3">
                    <button
                      onClick={handleOpenPayPal}
                      className="flex-1 rounded-lg border px-3 py-2 text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 border-emerald-700"
                    >
                      Abrir PayPal
                    </button>
                    <button
                      onClick={handleCopyLink}
                      className="flex-1 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    >
                      Copiar link
                    </button>
                    <button
                      onClick={handleDownloadQR}
                      className="flex-1 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    >
                      Baixar QR
                    </button>
                  </div>

                  {/* Toast simples (UX melhor que alert) */}
                  {copied && (
                    <div className="w-full text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                      Link do PayPal copiado! ✅
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
