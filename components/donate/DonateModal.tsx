"use client";

import { useEffect, useMemo, useState } from "react";

type DonateData =
  | {
      paypal: { url: string; label: string } | null;
      pix: { payload: string; label: string; value?: string } | null;
    }
  | null;

type TabKey = "paypal" | "pix";

export default function DonateModal() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DonateData>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("paypal");

  // QR Codes
  const [qrPayPal, setQrPayPal] = useState<string>("");
  const [qrPix, setQrPix] = useState<string>("");

  // toasts
  const [copied, setCopied] = useState<string>(""); // "paypal" | "pix" | ""

  // Erros
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Busca segura (sem cache)
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
        // Seleciona aba inicial baseada no que existir
        if (res?.paypal) setActiveTab("paypal");
        else if (res?.pix) setActiveTab("pix");
      })
      .catch((err) => {
        setData(null);
        setErrorMsg(
          String(err) === "NO_METHODS_CONFIGURED"
            ? "Nenhum método de doação configurado. Defina DONATE_PAYPAL_URL e/ou DONATE_PIX_PAYLOAD no ambiente."
            : "Erro ao carregar métodos de doação."
        );
      });
  }, []);

  // Gera QR do PayPal e do Pix via dynamic import (cliente)
  useEffect(() => {
    let cancelled = false;
    async function gen() {
      try {
        const QR = await import("qrcode");

        // PayPal
        if (data?.paypal?.url) {
          const url = await QR.toDataURL(data.paypal.url, {
            errorCorrectionLevel: "M",
            margin: 2,
            scale: 6,
          });
          if (!cancelled) setQrPayPal(url);
        } else {
          if (!cancelled) setQrPayPal("");
        }

        // Pix
        if (data?.pix?.payload) {
          const url = await QR.toDataURL(data.pix.payload, {
            errorCorrectionLevel: "M",
            margin: 2,
            scale: 6,
          });
          if (!cancelled) setQrPix(url);
        } else {
          if (!cancelled) setQrPix("");
        }
      } catch {
        if (!cancelled) {
          setQrPayPal("");
          setQrPix("");
        }
      }
    }
    gen();
    return () => {
      cancelled = true;
    };
  }, [data?.paypal?.url, data?.pix?.payload]);

  // Ações PayPal
  const handleOpenPayPal = () => {
    const url = data?.paypal?.url;
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };
  const handleCopyPayPal = async () => {
    const url = data?.paypal?.url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied("paypal");
      setTimeout(() => setCopied(""), 2000);
    } catch {}
  };
  const handleDownloadPayPalQR = () => {
    if (!qrPayPal) return;
    const a = document.createElement("a");
    a.href = qrPayPal;
    a.download = "paypal-donate-qr.png";
    a.click();
  };

  // Ações Pix
  const handleCopyPix = async () => {
    const payload = data?.pix?.payload;
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
      setCopied("pix");
      setTimeout(() => setCopied(""), 2000);
    } catch {}
  };
  const handleDownloadPixQR = () => {
    if (!qrPix) return;
    const a = document.createElement("a");
    a.href = qrPix;
    a.download = "pix-qrcode.png";
    a.click();
  };

  // Abas disponíveis conforme ENV
  const tabs = useMemo(() => {
    const arr: Array<{ key: TabKey; label: string; enabled: boolean }> = [
      {
        key: "paypal",
        label: data?.paypal?.label || "PayPal",
        enabled: Boolean(data?.paypal),
      },
      {
        key: "pix",
        label: data?.pix?.label || "Pix",
        enabled: Boolean(data?.pix),
      },
    ];
    return arr.filter((t) => t.enabled);
  }, [data?.paypal, data?.pix]);

  return (
    <>
      {/* Botão flutuante global */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-50 rounded-full px-4 py-2 text-sm font-semibold shadow-lg border bg-emerald-600 text-white hover:bg-emerald-700 border-emerald-700"
        aria-label="Abrir doações"
      >
        💖 Doar
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
              <h2 className="text-lg font-semibold">Apoie o projeto</h2>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md border px-2 py-1 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            {/* Fallback geral */}
            {errorMsg ? (
              <div className="mt-4 w-full text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {errorMsg}
              </div>
            ) : (
              <>
                {/* Abas */}
                <div className="mt-4 flex gap-2 border-b">
                  {tabs.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setActiveTab(t.key)}
                      className={`px-3 py-2 text-sm border-b-2 -mb-px ${
                        activeTab === t.key
                          ? "border-emerald-600 text-emerald-700 font-semibold"
                          : "border-transparent text-zinc-500 hover:text-zinc-700"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* Conteúdo da aba */}
                <div className="mt-4 flex flex-col items-center gap-4">
                  {activeTab === "paypal" && data?.paypal && (
                    <>
                      {qrPayPal ? (
                        <img
                          src={qrPayPal}
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
                          onClick={handleCopyPayPal}
                          className="flex-1 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
                        >
                          Copiar link
                        </button>
                        <button
                          onClick={handleDownloadPayPalQR}
                          className="flex-1 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
                        >
                          Baixar QR
                        </button>
                      </div>
                      {copied === "paypal" && (
                        <div className="w-full text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                          Link do PayPal copiado! ✅
                        </div>
                      )}
                    </>
                  )}

                  {activeTab === "pix" && data?.pix && (
                    <>
                      {qrPix ? (
                        <img
                          src={qrPix}
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
                          value={data.pix.payload}
                        />
                        {data.pix.value ? (
                          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                            Valor sugerido: R$ {data.pix.value}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex w-full items-center justify-between gap-3">
                        <button
                          onClick={handleCopyPix}
                          className="flex-1 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
                        >
                          Copiar código
                        </button>
                        <button
                          onClick={handleDownloadPixQR}
                          className="flex-1 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
                        >
                          Baixar QR
                        </button>
                      </div>

                      {copied === "pix" && (
                        <div className="w-full text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
                          Código Pix copiado! ✅
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
