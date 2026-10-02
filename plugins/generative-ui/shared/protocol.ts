import { resolveElementProps, getByPath } from "@json-render/core";
import { z } from "zod";
import { definitions } from "./catalog";

export const maxBytes = 60000;
const forbidden = new Set(["__proto__", "prototype", "constructor"]);
export const safeKey = z
  .string()
  .min(1)
  .max(80)
  .refine((key) => !forbidden.has(key));
export const cardIdSchema = z
  .string()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
export const jsonSchema = z.json().superRefine((value, ctx) => {
  let count = 0;
  const walk = (
    node: z.infer<ReturnType<typeof z.json>>,
    depth: number,
  ): void => {
    if (++count > 10000 || depth > 20) {
      ctx.addIssue({
        code: "custom",
        message: "JSON exceeds complexity limit",
      });
      return;
    }
    if (Array.isArray(node)) {
      if (node.length > 200)
        ctx.addIssue({ code: "custom", message: "Array exceeds 200 items" });
      for (const item of node) walk(item, depth + 1);
    } else if (node !== null && typeof node === "object")
      for (const [key, item] of Object.entries(node)) {
        if (forbidden.has(key))
          ctx.addIssue({ code: "custom", message: "Unsafe object key" });
        walk(item, depth + 1);
      }
  };
  walk(value, 0);
});
export const objectSchema = z.record(safeKey, jsonSchema);
export const actionSchema = z
  .object({
    action: z.literal("submit"),
    params: z.object({}).strict().optional(),
  })
  .strict();
export const elementSchema = z
  .object({
    type: z.enum([
      "Card",
      "Stack",
      "Text",
      "Heading",
      "Divider",
      "Metric",
      "Badge",
      "Progress",
      "KeyValue",
      "Table",
      "ChoiceGroup",
      "TextInput",
      "Checkbox",
      "Button",
    ]),
    props: objectSchema,
    children: z.array(safeKey).max(100),
    on: z.object({ press: actionSchema }).strict().optional(),
    visible: z
      .object({ $state: z.string(), eq: jsonSchema.optional() })
      .strict()
      .optional(),
  })
  .strict();
export const specSchema = z
  .object({
    root: safeKey.nullable(),
    elements: z.record(safeKey, elementSchema),
    state: objectSchema,
  })
  .strict();
export type UiSpec = z.infer<typeof specSchema>;
export const headerSchema = z
  .object({ cardId: cardIdSchema, catalogVersion: z.literal(1) })
  .strict();
export const patchSchema = z
  .object({
    op: z.enum(["add", "replace", "remove"]),
    path: z.string().max(300),
    value: jsonSchema.optional(),
  })
  .strict()
  .superRefine((patch, ctx) => {
    if (patch.op !== "remove" && patch.value === undefined)
      ctx.addIssue({ code: "custom", message: "Patch value is required" });
  });
export type Patch = z.infer<typeof patchSchema>;
export const cardSchema = z
  .object({
    cardId: cardIdSchema,
    revision: z.number().int().positive(),
    status: z.enum(["streaming", "ready", "closed"]),
    origin: z.enum(["mcp", "inline"]),
    spec: specSchema,
    submitted: z.boolean(),
  })
  .strict();
export type Card = z.infer<typeof cardSchema>;

export function emptySpec(): UiSpec {
  return { root: null, elements: {}, state: {} };
}
export function pointer(path: string): string[] {
  if (!path.startsWith("/") || /~(?![01])/.test(path))
    throw new Error("Invalid JSON Pointer");
  const parts = path
    .slice(1)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  if (parts.some((part) => forbidden.has(part) || part.length === 0))
    throw new Error("Unsafe JSON Pointer");
  return parts;
}

function mutate(
  node: z.infer<typeof jsonSchema>,
  parts: string[],
  patch: Patch,
): void {
  const key = parts[0];
  if (parts.length === 0 || node === null || typeof node !== "object")
    throw new Error("Patch parent does not exist");
  if (Array.isArray(node)) {
    const index = key === "-" ? node.length : Number(key);
    if (
      (key !== "-" && !/^(0|[1-9][0-9]*)$/.test(key)) ||
      !Number.isInteger(index) ||
      index < 0 ||
      index > node.length
    )
      throw new Error("Invalid array index");
    if (parts.length > 1) {
      const child = node[index];
      if (index >= node.length) throw new Error("Patch parent does not exist");
      mutate(child, parts.slice(1), patch);
    } else if (patch.op === "add") {
      if (patch.value === undefined) throw new Error("Missing value");
      node.splice(index, 0, patch.value);
    } else {
      if (index >= node.length) throw new Error("Patch target does not exist");
      if (patch.op === "remove") node.splice(index, 1);
      else {
        if (patch.value === undefined) throw new Error("Missing value");
        node[index] = patch.value;
      }
    }
  } else if (parts.length > 1) {
    const child = Object.hasOwn(node, key) ? node[key] : undefined;
    if (child === undefined) throw new Error("Patch parent does not exist");
    mutate(child, parts.slice(1), patch);
  } else {
    if (patch.op !== "add" && !Object.hasOwn(node, key))
      throw new Error("Patch target does not exist");
    if (patch.op === "remove") Reflect.deleteProperty(node, key);
    else {
      if (patch.value === undefined) throw new Error("Missing value");
      node[key] = patch.value;
    }
  }
}

