import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, cp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import model from "../server/model.generated.mjs";
import { artifacts, plugin } from "./harness.mjs";

const { api } = await artifacts();
const profile = { $: "Profile", path: "/project" };
const events = [
  "EvSessionOpen",
  "EvTrustObserved",
  "EvAllowRequested",
  "EvRevoke",
  "EvCommand",
  "EvLoadOk",
  "EvLoadFail",
  "EvCooldownElapsed",
  "EvProjectChanged",
].map(($) => ($ === "EvLoadOk" ? { $, profile } : { $ }));
function expected(state, event) {
  if (state.$ === "Untrusted")
    return event.$ === "EvTrustObserved"
      ? { $: "Trusted", load: { $: "Unloaded" } }
      : state;
  if (event.$ === "EvRevoke") return { $: "Untrusted" };
  const phase = state.load.$;
  if (
    (phase === "Unloaded" &&
      ["EvSessionOpen", "EvAllowRequested"].includes(event.$)) ||
    (phase === "Failed" && event.$ === "EvCooldownElapsed") ||
    (phase === "Loaded" && event.$ === "EvProjectChanged")
  )
    return { $: "Trusted", load: { $: "InFlight" } };
  if (phase === "InFlight" && event.$ === "EvLoadOk")
    return { $: "Trusted", load: { $: "Loaded", profile: event.profile } };
  if (phase === "InFlight" && event.$ === "EvLoadFail")
    return { $: "Trusted", load: { $: "Failed" } };
  return state;
}
function check(state, application) {
  const ready = state.$ === "Trusted" && state.load.$ === "Loaded";
  assert.equal(api.sessionStatus(state, { $: "Host" }) === "ready", false);
  assert.equal(
    api.sessionStatus(state, application),
    model.session_status(state, application),
  );
  assert.equal(api.decide(state).$ === "Give", ready);
  assert.equal(
    api.status(state),
    state.$ === "Untrusted"
      ? "denied"
      : {
          Unloaded: "detected",
          InFlight: "loading",
          Loaded: "ready",
          Failed: "error",
        }[state.load.$],
  );
  for (const fresh of [false, true]) {
    assert.equal(
      api.needsReload(state, application, fresh),
      application.$ === "Applied" ? state.$ === "Untrusted" || !fresh : ready,
    );
    assert.equal(
      api.needsReload(state, application, fresh),
      model.needs_reload(state, application, fresh),
    );
  }
  for (const $ of ["EvPrepared", "EvChanged", "EvRevoked"])
    assert.deepEqual(api.sessionStep(application, { $ }), application);
  assert.equal(
    api.isApplied(api.sessionStep(application, { $: "EvBudgetElapsed" })),
    false,
  );
}
test("all root event sequences of length 0–4 agree with the runtime bridge and session safety", () => {
  let count = 0;
  function visit(state, application, length) {
    count += 1;
    check(state, application);
    if (length === 4) return;
    for (const event of events) {
      const next = api.advance(state, event);
      assert.deepEqual(next, expected(state, event));
      assert.deepEqual(
        next,
        model.step(state, event).$ === "TrAccepted"
          ? model.step(state, event).next
          : state,
      );
      const start =
        next.$ === "Trusted" &&
        next.load.$ === "InFlight" &&
        !(state.$ === "Trusted" && state.load.$ === "InFlight");
      assert.equal(api.shouldLoad(state, event), start);
      let session = application;
      if (event.$ === "EvSessionOpen")
        session = api.sessionStep(application, {
          $: "EvOpened",
          decision: api.decide(state),
        });
      if (event.$ === "EvLoadOk")
        session = api.sessionStep(application, { $: "EvPrepared" });
      if (event.$ === "EvProjectChanged")
        session = api.sessionStep(application, { $: "EvChanged" });
      if (event.$ === "EvRevoke")
        session = api.sessionStep(application, { $: "EvRevoked" });
      if (session.$ === "Applied" && application.$ !== "Applied")
        assert.equal(event.$, "EvSessionOpen");
      visit(next, session, length + 1);
    }
  }
  visit({ $: "Untrusted" }, { $: "Host" }, 0);
  assert.equal(count, 7381);
  for (const trusted of [false, true])
    for (const phase of ["detected", "loading", "ready", "error"])
      check(api.rootState(trusted, phase, "/project"), { $: "Host" });
});
test("cold build, timeout, background completion, reopen, change, revoke and retry remain distinct", () => {
  let state = { $: "Untrusted" };
  let application = { $: "Host" };
  for (const name of ["EvTrustObserved", "EvSessionOpen"])
    state = api.advance(state, { $: name });
  application = api.sessionStep(application, { $: "EvBudgetElapsed" });
  state = api.advance(state, { $: "EvLoadOk", profile });
  application = api.sessionStep(application, { $: "EvPrepared" });
  assert.equal(api.isApplied(application), false);
  assert.equal(api.needsReload(state, application, true), true);
  application = api.sessionStep(application, {
    $: "EvOpened",
    decision: api.decide(state),
  });
  assert.equal(api.isApplied(application), true);
  state = api.advance(state, { $: "EvProjectChanged" });
  assert.equal(api.needsReload(state, application, false), true);
  state = api.advance(state, { $: "EvRevoke" });
  assert.equal(api.decide(state).$, "Skip");
  assert.equal(api.needsReload(state, application, true), true);
  application = api.sessionStep(application, {
    $: "EvOpened",
    decision: api.decide(state),
  });
  assert.equal(api.isApplied(application), false);
  for (const name of [
    "EvTrustObserved",
    "EvAllowRequested",
    "EvLoadFail",
    "EvCommand",
    "EvCooldownElapsed",
  ])
    state = api.advance(state, { $: name });
  assert.equal(api.status(state), "loading");
});
test("Bend rejects revoke, duplicate build and premature application mutations", async (t) => {
  const mutations = [
    [
      "ignore revocation",
      "case Trusted{_} EvRevoke{}:\n      TrAccepted{Untrusted{}}",
      "case Trusted{_} EvRevoke{}:\n      TrRejected{}",
    ],
    [
      "duplicate build",
      "def should_load(+state: RootState, +event: RootEvent) -> Bool:\n  match state event:",
      "def should_load(+state: RootState, +event: RootEvent) -> Bool:\n  match state event:\n    case Trusted{InFlight{}} EvSessionOpen{}:\n      True{}",
    ],
    [
      "apply on background success",
      "case EvPrepared{}:\n      application",
      'case EvPrepared{}:\n      Applied{Profile{"/mutant"}}',
    ],
  ];
  for (const [name, before, after] of mutations)
    await t.test(name, async () => {
      const temporary = await mkdtemp(join(tmpdir(), "paseo-devenv-mutation-"));
      try {
        for (const file of ["model.bend", "LAWS.bend", "PROOF.bend"])
          await cp(join(plugin, "verify", file), join(temporary, file));
        const source = await readFile(join(temporary, "model.bend"), "utf8");
        assert.ok(source.includes(before));
        await writeFile(
          join(temporary, "model.bend"),
          source.replace(before, after),
        );
        const result = spawnSync(
          process.env.BEND_BIN ?? "bend",
          ["PROOF.bend"],
          { cwd: temporary, encoding: "utf8" },
        );
        assert.ifError(result.error);
        assert.notEqual(result.status, 0, result.stdout + result.stderr);
        assert.ok(!result.stdout.includes("ALL PROOFS CHECK"));
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    });
});
