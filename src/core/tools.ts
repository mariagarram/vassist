import type Anthropic from "@anthropic-ai/sdk";
import type { TravelProvider } from "./providers";
import type { Store } from "./store";
import type { Attrs, OwnerNotifier, ProposalKind } from "./types";

/** Cosas que el handler debe enviar al cliente después de la respuesta del modelo. */
export type OutboxItem = { type: "approval"; proposalId: string } | { type: "plan_complete"; planId: string };

export type ToolCtx = {
  store: Store;
  providers: TravelProvider;
  userId: string;
  userName: string | null;
  notifyOwner: OwnerNotifier;
  outbox: OutboxItem[];
};

const KINDS: ProposalKind[] = ["flight", "hotel", "restaurant", "transfer", "other"];
const ATTR_KEYS = ["airline", "stops", "refundable", "stars", "city", "starts_at", "ends_at", "checkin_url", "online_checkin", "digital_key"] as const;
const DATE_ATTRS = ["starts_at", "ends_at"];

/** Herramientas del modelo. Ninguna reserva ni cobra: solo proponen. */
export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "search_flights",
    description: "Search flights between two airports (IATA codes) on a date. Returns options with price, times, stops and whether refundable.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Origin IATA code, e.g. RUH" },
        to: { type: "string", description: "Destination IATA code, e.g. LHR" },
        date: { type: "string", description: "Departure date YYYY-MM-DD" },
      },
      required: ["from", "to", "date"],
    },
  },
  {
    name: "search_hotels",
    description: "Search hotels in a city for given dates.",
    input_schema: {
      type: "object",
      properties: {
        city: { type: "string" },
        check_in: { type: "string", description: "YYYY-MM-DD" },
        check_out: { type: "string", description: "YYYY-MM-DD" },
        min_stars: { type: "number" },
        online_checkin_only: { type: "boolean", description: "Only hotels with online check-in. Use it when the client prefers to skip the front desk." },
      },
      required: ["city", "check_in", "check_out"],
    },
  },
  {
    name: "get_preferences",
    description: "Read the client's saved preferences (airlines, seat, hotel stars, diet...). Call this before proposing anything.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "save_preferences",
    description: "Save preferences the client has explicitly stated in this conversation. Never save guesses or patterns you inferred.",
    input_schema: {
      type: "object",
      properties: {
        home_airport: { type: "string" },
        preferred_airlines: { type: "array", items: { type: "string" } },
        avoid_airlines: { type: "array", items: { type: "string" } },
        seat: { type: "string", enum: ["aisle", "window", "any"] },
        direct_only: { type: "boolean" },
        hotel_min_stars: { type: "number" },
        require_online_checkin: { type: "boolean" },
        diet: { type: "string" },
        notes: { type: "string" },
      },
    },
  },
  {
    name: "create_proposal",
    description:
      "Create a proposal for ONE chosen option (a flight, a hotel, a restaurant...). The client receives Approve/Reject buttons. This does NOT book or charge anything. Use it only after the client has chosen an option. Always fill attrs from the option's data.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: KINDS },
        title: { type: "string", description: "Short summary, e.g. 'Flight RUH to LHR, 12 Nov, Saudia'" },
        details: { type: "string", description: "Relevant details: times, conditions, cancellation policy" },
        amount_eur: { type: "number", description: "Total amount in euros" },
        plan_title: { type: "string", description: "Name of the whole trip (used for the first proposal of a plan), e.g. 'London, 12-15 Nov'" },
        attrs: {
          type: "object",
          description: "Facts about the option, used to learn preferences from ratings. Only these keys.",
          properties: {
            airline: { type: "string" },
            stops: { type: "number" },
            refundable: { type: "boolean" },
            stars: { type: "number" },
            city: { type: "string" },
            starts_at: { type: "string", description: "Flight departure or hotel check-in, ISO 8601 WITH UTC offset, e.g. 2026-11-12T14:00:00+03:00. Required for reminders." },
            ends_at: { type: "string", description: "Hotel check-out, ISO 8601 with UTC offset." },
            checkin_url: { type: "string", description: "Official online check-in or pre-registration link, only if known. Never invent one." },
            online_checkin: { type: "boolean", description: "The hotel offers online check-in." },
            digital_key: { type: "boolean", description: "The hotel offers a digital key on the phone." },
          },
        },
      },
      required: ["kind", "title", "details", "amount_eur"],
    },
  },
  {
    name: "list_proposals",
    description: "List the client's recent proposals and bookings (including those created from the menu), with status and confirmation. Use it when the client refers to something already chosen, e.g. to change a hotel.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "complete_plan",
    description:
      "Call when every part of the trip has been proposed and the client has nothing more to add. The client will then be asked to rate the plan once all pending approvals are decided.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "report_incident",
    description:
      "Alert the human owner when something needs attention: a provider failure, a disruption (cancelled or delayed flight), an urgent request, a complaint, or anything you cannot resolve. Use severity 'urgent' for time-critical matters.",
    input_schema: {
      type: "object",
      properties: {
        severity: { type: "string", enum: ["info", "high", "urgent"] },
        summary: { type: "string", description: "What happened and what the client needs, in one or two sentences" },
      },
      required: ["severity", "summary"],
    },
  },
];

