import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { cardIdSchema, cardSchema, objectSchema } from "./protocol";

export const listRpc = defineRpc({
  name: "generative-ui.list",
  input: z.object({ agentId: z.string().min(1) }).strict(),
  output: z.object({ cards: z.array(cardSchema) }),
});
export const cardRpc = defineRpc({
  name: "generative-ui.card",
  input: z
    .object({ agentId: z.string().min(1), cardId: cardIdSchema })
    .strict(),
  output: z.object({ card: cardSchema.nullable() }),
});
export const submitRpc = defineRpc({
  name: "generative-ui.submit",
  input: z
    .object({
      agentId: z.string().min(1),
      cardId: cardIdSchema,
      revision: z.number().int().positive(),
      eventId: z.string().min(1).max(100),
      values: objectSchema,
    })
    .strict(),
  output: z.object({ delivery: z.enum(["queued", "sent"]) }),
});
export const connectionRpc = defineRpc({
  name: "generative-ui.connection",
  input: z.object({ agentId: z.string().min(1) }).strict(),
  output: z.object({ url: z.string(), token: z.string() }),
});
export const guideRpc = defineRpc({
  name: "generative-ui.guide",
  input: z.object({}).strict(),
  output: z.object({ text: z.string() }),
});
