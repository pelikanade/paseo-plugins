import assert from "node:assert/strict";
import test from "node:test";
import { artifacts, evaluate, require, until } from "./harness.mjs";

const { api, clientBundle } = await artifacts();
function clientModule(state) {
  return evaluate(clientBundle, (name) => {
    if (name === "react")
      return {
        useState: (value) => {
          if (!state.uiHooks) return [value, () => {}];
          const index = state.hookIndex++;
          if (!Object.hasOwn(state.uiHooks, index))
            state.uiHooks[index] = value;
          return [
            state.uiHooks[index],
            (next) => {
              state.uiHooks[index] = next;
            },
          ];
        },
      };
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
        useRpc: (contract) => async (input) =>
          state.onRpc ? state.onRpc(contract, input) : state.view,
        useSettings: () => state.settings,
      };
    if (name === "@getpaseo/plugin/client/react-native")
      return { Icon: "Icon", ScrollView: "ScrollView" };
    if (name === "@tanstack/react-query")
      return {
        useQuery: () => ({
          data: state.view,
          error: state.queryError,
          isFetching: state.isFetching ?? false,
        }),
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
function find(node, predicate) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = find(child, predicate);
      if (match) return match;
    }
  } else if (node && typeof node === "object") {
    if (predicate(node)) return node;
    return find(node.props?.children, predicate);
  }
}
const theme = {
  colors: {
    foreground: "black",
    foregroundMuted: "gray",
    surface0: "white",
    surface1: "white",
    surface2: "lightgray",
    border: "gray",
    accent: "blue",
    accentForeground: "white",
    statusSuccess: "green",
    statusWarning: "orange",
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
  const untrustedIcon = pills.get("agent").button.icon;
  assert.equal(typeof untrustedIcon, "function");
  assert.match(
    JSON.stringify(
      render({
        type: untrustedIcon,
        props: { ...props, size: 16, color: "black" },
      }),
    ),
    /orange/,
  );
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
  assert.notEqual(pills.get("agent").button.icon, untrustedIcon);
  state.view = {
    ...state.view,
    applied: false,
    needsReload: false,
    status: "denied",
  };
  listener({ kind: "upsert", agent });
  await until(() => pills.get("agent").button.icon === untrustedIcon);
  listener({ kind: "remove", agentId: "second" });
  assert.equal(pills.get("second").removed, true);
  await cleanup();
  assert.equal(released, 1);
  assert.equal(removed, 6);
  assert.equal(pills.get("agent").removed, true);
});
test("native status labels, preparation, session state and trust actions stay distinct", async () => {
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
  for (const [status, applied, needsReload, headline, detail] of [
    ["detected", false, false, "Project detected", "has not been prepared"],
    [
      "loading",
      false,
      false,
      "Preparing environment",
      "Status updates automatically",
    ],
    ["ready", false, false, "Environment prepared", "has not been applied"],
    [
      "ready",
      true,
      false,
      "Environment applied",
      "running with the project environment",
    ],
    [
      "loading",
      true,
      true,
      "Reload required",
      "updated environment is preparing",
    ],
    ["error", true, true, "Reload required", "preparation failed"],
    ["denied", true, true, "Reload required", "trust was revoked"],
    [null, false, false, "No devenv project", "No devenv.nix found"],
    [null, true, true, "Reload required", "no longer available"],
  ]) {
    state.view = {
      ...state.view,
      root: status === null ? null : "/project",
      status,
      applied,
      needsReload,
      error: status === "error" ? "Build failed" : null,
    };
    const tree = render({ type: panel.Component, props });
    const text = strings(tree);
    assert.ok(text.includes(headline), text);
    assert.ok(text.includes(detail), text);
    assert.doesNotMatch(text, /PROJECT|Preparation\n|Session\n/);
    if (needsReload) assert.ok(text.includes("paseo agent reload agent"), text);
    if (status === "error") {
      assert.ok(text.includes("Build failed"));
      assert.ok(
        find(tree, (node) => node.props?.accessibilityRole === "alert"),
      );
    }
    if (status === "loading") {
      const prepare = find(
        tree,
        (node) =>
          node.type === "Pressable" &&
          strings(node) === "Preparing environment…",
      );
      assert.equal(prepare.props.disabled, true);
      assert.equal(prepare.props.accessibilityState.busy, true);
    }
  }
  state.view = {
    ...state.view,
    root: "/project",
    status: "denied",
    applied: false,
    needsReload: false,
    error: null,
  };
  state.uiHooks = [];
  const calls = [];
  state.onRpc = (contract, input) => {
    calls.push({ name: contract.name, input });
    return state.view;
  };
  const statusTree = () => {
    state.hookIndex = 0;
    return render({ type: panel.Component, props });
  };
  const button = (label) =>
    find(
      statusTree(),
      (node) => node.type === "Pressable" && strings(node) === label,
    );
  button("Review project trust").props.onPress();
  assert.equal(calls.length, 0);
  assert.ok(strings(statusTree()).includes("Allow this project to run code?"));
  assert.equal(strings(statusTree()).split("/project").length - 1, 1);
  assert.equal(button("Refresh status"), undefined);
  button("Cancel").props.onPress();
  assert.equal(calls.length, 0);
  assert.ok(button("Review project trust"));
  button("Review project trust").props.onPress();
  button("Allow project").props.onPress();
  assert.equal(button("Allowing…").props.disabled, true);
  await until(() => !state.uiHooks[1]);
  assert.deepEqual(calls, [
    { name: "devenv.allow", input: { agentId: "agent" } },
  ]);
  assert.ok(button("Review project trust"));
  state.isFetching = true;
  assert.equal(button("Refreshing…"), undefined);
  assert.equal(button("Refresh status").props.disabled, false);
  state.isFetching = false;
  button("Refresh status").props.onPress();
  assert.equal(button("Refreshing…").props.disabled, true);
  await until(() => !state.uiHooks[3]);
  assert.ok(button("Refresh status"));
  state.view = { ...state.view, status: "error" };
  const expectedError = new Error("Cannot reach daemon");
  state.onRpc = () => {
    throw expectedError;
  };
  button("Reload environment").props.onPress();
  await until(() => !state.uiHooks[1]);
  assert.ok(strings(statusTree()).includes(expectedError.message));
  button("Refresh status").props.onPress();
  await until(() => !state.uiHooks[3]);
  assert.ok(!strings(statusTree()).includes(expectedError.message));
  state.view = { ...state.view, status: "denied" };
  button("Review project trust").props.onPress();
  button("Allow project").props.onPress();
  await until(() => !state.uiHooks[1]);
  assert.ok(strings(statusTree()).includes(expectedError.message));
  button("Cancel").props.onPress();
  assert.ok(!strings(statusTree()).includes(expectedError.message));
  await cleanup();
});