type Input = Record<string, unknown>;

function cleanAttrs(raw: unknown): Attrs {
  const out: Attrs = {};
  if (raw && typeof raw === "object") {
    for (const k of ATTR_KEYS) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
      if (DATE_ATTRS.includes(k) && Number.isNaN(Date.parse(String(v)))) continue;
      if (k === "checkin_url" && !/^https:\/\//i.test(String(v))) continue;
      out[k] = v;
    }
  }
  return out;
}

export async function runTool(name: string, input: Input, ctx: ToolCtx): Promise<string> {
  try {
    switch (name) {
      case "search_flights":
        return JSON.stringify(await ctx.providers.searchFlights({ from: String(input.from), to: String(input.to), date: String(input.date) }));

      case "search_hotels":
        return JSON.stringify(
          await ctx.providers.searchHotels({
            city: String(input.city),
            checkIn: String(input.check_in),
            checkOut: String(input.check_out),
            minStars: input.min_stars ? Number(input.min_stars) : undefined,
            onlineCheckinOnly: input.online_checkin_only === true,
          }),
        );

      case "get_preferences":
        return JSON.stringify(ctx.store.getPrefs(ctx.userId));

      case "save_preferences": {
        const allowed = ["home_airport", "preferred_airlines", "avoid_airlines", "seat", "direct_only", "hotel_min_stars", "require_online_checkin", "diet", "notes"];
        for (const [k, v] of Object.entries(input)) if (allowed.includes(k)) ctx.store.setPref(ctx.userId, k, v);
        return JSON.stringify(ctx.store.getPrefs(ctx.userId));
      }

      case "create_proposal": {
        const kind = input.kind as ProposalKind;
        const amount = Number(input.amount_eur);
        const title = String(input.title ?? "").trim();
        if (!KINDS.includes(kind)) return JSON.stringify({ error: "invalid kind" });
        if (!title || !Number.isFinite(amount) || amount < 0) return JSON.stringify({ error: "title and a non-negative amount_eur are required" });
        const plan = ctx.store.openPlan(ctx.userId) ?? ctx.store.createPlan(ctx.userId, String(input.plan_title ?? title).trim() || title);
        const proposal = ctx.store.createProposal({
          planId: plan.id,
          userId: ctx.userId,
          kind,
          title,
          details: String(input.details ?? ""),
          amountEur: amount,
          attrs: cleanAttrs(input.attrs),
        });
        ctx.outbox.push({ type: "approval", proposalId: proposal.id });
        return JSON.stringify({ ok: true, proposalId: proposal.id, status: "pending", note: "The client will get Approve/Reject buttons. Nothing is booked or charged." });
      }

      case "list_proposals":
        return JSON.stringify(
          ctx.store.listProposals(ctx.userId).map((p) => ({ id: p.id, kind: p.kind, title: p.title, details: p.details, amountEur: p.amountEur, status: p.status, confirmed: p.confirmed, attrs: p.attrs })),
        );

      case "complete_plan": {
        const plan = ctx.store.openPlan(ctx.userId);
        if (!plan) return JSON.stringify({ error: "there is no open plan" });
        ctx.store.setPlanStatus(plan.id, "closing");
        ctx.outbox.push({ type: "plan_complete", planId: plan.id });
        return JSON.stringify({ ok: true, pendingApprovals: ctx.store.pendingCount(plan.id) });
      }

      case "report_incident": {
        const severity = ["info", "high", "urgent"].includes(String(input.severity)) ? (String(input.severity) as "info" | "high" | "urgent") : "high";
        const summary = String(input.summary ?? "").trim() || "(no summary)";
        const incident = ctx.store.addIncident(ctx.userId, severity, summary);
        if (severity !== "info") {
          try {
            await ctx.notifyOwner({ severity, text: `Incidencia ${severity === "urgent" ? "URGENTE " : ""}de ${ctx.userName ?? ctx.userId}: ${summary}` });
            ctx.store.markIncidentNotified(incident.id);
          } catch (err) {
            console.error("[vassist] no se pudo avisar a la propietaria:", err);
          }
        }
        return JSON.stringify({ ok: true, note: "The owner has been alerted. Tell the client the team is on it." });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}
