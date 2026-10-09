import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
export async function githubFixture(t) {
  const requests = [];
  const state = {
    pulls: [],
    issueComments: [],
    reviewComments: [],
    repositoryFailure: false,
    discoveryPagination: false,
    statuses: new Map([
      ["main", { state: "success", sha: "main-sha", total_count: 1 }],
    ]),
  };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://fixture.invalid");
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf8");
    const body = text ? JSON.parse(text) : null;
    requests.push({
      method: request.method,
      path: url.pathname,
      search: url.search,
      body,
    });
    response.setHeader("content-type", "application/json");

    if (request.method === "POST" && url.pathname === "/graphql") {
      if (body.query.includes("query Discover")) {
        const secondPage =
          state.discoveryPagination &&
          body.variables.organizationAfter === "project-page-1";
        const project = secondPage
          ? {
              id: "project-2",
              number: 2,
              title: "Operations",
              url: "https://github.com/orgs/acme/projects/2",
              fields: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            }
          : {
              id: "project-1",
              number: 1,
              title: "Delivery",
              url: "https://github.com/orgs/acme/projects/1",
              fields: {
                nodes: [
                  {
                    id: "status-1",
                    name: "Status",
                    options: [
                      { id: "ready-1", name: "Ready" },
                      { id: "building-1", name: "In progress" },
                    ],
                  },
                ],
                pageInfo: state.discoveryPagination
                  ? { hasNextPage: true, endCursor: "field-page-1" }
                  : { hasNextPage: false, endCursor: null },
              },
            };
        response.end(
          JSON.stringify({
            data: {
              repository: { id: "repository-1" },
              organization: {
                projectsV2: {
                  nodes: [project],
                  pageInfo:
                    state.discoveryPagination && !secondPage
                      ? {
                          hasNextPage: true,
                          endCursor: "project-page-1",
                        }
                      : { hasNextPage: false, endCursor: null },
                },
              },
              user: null,
            },
          }),
        );
        return;
      }
      if (body.query.includes("query ProjectFields")) {
        response.end(
          JSON.stringify({
            data: {
              node: {
                fields: {
                  nodes: [
                    {
                      id: "priority-1",
                      name: "Priority",
                      options: [{ id: "high-1", name: "High" }],
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          }),
        );
        return;
      }
      if (body.query.includes("query ProjectItems")) {
        response.end(
          JSON.stringify({
            data: {
              node: {
                items: {
                  nodes: [
                    {
                      id: "item-42",
                      updatedAt: "2026-01-02T03:04:05.000Z",
                      content: {
                        __typename: "Issue",
                        number: 42,
                        title: "Ship the watcher",
                        url: "https://github.com/acme/repo/issues/42",
                      },
                      fieldValueByName: {
                        optionId: "ready-1",
                        name: "Ready",
                        updatedAt: "2026-01-02T03:04:05.000Z",
                      },
                    },
                  ],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          }),
        );
        return;
      }
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
    requests,
    state,
  };
}
