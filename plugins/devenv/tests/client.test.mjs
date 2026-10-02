import assert from "node:assert/strict";
import test from "node:test";
import { artifacts, evaluate, require, until } from "./harness.mjs";

const { api, clientBundle } = await artifacts();
function clientModule(state) {
  return evaluate(clientBundle, (name) => {
    if (name === "react") return { useState: (value) => [value, () => {}] };
    if (name === "react/jsx-runtime")
      return {
        jsx: (type, props) => ({ type, props }),
        jsxs: (type, props) => ({ type, props }),
      };
    if (name === "react-native")
      return {
        Pressable: "Pressable",
        ScrollView: "ScrollView",
        Text: "Text",
        TextInput: "TextInput",
        View: "View",
      };
    if (name === "@getpaseo/plugin/client")
      return {
        useAgent: (id, selector) => selector({ updatedAt: "today" }),
        useRpc: () => async () => state.view,
        useSettings: () => state.settings,
      };
    if (name === "@tanstack/react-query")
      return {
        useQuery: () => ({ data: state.view }),
        useQueryClient: () => ({ invalidateQueries: async () => {} }),
      };
    assert.ok(!name.startsWith("node:"), name);
    return require(name);
  });
}
function render(element) {
  if (!element || typeof element !== "object") return element;
  if (Array.isArray(element)) return element.map(render);
  if (typeof element.type === "function")
    return render(element.type(element.props));
  return {
    type: element.type,
    props: { ...element.props, children: render(element.props?.children) },
  };
}
function strings(node) {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(strings).join("\n");
  return node && typeof node === "object" ? strings(node.props?.children) : "";
}
const theme = {
  colors: {
    foreground: "black",
    surface1: "white",
    border: "gray",
    statusDanger: "red",
  },
};
const props = {
  theme,
  host: { id: "host", label: "Host" },
  layout: { compact: true, platform: "ios" },
  context: "agent",
  workspaceId: "workspace",
  agentId: "agent",
};
test("compiled client registers native surfaces, paginates agents, tracks status and releases resources", async () => {
  const state = {
    view: {
      root: "/project",
      status: "denied",
      applied: false,
      needsReload: false,
      error: null,
    },
    settings: { status: "loading" },
  };
  const contributions = new Map();
  const pills = new Map();
  const opened = [];
  let listener;
  let observer;
  let released = 0;
  let removed = 0;
  let grants = 0;
  let pages = 0;
  const agent = { id: "agent", workspaceId: "workspace", archivedAt: null };
  const owned = {
    release: async () => {
      released++;
    },
    subscribe: (input) => {
      observer = input;
      return () => {
        removed++;
      };
    },
  };
  const register = (kind) => (contribution) => {
    contributions.set(
      kind + ":" + (contribution.id ?? contribution.name),
      contribution,
    );
    return () => {
      removed++;
    };
  };
  const context = {
    addSettingsScreen: register("settings"),
    addWorkspacePanel: register("panel"),
    addSlashCommand: register("slash"),
    addComposerPill: (contribution) => {
      const record = { ...contribution, removed: false };
      pills.set(contribution.agentId, record);
      return {
        update: (patch) => {
          record.button = { ...record.button, ...patch };
        },
        remove: () => {
          record.removed = true;
        },
      };
    },
    rpc: async (contract, input) => {
      contract.input.parse(input);
      if (contract.name === "devenv.allow") {
        grants++;
        state.view = { ...state.view, status: "loading" };
      }
      return contract.output.parse(state.view);
    },
    paseo: {
      agents: {
        subscribe: (callback) => {
          listener = callback;
          return () => {
            removed++;
          };
        },
        list: async (input) => {
          pages++;
          return input.subscribe
            ? {
                entries: [{ agent }],
                pageInfo: { nextCursor: "next" },
                subscription: owned,
              }
            : {
                entries: [{ agent: { ...agent, id: "second" } }],
                pageInfo: { nextCursor: null },
              };
        },
      },
    },
  };
  const cleanup = clientModule(state).default(context);
  await until(() => pills.get("second")?.button.label === "devenv · untrusted");
  assert.equal(pages, 2);
  assert.ok(pills.get("agent").button.visible);
  const commandContext = {
    context: "agent",
    agent,
    rpc: context.rpc,
    openPanel: (id) => {
      opened.push(id);
    },
  };
  await contributions.get("slash:devenv-status").onSubmit(commandContext);
  assert.equal(grants, 0);
  await contributions.get("slash:devenv-allow").onSubmit(commandContext);
  await until(() => pills.get("agent").button.label === "devenv · loading");
  assert.equal(grants, 1);
  assert.deepEqual(opened, ["devenv", "devenv"]);
  state.view = { ...state.view, status: "ready", needsReload: true };
  observer.snapshot({ entries: [{ agent }], pageInfo: {} });
  await until(
    () => pills.get("agent").button.label === "devenv · reload required",
  );
  const Component = contributions.get("panel:devenv").Component;
  assert.match(
    strings(render({ type: Component, props })),
    /Reload this agent/,
  );
  assert.match(
    strings(render({ type: Component, props })),
    /paseo agent reload agent/,
  );
  state.view = { ...state.view, applied: true, needsReload: false };
  listener({ kind: "upsert", agent });
  await until(() => pills.get("agent").button.label === "devenv · applied");
  listener({ kind: "remove", agentId: "second" });
  assert.equal(pills.get("second").removed, true);
  await cleanup();
  assert.equal(released, 1);
  assert.equal(removed, 6);
  assert.equal(pills.get("agent").removed, true);
});
test("native status labels and settings render prepared and applied states separately", () => {
  for (const [status, applied, needsReload, label] of [
    ["ready", false, true, "reload required"],
    ["ready", false, false, "prepared"],
    ["ready", true, false, "applied"],
    ["denied", false, false, "untrusted"],
    ["error", false, false, "error"],
  ])
    assert.match(
      api.statusLabel({ status, applied, needsReload }),
      new RegExp(label),
    );
  const state = {
    settings: {
      status: "ready",
      values: api.settingsSchema.parse({}),
      revision: "1",
      saving: false,
      saveError: null,
    },
    view: {
      root: "/project",
      status: "denied",
      applied: false,
      needsReload: false,
      error: null,
    },
  };
  let settings;
  let panel;
  const noCleanup = () => {};
  const cleanup = clientModule(state).default({
    addSettingsScreen: (contribution) => {
      settings = contribution;
      return noCleanup;
    },
    addWorkspacePanel: (contribution) => {
      panel = contribution;
      return noCleanup;
    },
    addSlashCommand: () => noCleanup,
    paseo: {
      agents: {
        subscribe: () => noCleanup,
        list: async () => ({
          entries: [],
          pageInfo: {},
          subscription: { release: async () => {}, subscribe: () => noCleanup },
        }),
      },
    },
  });
  const settingsTree = render({ type: settings.Component, props });
  assert.match(strings(settingsTree), /Save settings/);
  assert.match(
    strings(render({ type: panel.Component, props })),
    /Review project trust/,
  );
  return cleanup();
});
