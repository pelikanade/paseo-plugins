import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { artifacts, fixture, until } from "./harness.mjs";

const { api } = await artifacts();
function git(root, ...args) {
  return execFileSync(
    "git",
    [
      "-C",
      root,
      "-c",
      "user.name=Devenv Test",
      "-c",
      "user.email=devenv@example.test",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { encoding: "utf8" },
  ).trim();
}
async function worktree(t) {
  const f = await fixture(t, api, {}, 2000);
  const nested = join(f.root, "nested");
  await mkdir(nested);
  await writeFile(join(nested, "devenv.nix"), "nested-version");
  git(f.root, "init");
  git(f.root, "add", ".");
  git(f.root, "commit", "-m", "fixture");
  const linked = join(f.temporary, "linked worktree");
  git(f.root, "worktree", "add", "--detach", linked);
  return { ...f, linked, nested, linkedNested: join(linked, "nested") };
}
function mcp(root, binary) {
  const config = api.mcpConfig(root, binary);
  return spawnSync(config.command, config.args, {
    env: process.env,
    input:
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }) + "\n",
    encoding: "utf8",
    timeout: 4000,
  });
}

test("a linked worktree inherits its main project's trust without changing the trust store", async (t) => {
  const f = await worktree(t);
  await f.trust();
  const before = await readFile(join(f.home, "allowed"), "utf8");
  assert.equal(api.isTrusted(f.linked), true);
  assert.equal(f.environments.view("agent", f.linked).status, "detected");
  assert.deepEqual(await f.calls(), []);
  await writeFile(join(f.linked, "devenv.nix"), "linked-version");
  const opened = await f.environments.open(
    "agent",
    f.linked,
    {},
    new AbortController().signal,
  );
  assert.equal(opened.PASEO_DEVENV_STATUS, "ready");
  assert.equal(opened.PASEO_DEVENV_ROOT, f.linked);
  assert.equal(opened.PROJECT_VERSION, "linked-version");
  assert.equal(f.environments.view("agent", f.linked).needsReload, false);
  const main = await f.open("main");
  assert.equal(main.PROJECT_VERSION, "version-one");
  const launched = mcp(f.linked, f.binary);
  assert.equal(launched.status, 0, launched.stderr);
  assert.equal(
    JSON.parse(launched.stdout).result.tools[0].description,
    f.linked,
  );
  assert.deepEqual(
    (await f.calls()).map(({ command, root }) => ({ command, root })),
    [
      { command: "direnv-export", root: f.linked },
      { command: "direnv-export", root: f.root },
      { command: "mcp", root: f.linked },
    ],
  );
  assert.equal(await readFile(join(f.home, "allowed"), "utf8"), before);
});

test("nested devenv projects inherit only their corresponding main project", async (t) => {
  const f = await worktree(t);
  await f.trust();
  assert.equal(api.isTrusted(f.linked), true);
  assert.equal(api.isTrusted(f.linkedNested), false);
  assert.notEqual(mcp(f.linkedNested, f.binary).status, 0);
  await f.trust([f.nested]);
  assert.equal(api.isTrusted(f.linked), false);
  assert.equal(api.isTrusted(f.linkedNested), true);
  const child = join(f.linkedNested, "child");
  await mkdir(child);
  assert.equal(api.findRoot(child), f.linkedNested);
  const opened = await f.environments.open(
    "nested",
    child,
    {},
    new AbortController().signal,
  );
  assert.equal(opened.PASEO_DEVENV_ROOT, f.linkedNested);
  assert.equal(opened.PROJECT_VERSION, "nested-version");
  const launched = mcp(f.linkedNested, f.binary);
  assert.equal(launched.status, 0, launched.stderr);
});

test("trust does not spread from sibling worktrees or across unrelated repositories", async (t) => {
  const f = await worktree(t);
  const sibling = join(f.temporary, "sibling");
  git(f.root, "worktree", "add", "--detach", sibling);
  await f.trust([f.linked]);
  assert.equal(api.isTrusted(f.linked), true);
  assert.equal(api.isTrusted(sibling), false);
  assert.equal(api.isTrusted(f.root), false);
  await f.trust();
  assert.equal(api.isTrusted(sibling), true);
  const unrelated = join(f.temporary, "unrelated");
  await mkdir(unrelated);
  git(unrelated, "init");
  await writeFile(join(unrelated, "devenv.nix"), "unrelated");
  assert.equal(api.isTrusted(unrelated), false);
  const copied = join(f.temporary, "copied");
  await mkdir(copied);
  await copyFile(join(f.linked, ".git"), join(copied, ".git"));
  await writeFile(join(copied, "devenv.nix"), "copied");
  assert.equal(api.isTrusted(copied), false);
  assert.notEqual(mcp(copied, f.binary).status, 0);
  assert.deepEqual(await f.calls(), []);
});

test("relative Git metadata and symlinks preserve worktree trust; broken metadata denies inheritance", async (t) => {
  const f = await worktree(t);
  const gitdir = git(f.linked, "rev-parse", "--absolute-git-dir");
  await writeFile(
    join(f.linked, ".git"),
    `gitdir: ${relative(f.linked, gitdir)}\n`,
  );
  await writeFile(
    join(gitdir, "gitdir"),
    `${relative(gitdir, join(f.linked, ".git"))}\n`,
  );
  const mainLink = join(f.temporary, "main link");
  const linkedLink = join(f.temporary, "linked link");
  await symlink(f.root, mainLink);
  await symlink(f.linked, linkedLink);
  await f.trust(["# comment", "/missing", mainLink]);
  assert.equal(api.isTrusted(linkedLink), true);
  assert.equal(mcp(linkedLink, f.binary).status, 0);
  await writeFile(join(gitdir, "commondir"), "missing\n");
  assert.equal(api.isTrusted(f.linked), false);
  assert.notEqual(mcp(f.linked, f.binary).status, 0);
  await f.trust([f.linked]);
  assert.equal(api.isTrusted(f.linked), true);
});

test("worktrees with a separate main Git directory inherit main project trust", async (t) => {
  const f = await worktree(t);
  const separate = join(f.temporary, "separate git directory");
  git(f.root, "init", "--separate-git-dir", separate);
  git(f.root, "worktree", "repair", f.linked);
  await f.trust();
  assert.equal(api.isTrusted(f.linked), true);
  assert.equal(mcp(f.linked, f.binary).status, 0);
  assert.notEqual(dirname(separate), f.root);
});

test("main project trust revocation blocks cached environments and new MCP launches", async (t) => {
  const f = await worktree(t);
  await f.trust();
  const open = (id) =>
    f.environments.open(id, f.linked, {}, new AbortController().signal);
  assert.equal((await open("applied")).PASEO_DEVENV_STATUS, "ready");
  await f.trust([]);
  assert.deepEqual(f.environments.view("applied", f.linked), {
    root: f.linked,
    status: "denied",
    applied: true,
    needsReload: true,
    error: null,
  });
  const denied = await open("new");
  assert.equal(denied.PASEO_DEVENV_STATUS, "denied");
  assert.equal(denied.PROJECT_VERSION, undefined);
  assert.notEqual(mcp(f.linked, f.binary).status, 0);
  assert.equal((await f.calls()).length, 1);
  await f.trust();
  await f.control({ delayMs: 100 });
  const pending = f.environments.load(f.linked, true);
  await until(async () => (await f.calls()).length === 2);
  await f.trust([]);
  assert.equal(await pending, undefined);
  assert.equal(f.environments.view("new", f.linked).status, "denied");
});