export function applyPatches(spec: UiSpec, patches: Patch[]): UiSpec {
  let result = spec;
  for (const patch of patches) {
    const parts = pointer(patch.path);
    if (!["root", "elements", "state"].includes(parts[0] ?? ""))
      throw new Error("Patch path must address root, elements or state");
    const copy = jsonSchema.parse(JSON.parse(JSON.stringify(result)));
    mutate(copy, parts, patch);
    result = specSchema.parse(copy);
    validateSpec(result, false);
  }
  return result;
}

export function validateSpec(spec: UiSpec, complete: boolean): UiSpec {
  if (Object.hasOwn(spec.state, "form")) objectSchema.parse(spec.state.form);
  if (JSON.stringify(spec).length > maxBytes / 3) {
    const bytes = Array.from(JSON.stringify(spec)).reduce(
      (total, character) => {
        const code = character.codePointAt(0) ?? 0;
        return (
          total + (code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4)
        );
      },
      0,
    );
    if (bytes > maxBytes) throw new Error("UI exceeds 60 KB");
  }
  const keys = Object.keys(spec.elements);
  if (keys.length > 100) throw new Error("UI exceeds 100 elements");
  if (complete && (!spec.root || !Object.hasOwn(spec.elements, spec.root)))
    throw new Error("UI root is missing");
  for (const [id, element] of Object.entries(spec.elements)) {
    const visit = (value: z.infer<typeof jsonSchema>): void => {
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }
      if (value === null || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        if (key.startsWith("$") && key !== "$state" && key !== "$bindState")
          throw new Error(`Unsupported expression ${key}`);
        if (key === "$state" || key === "$bindState") {
          if (Object.keys(value).length !== 1 || typeof child !== "string")
            throw new Error("Invalid state expression");
          pointer(child);
          if (key === "$bindState" && !/^\/form\/[a-zA-Z0-9_-]+$/.test(child))
            throw new Error("Inputs must bind a direct /form field");
        } else visit(child);
      }
    };
    visit(element.props);
    const props = resolveElementProps(element.props, {
      stateModel: spec.state,
    });
    const parsed = definitions[element.type].props.safeParse(props);
    if (!parsed.success) throw new Error(`${id}: ${parsed.error.message}`);
    if (element.type === "Table") {
      const table = definitions.Table.props.parse(props);
      if (table.rows.some((row) => row.length !== table.columns.length))
        throw new Error("Table rows must match columns");
    }
    if (element.visible) pointer(element.visible.$state);
    if (element.on && element.type !== "Button")
      throw new Error("Only Button supports submission");
    if (["TextInput", "ChoiceGroup", "Checkbox"].includes(element.type)) {
      const value =
        element.props[element.type === "Checkbox" ? "checked" : "value"];
      if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        typeof value.$bindState !== "string"
      )
        throw new Error("Form fields require $bindState");
    }
    if (
      complete &&
      element.children.some((child) => !Object.hasOwn(spec.elements, child))
    )
      throw new Error(`${id}: missing child`);
  }
  let visits = 0;
  const walk = (id: string, ancestors: Set<string>, depth: number): void => {
    if (++visits > 10000 || ancestors.has(id) || depth > 12)
      throw new Error("UI contains a cycle or exceeds complexity limits");
    if (!Object.hasOwn(spec.elements, id)) return;
    const element = spec.elements[id];
    const next = new Set(ancestors);
    next.add(id);
    for (const child of element.children) walk(child, next, depth + 1);
  };
  for (const id of keys) walk(id, new Set(), 0);
  return spec;
}

export function validateForm(
  spec: UiSpec,
  values: z.infer<typeof objectSchema>,
): z.infer<typeof objectSchema> {
  const fields = new Set<string>();
  const state = { ...spec.state, form: values };
  for (const element of Object.values(spec.elements)) {
    if (!["TextInput", "ChoiceGroup", "Checkbox"].includes(element.type))
      continue;
    const binding =
      element.props[element.type === "Checkbox" ? "checked" : "value"];
    if (
      binding === null ||
      typeof binding !== "object" ||
      Array.isArray(binding) ||
      typeof binding.$bindState !== "string"
    )
      throw new Error("Invalid binding");
    const field = pointer(binding.$bindState)[1];
    if (pointer(binding.$bindState).length !== 2)
      throw new Error("Invalid form field");
    fields.add(field);
    const props = resolveElementProps(element.props, { stateModel: state });
    const result = definitions[element.type].props.safeParse(props);
    if (!result.success) throw new Error(`Invalid ${field}`);
    if (element.type === "TextInput") {
      const input = definitions.TextInput.props.parse(props);
      if (input.required && !input.value.trim())
        throw new Error(`${input.label} is required`);
      if (input.value.length > (input.maxLength ?? 8000))
        throw new Error(`${input.label} is too long`);
    }
    if (element.type === "ChoiceGroup") {
      const choice = definitions.ChoiceGroup.props.parse(props);
      if (!choice.options.some((option) => option.value === choice.value))
        throw new Error(`Invalid ${choice.label} choice`);
    }
  }
  if (Object.keys(values).some((key) => !fields.has(key)))
    throw new Error("Unknown form field");
  return values;
}

export function formValues(state: Record<string, unknown>) {
  return objectSchema.parse(getByPath(state, "/form") ?? {});
}
