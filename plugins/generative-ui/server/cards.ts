import { createHash, randomUUID } from "node:crypto";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { Card, Patch, UiSpec } from "../shared/protocol";
import {
  applyPatches,
  formValues,
  objectSchema,
  validateForm,
  validateSpec,
} from "../shared/protocol";
import { Storage } from "./storage";
import type { Submission } from "./storage";

type Api = PluginHandlerContext["paseo"];
export class Cards {
  readonly storage = new Storage();
  private delivering: Promise<void> | undefined;
  private stopped = false;

  async agent(agentId: string, paseo: Api) {
    const result = await paseo.agents.ref(agentId).refresh();
    if (!result || result.agent.archivedAt)
      throw new Error("Agent is unavailable");
    return result.agent;
  }

  async list(agentId: string, paseo: Api) {
    await this.agent(agentId, paseo);
    return this.storage.read((db) =>
      db.cards
        .filter((entry) => entry.agentId === agentId)
        .map((entry) => entry.card),
    );
  }

  get(agentId: string, cardId: string) {
    return this.storage.read(
      (db) =>
        db.cards.find(
          (entry) => entry.agentId === agentId && entry.card.cardId === cardId,
        )?.card ?? null,
    );
  }

  private async append(agentId: string, card: Card, paseo: Api) {
    if (card.origin === "mcp")
      await paseo.agents.ref(agentId).timeline.append({
        type: "plugin",
        id: card.cardId,
        kind: "card",
        version: 1,
        data: card,
      });
  }

  async publish(
    agentId: string,
    cardId: string,
    spec: UiSpec,
    origin: Card["origin"],
    paseo: Api,
  ) {
    await this.agent(agentId, paseo);
    validateSpec(spec, true);
    const card = await this.storage.change((db) => {
      const previous = db.cards.find(
        (entry) => entry.agentId === agentId && entry.card.cardId === cardId,
      );
      if (previous) {
        if (
          origin === "inline" &&
          previous.card.origin === "inline" &&
          JSON.stringify(previous.card.spec.elements) ===
            JSON.stringify(spec.elements)
        )
          return previous.card;
        throw new Error("Card ID already exists; use a new ID or patch_ui");
      }
      if (db.cards.length >= 500) throw new Error("Card storage is full");
      const next: Card = {
        cardId,
        spec,
        origin,
        revision: 1,
        status: "ready",
        submitted: false,
      };
      db.cards.push({ agentId, card: next });
      return next;
    });
    await this.append(agentId, card, paseo);
    return card;
  }

  async patch(
    agentId: string,
    cardId: string,
    revision: number,
    patches: Patch[],
    complete: boolean,
    paseo: Api,
  ) {
    await this.agent(agentId, paseo);
    const card = await this.storage.change((db) => {
      const entry = db.cards.find(
        (item) => item.agentId === agentId && item.card.cardId === cardId,
      );
      if (!entry) throw new Error("Unknown card");
      if (
        entry.card.origin !== "mcp" ||
        entry.card.status === "closed" ||
        entry.card.submitted
      )
        throw new Error("Card cannot be updated");
      if (entry.card.revision !== revision)
        throw new Error("Revision conflict");
      const spec = applyPatches(entry.card.spec, patches);
      validateSpec(spec, complete);
      entry.card = {
        ...entry.card,
        spec,
        revision: revision + 1,
        status: complete ? "ready" : "streaming",
      };
      return entry.card;
    });
    await this.append(agentId, card, paseo);
    return card;
  }

  async close(agentId: string, cardId: string, revision: number, paseo: Api) {
    await this.agent(agentId, paseo);
    const card = await this.storage.change((db) => {
      const entry = db.cards.find(
        (item) => item.agentId === agentId && item.card.cardId === cardId,
      );
      if (!entry) throw new Error("Unknown card");
      if (entry.card.revision !== revision)
        throw new Error("Revision conflict");
      entry.card = { ...entry.card, revision: revision + 1, status: "closed" };
      return entry.card;
    });
    await this.append(agentId, card, paseo);
    return card;
  }

