import type Anthropic from "@anthropic-ai/sdk";

export type Lang = "en" | "ar";

/** Evento entrante, ya normalizado e independiente del canal. */
export type Incoming =
  | { id: string; from: string; name?: string; kind: "text"; text: string }
  | { id: string; from: string; name?: string; kind: "reply"; replyId: string }
  | { id: string; from: string; name?: string; kind: "unsupported" };

export type Button = { id: string; title: string };
export type Row = { id: string; title: string; description?: string };

/** Lo único que el núcleo necesita de un canal (WhatsApp, simulador...). */
export interface Channel {
  sendText(to: string, text: string): Promise<void>;
  sendButtons(to: string, body: string, buttons: Button[]): Promise<void>;
  sendList(to: string, body: string, label: string, rows: Row[]): Promise<void>;
  /** Pregunta abierta con recuadro de respuesta (Telegram). Si el canal no lo tiene, se usa sendText. */
  sendPrompt?(to: string, text: string, placeholder: string): Promise<void>;
  /** Tarjeta con foto, texto y botones (opcionales). */
  sendPhoto?(to: string, url: string, caption: string, buttons?: Button[]): Promise<void>;
  /** Pin de ubicación que se abre en el mapa del móvil. */
  sendLocation?(to: string, lat: number, lon: number, title: string): Promise<void>;
}

export type OwnerAlert = { severity: "info" | "high" | "urgent"; text: string };
export type OwnerNotifier = (alert: OwnerAlert) => Promise<void>;

/** Modelo de lenguaje. Se inyecta para poder probar sin llamar a la API. */
export interface Llm {
  create(p: {
    system: string;
    tools: Anthropic.Tool[];
    messages: Anthropic.MessageParam[];
  }): Promise<Anthropic.Message>;
}

export type ProposalKind = "flight" | "hotel" | "transport" | "restaurant" | "activity" | "transfer" | "other";
export type Attrs = Record<string, string | number | boolean>;
