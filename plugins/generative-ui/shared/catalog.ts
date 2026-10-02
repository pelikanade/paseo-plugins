import { defineCatalog, defineSchema } from "@json-render/core";
import { z } from "zod";

const text = z.string().max(8000);
const spacing = z.enum(["sm", "md", "lg"]).optional();
const tone = z.enum(["default", "success", "warning", "danger"]).optional();
export const definitions = {
  Card: {
    props: z.object({ title: text.optional() }).strict(),
    slots: ["default"],
    description: "Group related content in a card.",
  },
  Stack: {
    props: z
      .object({ direction: z.enum(["row", "column"]).optional(), gap: spacing })
      .strict(),
    slots: ["default"],
    description: "Arrange children in a row or column.",
  },
  Text: { props: z.object({ text }).strict(), description: "Body text." },
  Heading: {
    props: z.object({ text }).strict(),
    description: "Section heading.",
  },
  Divider: { props: z.object({}).strict(), description: "Separate sections." },
  Metric: {
    props: z
      .object({
        label: text,
        value: z.union([text, z.number()]),
        detail: text.optional(),
      })
      .strict(),
    description: "Display a labeled metric.",
  },
  Badge: {
    props: z.object({ label: text, tone }).strict(),
    description: "A short status label.",
  },
  Progress: {
    props: z.object({ label: text, value: z.number().min(0).max(1) }).strict(),
    description: "Progress from zero to one.",
  },
  KeyValue: {
    props: z
      .object({ label: text, value: z.union([text, z.number(), z.boolean()]) })
      .strict(),
    description: "A labeled fact.",
  },
  Table: {
    props: z
      .object({
        columns: z.array(text).min(1).max(8),
        rows: z
          .array(
            z.array(z.union([text, z.number(), z.boolean(), z.null()])).max(8),
          )
          .max(100),
      })
      .strict(),
    description: "Small comparison or results table; rows match columns.",
  },
  ChoiceGroup: {
    props: z
      .object({
        label: text,
        value: text,
        options: z
          .array(z.object({ value: text, label: text }).strict())
          .min(1)
          .max(12),
      })
      .strict(),
    description: "Choose one option; bind value with $bindState to /form/name.",
  },
  TextInput: {
    props: z
      .object({
        label: text,
        value: text,
        placeholder: text.optional(),
        required: z.boolean().optional(),
        maxLength: z.number().int().min(1).max(8000).optional(),
      })
      .strict(),
    description: "Text field; bind value with $bindState to /form/name.",
  },
  Checkbox: {
    props: z.object({ label: text, checked: z.boolean() }).strict(),
    description: "Boolean field; bind checked with $bindState to /form/name.",
  },
  Button: {
    props: z
      .object({
        label: text,
        variant: z.enum(["primary", "secondary"]).optional(),
      })
      .strict(),
    description: "Explicit submission using on.press.action submit.",
  },
};

const schema = defineSchema((s) => ({
  spec: s.object({
    root: s.string(),
    elements: s.record(
      s.object({
        type: s.ref("catalog.components"),
        props: s.propsOf("catalog.components"),
        children: s.array(s.string()),
        on: { ...s.any(), ...s.optional() },
        visible: { ...s.any(), ...s.optional() },
      }),
    ),
    state: { ...s.any(), ...s.optional() },
  }),
  catalog: s.object({
    components: s.map({
      props: s.zod(),
      slots: s.array(s.string()),
      description: s.string(),
    }),
    actions: s.map({ params: s.zod(), description: s.string() }),
  }),
}));

export const catalog = defineCatalog(schema, {
  components: definitions,
  actions: {
    submit: {
      params: z.object({}).strict(),
      description:
        "Submit the card's /form object to the same agent after an explicit button press.",
    },
  },
});

export const catalogDescription = {
  protocolVersion: 1,
  catalogVersion: 1,
  components: Object.fromEntries(
    Object.entries(definitions).map(([name, definition]) => [
      name,
      {
        description: definition.description,
        props: z.toJSONSchema(definition.props),
      },
    ]),
  ),
  actions: {
    submit: { params: {}, description: "Submit /form to the owning agent." },
  },
  expressions: ["$state", "$bindState"],
};
