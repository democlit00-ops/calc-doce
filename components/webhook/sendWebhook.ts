// components/webhook/sendWebhook.ts

/**
 * Tipos compartilhados
 */
type MembroMin = {
  uid: string;
  nome: string;
  hierarquia?: string; // ex.: "adminGeral" | "admin" | "gerenteAcoes" | ...
};

type RegistradoPorMin = {
  uid: string;
  nome: string;
  hierarquia?: string;
};

/**
 * Payload para CRIAÇÃO de ação
 */
export type RegistroAcaoPayload = {
  tipo: "registro_acao";
  acao: string;
  winLose: "win" | "lose";
  valorGanho: number | null;
  horarioISO: string | null;      // ISO string do horário da ação
  membros: MembroMin[];           // lista completa (registrador como primeiro)
  registradoPor: RegistradoPorMin;// redundante com membros[0], mas útil pro embed
  obs?: string | null;
  createdAtISO?: string;          // ISO do momento do registro
  docId?: string;                 // opcional: id do doc criado (se você passar depois)
};

/**
 * Payload para EXCLUSÃO de ação
 */
export type ExclusaoAcaoPayload = {
  tipo: "exclusao_acao";
  acao: string;
  winLose: "win" | "lose";
  valorGanho: number | null;
  horarioISO: string | null;
  membros: MembroMin[];
  registradoPor?: RegistradoPorMin;
  obs?: string | null;

  // Quem excluiu (opcional, mas recomendado)
  deletedBy?: {
    uid: string;
    nome: string;
    hierarquia?: string;
  };

  createdAtISO?: string;
  docId?: string;
};

/**
 * Discriminated union aceitando AMBOS os tipos de payload
 */
export type AcoesWebhookPayload = RegistroAcaoPayload | ExclusaoAcaoPayload;

/**
 * Envia o payload para a rota interna `/api/acoesWebhook`,
 * que por sua vez publica no Discord.
 */
export async function sendAcoesWebhook(payload: AcoesWebhookPayload): Promise<void> {
  try {
    const res = await fetch("/api/acoesWebhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      // Loga o erro no console para facilitar debug
      const text = await res.text().catch(() => "");
      console.error("[sendAcoesWebhook] Falha ao enviar:", res.status, text);
    }
  } catch (e) {
    console.error("[sendAcoesWebhook] Erro de rede:", e);
  }
}