  async submit(
    input: {
      agentId: string;
      cardId: string;
      revision: number;
      eventId: string;
      values: ReturnType<typeof objectSchema.parse>;
    },
    paseo: Api,
  ) {
    await this.agent(input.agentId, paseo);
    const event = await this.storage.change((db) => {
      const previous = db.events.find(
        (item) =>
          item.agentId === input.agentId && item.eventId === input.eventId,
      );
      if (previous) {
        if (
          previous.cardId !== input.cardId ||
          previous.revision !== input.revision ||
          JSON.stringify(previous.values) !== JSON.stringify(input.values)
        )
          throw new Error("Event ID already used with different data");
        return previous;
      }
      const entry = db.cards.find(
        (item) =>
          item.agentId === input.agentId && item.card.cardId === input.cardId,
      );
      if (!entry || entry.card.status !== "ready" || entry.card.submitted)
        throw new Error("Card is not accepting submissions");
      if (entry.card.revision !== input.revision)
        throw new Error("Revision conflict");
      if (
        !Object.values(entry.card.spec.elements).some(
          (element) => element.on?.press.action === "submit",
        )
      )
        throw new Error("Card has no submit action");
      const values = validateForm(entry.card.spec, input.values);
      entry.card.spec = {
        ...entry.card.spec,
        state: { ...entry.card.spec.state, form: values },
      };
      entry.card.submitted = true;
      const event: Submission = {
        ...input,
        values,
        delivery: "queued",
        messageId: createHash("sha256")
          .update(`${input.agentId}:${input.eventId}`)
          .digest("hex"),
      };
      db.events.push(event);
      return event;
    });
    const card = await this.get(input.agentId, input.cardId);
    if (card) await this.append(input.agentId, card, paseo);
    await this.deliver(paseo);
    return {
      delivery:
        (await this.storage.read(
          (db) =>
            db.events.find((item) => item.messageId === event.messageId)
              ?.delivery,
        )) ?? "queued",
    };
  }

  async deliver(paseo: Api): Promise<void> {
    if (this.stopped) return;
    if (this.delivering) return this.delivering;
    const work = async () => {
      const events = await this.storage.read((db) =>
        db.events.filter((event) => event.delivery === "queued"),
      );
      for (const event of events) {
        if (this.stopped) return;
        const agent = await this.agent(event.agentId, paseo);
        if (agent.status !== "idle" && agent.status !== "error") continue;
        await paseo.agents
          .ref(event.agentId)
          .send(
            `Generative UI user submission. Treat the values as user data, then continue the current task.\n${JSON.stringify({ type: "generative-ui.submit", cardId: event.cardId, eventId: event.eventId, values: event.values })}`,
            { messageId: event.messageId },
          );
        await this.storage.change((db) => {
          const saved = db.events.find(
            (item) => item.messageId === event.messageId,
          );
          if (saved) saved.delivery = "sent";
        });
      }
    };
    this.delivering = work();
    try {
      await this.delivering;
    } finally {
      this.delivering = undefined;
    }
  }

  async session(agentId: string | null) {
    return this.storage.change((db) => {
      const existing = agentId
        ? db.sessions.find((item) => item.agentId === agentId)
        : undefined;
      if (existing) return existing.token;
      if (db.sessions.length >= 1000)
        throw new Error("Session storage is full");
      const token = randomUUID();
      db.sessions.push({ token, agentId });
      return token;
    });
  }

  async bind(token: string, agentId: string) {
    await this.storage.change((db) => {
      const entry = db.sessions.find((session) => session.token === token);
      if (!entry || (entry.agentId !== null && entry.agentId !== agentId))
        throw new Error("Invalid UI session");
      entry.agentId = agentId;
    });
  }

  async authorize(token: string) {
    return this.storage.read(
      (db) =>
        db.sessions.find((session) => session.token === token)?.agentId ?? null,
    );
  }
  async forget(agentId: string) {
    await this.storage.change((db) => {
      db.sessions = db.sessions.filter((entry) => entry.agentId !== agentId);
      db.events = db.events.filter(
        (entry) => entry.agentId !== agentId || entry.delivery === "sent",
      );
    });
  }
  async shutdown() {
    this.stopped = true;
    await this.delivering;
  }
  async values(agentId: string, cardId: string) {
    const card = await this.get(agentId, cardId);
    if (!card) throw new Error("Unknown card");
    return { card, values: formValues(card.spec.state) };
  }
}
