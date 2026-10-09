import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
export async function githubFixture(t) {
  const state = {
    issues: [
      {
        number: 42,
        title: "Ship the watcher",
        html_url: "https://github.com/acme/repo/issues/42",
        state: "open",
        labels: [{ name: "stack:ready" }],
      },
    ],
    issueEvents: new Map([
      [
        42,
        [
          {
            id: 4201,
            event: "labeled",
            label: { name: "stack:ready" },
            created_at: "2026-01-02T03:04:05.000Z",
          },
        ],
      ],
    ]),
    pulls: [],
    issueComments: [],
    reviewComments: [],
    repositoryFailure: false,
    statuses: new Map([
      ["main", { state: "success", sha: "main-sha", total_count: 1 }],
    ]),
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://fixture.invalid");
    response.setHeader("content-type", "application/json");

    if (
      request.method === "GET" &&
      url.pathname === "/repos/acme/repo/issues"
    ) {
      const page = Number(url.searchParams.get("page") ?? "1");
      const perPage = Number(url.searchParams.get("per_page") ?? "100");
      const issues = state.issues.filter((issue) => issue.state === "open");
      response.end(
        JSON.stringify(issues.slice((page - 1) * perPage, page * perPage)),
      );
      return;
    }
    const eventsPath =
      request.method === "GET"
        ? /^\/repos\/acme\/repo\/issues\/(\d+)\/events$/.exec(url.pathname)
        : null;
    if (eventsPath) {
      const events = state.issueEvents.get(Number(eventsPath[1])) ?? [];
      const page = Number(url.searchParams.get("page") ?? "1");
      const perPage = Number(url.searchParams.get("per_page") ?? "100");
      response.end(
        JSON.stringify(events.slice((page - 1) * perPage, page * perPage)),
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/user") {
      response.end(JSON.stringify({ login: "human" }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/repos/acme/repo") {
      if (state.repositoryFailure) {
        response.statusCode = 503;
        response.end(JSON.stringify({ message: "fixture unavailable" }));
        return;
      }
      response.end(
        JSON.stringify({
          default_branch: "main",
          html_url: "https://github.com/acme/repo",
        }),
      );
      return;
    }
    if (request.method === "GET" && url.pathname === "/repos/acme/repo/pulls") {
      const requestedState = url.searchParams.get("state");
      const page = Number(url.searchParams.get("page") ?? "1");
      const perPage = Number(url.searchParams.get("per_page") ?? "100");
      const pulls = state.pulls.filter(
        (pull) => requestedState === null || pull.state === requestedState,
      );
      response.end(
        JSON.stringify(pulls.slice((page - 1) * perPage, page * perPage)),
      );
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/repos/acme/repo/issues/comments"
    ) {
      response.end(JSON.stringify(state.issueComments));
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/repos/acme/repo/pulls/comments"
    ) {
      response.end(JSON.stringify(state.reviewComments));
      return;
    }
    const statusPath =
      request.method === "GET"
        ? /^\/repos\/acme\/repo\/commits\/([^/]+)\/status$/.exec(url.pathname)
        : null;
    if (statusPath) {
      const status = state.statuses.get(decodeURIComponent(statusPath[1]));
      if (status) {
        response.end(JSON.stringify(status));
        return;
      }
    }
    if (
      request.method === "GET" &&
      /^\/repos\/acme\/repo\/commits\/[^/]+\/check-runs$/.test(url.pathname)
    ) {
      response.end(JSON.stringify({ check_runs: [] }));
      return;
    }
    if (
      request.method === "GET" &&
      /^\/repos\/acme\/repo\/pulls\/\d+\/reviews$/.test(url.pathname)
    ) {
      response.end("[]");
      return;
    }

    response.statusCode = 404;
    response.end(
      JSON.stringify({
        message: `Unhandled ${request.method} ${url.pathname}`,
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  t.after(async () => {
    server.close();
    await once(server, "close");
  });
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    state,
  };
}
