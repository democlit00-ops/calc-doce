"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";

type DonateData = {
  pixPayload: string;
  pixLabel?: string;
  value?: string;
};

export default function PixDonate() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DonateData | null>(null);
  const [qrUrl, setQrUrl] = useState<string>("");

  useEffect(() => {
    fetch("/api/donate")
      .then((r) => r.json())
      .then((res: DonateData) => setData(res))
      .catch(() => setData({ pixPayload: "", pixLabel: "Doação via Pix" }));
  }, []);

  useEffect(() => {
    if (!data?.pixPayload) return;
    QRCode.toDataURL(data.pixPayload, {
      errorCorrectionLevel: "M",
      margin: 2,
      scale: 6,
    })
      .then(setQrUrl)
      .catch(() => setQrUrl(""));
  }, [data?.pixPayload]);

  const handleCopy = async () => {
    if (!data?.pixPayload) return;
    await navigator.clipboard.writeText(data.pixPayload);
    alert("Código Pix (copia e cola) copiado!");
  };

  const handleDownload = () => {
    if (!qrUrl) return;
    const a = document.createElement("a");
    a.href = qrUrl;
    a.download = "pix-qrcode.png";
    a.click();
  };

  const label = data?.pixLabel || "Doação via Pix";

  return (
    <>
      {/* Botão flutuante em TODAS as páginas */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 rounded-full px-4 py-2 text-sm font-semibold shadow-lg border bg-emerald-600 text-white hover:bg-emerald-700 border-emerald-700"
        aria-label="Abrir doação Pix"
      >
        💖 Doar via Pix
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
              <div>
                <h2 className="text-lg font-semibold">{label}</h2>
                {data?.value ? (
                  <p className="text-sm text-zinc-600 dark:text-zinc-300">
                    Valor sugerido: R$ {data.value}
                  </p>
                ) : null}
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md border px-2 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 flex flex-col items-center gap-4">
              {qrUrl ? (
                <img
                  src={qrUrl}
                  alt="QR Code Pix"
                  className="w-56 h-56 rounded-lg border bg-white"
                />
              ) : (
                <div className="w-56 h-56 grid place-items-center rounded-lg border">
                  <span className="text-sm text-zinc-500">Gerando QR…</span>
                </div>
              )}

              <div className="w-full">
                <label className="block text-xs mb-1 text-zinc-500">
                  Pix copia e cola:
                </label>
                <textarea
                  className="w-full text-xs rounded-lg border bg-zinc-50 dark:bg-zinc-800 p-2 font-mono"
                  rows={4}
                  readOnly
                  value={data?.pixPayload || ""}
                />
              </div>

              <div className="flex w-full items-center justify-between gap-3">
                <button
                  onClick={handleCopy}
                  className="flex-1 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  Copiar código
                </button>
                <button
                  onClick={handleDownload}
                  className="flex-1 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  Baixar QR
                </button>
              </div>

              <p className="text-[11px] text-zinc-500 text-center">
                Pague pelo app do seu banco: opção Pix &rarr; “Pagar com QR” ou
                “Pix copia e cola”.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
