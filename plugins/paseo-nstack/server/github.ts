import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { GitHubProblem } from "../shared/contracts";

export class GitHubAccessError extends Error {
  constructor(readonly problem: GitHubProblem) {
    super(problem.message);
    this.name = "GitHubAccessError";
  }
}

export interface GitHubOptions {
  hostname: string;
  restBaseUrl: string;
}

const run = promisify(execFile);
const userSchema = z.object({ login: z.string() }).loose();
const repositorySchema = z
  .object({ default_branch: z.string(), html_url: z.url() })
  .loose();
const labelSchema = z.object({ name: z.string() }).loose();
const issueSchema = z
  .object({
    number: z.number().int(),
    title: z.string(),
    html_url: z.url(),
    state: z.enum(["open", "closed"]),
    labels: z.array(labelSchema),
    pull_request: z.object({}).loose().optional(),
  })
  .loose();
const issueEventSchema = z
  .object({
    id: z.number().int(),
    event: z.string(),
    created_at: z.string(),
    label: labelSchema.optional(),
  })
  .loose();
const pullSchema = z
  .object({
    number: z.number().int(),
    title: z.string(),
    html_url: z.url(),
    state: z.enum(["open", "closed"]),
    created_at: z.string(),
    updated_at: z.string(),
    closed_at: z.string().nullable(),
    merged_at: z.string().nullable(),
    head: z.object({ sha: z.string() }),
  })
  .loose();
const commentSchema = z
  .object({
    id: z.number().int(),
    body: z.string(),
    html_url: z.url(),
    created_at: z.string(),
    updated_at: z.string(),
    user: z.object({ login: z.string() }),
    issue_url: z.string().optional(),
    pull_request_url: z.string().optional(),
  })
  .loose();
const reviewSchema = z
  .object({
    id: z.number().int(),
    body: z.string().nullable(),
    html_url: z.url(),
    submitted_at: z.string().nullable(),
    state: z.string(),
    user: z.object({ login: z.string() }),
  })
  .loose();
const checkRunSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    html_url: z.url(),
    head_sha: z.string(),
    status: z.string(),
    conclusion: z.string().nullable(),
    completed_at: z.string().nullable(),
  })
  .loose();
const checkRunsSchema = z
  .object({ check_runs: z.array(checkRunSchema) })
  .loose();
const combinedStatusSchema = z
  .object({ state: z.string(), sha: z.string(), total_count: z.number().int() })
  .loose();

export type Repository = z.infer<typeof repositorySchema>;
export type Issue = z.infer<typeof issueSchema>;
export type IssueEvent = z.infer<typeof issueEventSchema>;
export type Pull = z.infer<typeof pullSchema>;
export type Comment = z.infer<typeof commentSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type CheckRun = z.infer<typeof checkRunSchema>;
export type CombinedStatus = z.infer<typeof combinedStatusSchema>;

export interface GitHub {
  login(): Promise<string>;
  repository(owner: string, name: string): Promise<Repository>;
  issues(owner: string, name: string): Promise<Issue[]>;
  issueEvents(
    owner: string,
    name: string,
    number: number,
  ): Promise<IssueEvent[]>;
  pulls(
    owner: string,
    name: string,
    closedSince: string | null,
  ): Promise<Pull[]>;
  issueComments(owner: string, name: string, since: string): Promise<Comment[]>;
  reviewComments(
    owner: string,
    name: string,
    since: string,
  ): Promise<Comment[]>;
  reviews(owner: string, name: string, number: number): Promise<Review[]>;
  checkRuns(owner: string, name: string, sha: string): Promise<CheckRun[]>;
  combinedStatus(
    owner: string,
    name: string,
    sha: string,
  ): Promise<CombinedStatus>;
}

export function createGitHub(
  options: GitHubOptions,
  signal: AbortSignal,
): GitHub {
  function accessError(kind: GitHubProblem["kind"], message: string) {
    return new GitHubAccessError({ kind, message, hostname: options.hostname });
  }

  async function authenticate() {
    try {
      const result = await run(
        "gh",
        ["auth", "token", "--hostname", options.hostname],
        { signal, maxBuffer: 1024 * 1024 },
      );
      const token = result.stdout.trim();
      if (token.length === 0)
        throw new Error("gh returned an empty GitHub token");
      return token;
    } catch (error) {
      if (signal.aborted) throw error;
      throw accessError(
        "authentication",
        "GitHub CLI could not provide a token on the machine running Paseo.",
      );
    }
  }

  function endpoint(base: string, path: string) {
    return new URL(path.replace(/^\/+/, ""), `${base.replace(/\/+$/, "")}/`);
  }

  async function request<T>(
    schema: z.ZodType<T>,
    url: URL | string,
    init: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/vnd.github+json");
    headers.set("Authorization", `Bearer ${await authenticate()}`);
    headers.set("X-GitHub-Api-Version", "2022-11-28");
    const response = await fetch(url, {
      ...init,
      signal,
      headers,
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const apiMessage = z
        .object({ message: z.string() })
        .loose()
        .safeParse(body);
      const message = apiMessage.success
        ? apiMessage.data.message
        : response.statusText;
      if (response.status === 401)
        throw accessError(
          "authentication",
          "GitHub rejected the token supplied by GitHub CLI.",
        );
      if (
        response.status === 403 &&
        response.headers.get("x-ratelimit-remaining") !== "0" &&
        !/rate limit/i.test(message)
      )
        throw accessError("permission", message);
      throw new Error(`GitHub ${response.status.toString()}: ${message}`);
    }
    return schema.parse(body);
  }

  async function login() {
    return (await request(userSchema, endpoint(options.restBaseUrl, "user")))
      .login;
  }

  async function repository(owner: string, name: string): Promise<Repository> {
    return request(
      repositorySchema,
      endpoint(
        options.restBaseUrl,
        `repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
      ),
    );
  }

  async function issues(owner: string, name: string) {
    const entries = await paged(
      issueSchema,
      `repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues?state=open&sort=created&direction=asc`,
    );
    return entries.filter(
      (issue) => issue.state === "open" && !issue.pull_request,
    );
  }

  async function issueEvents(owner: string, name: string, number: number) {
    return paged(
      issueEventSchema,
      `repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/${number.toString()}/events`,
    );
  }

  async function paged<T>(
    schema: z.ZodType<T>,
    path: string,
    include?: (entry: T) => boolean,
    maximumPages = Number.POSITIVE_INFINITY,
  ) {
    const entries: T[] = [];
    for (let page = 1; ; page += 1) {
      const url = endpoint(options.restBaseUrl, path);
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", page.toString());
      const batch = await request(z.array(schema), url);
      for (const entry of batch) {
        if (include && !include(entry)) return entries;
        entries.push(entry);
      }
      if (batch.length < 100 || page >= maximumPages) return entries;
    }
  }

  async function pulls(
    owner: string,
    name: string,
    closedSince: string | null,
  ) {
    const root = `repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`;
    const closedPath = `${root}?state=closed&sort=updated&direction=desc`;
    const [open, recent] = await Promise.all([
      paged(pullSchema, `${root}?state=open&sort=updated&direction=desc`),
      closedSince === null
        ? paged(pullSchema, closedPath, undefined, 1)
        : paged(
            pullSchema,
            closedPath,
            (pull) => pull.updated_at >= closedSince,
          ),
    ]);
    const byNumber = new Map<number, Pull>();
    for (const pull of [...open, ...recent]) byNumber.set(pull.number, pull);
    return [...byNumber.values()];
  }

  async function issueComments(owner: string, name: string, since: string) {
    return paged(
      commentSchema,
      `repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/issues/comments?sort=updated&direction=asc&since=${encodeURIComponent(since)}`,
    );
  }

  async function reviewComments(owner: string, name: string, since: string) {
    return paged(
      commentSchema,
      `repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/comments?sort=updated&direction=asc&since=${encodeURIComponent(since)}`,
    );
  }

  async function reviews(owner: string, name: string, number: number) {
    return paged(
      reviewSchema,
      `repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls/${number.toString()}/reviews`,
    );
  }

  async function checkRuns(owner: string, name: string, sha: string) {
    const url = endpoint(
      options.restBaseUrl,
      `repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(sha)}/check-runs`,
    );
    url.searchParams.set("per_page", "100");
    return (await request(checkRunsSchema, url)).check_runs;
  }

  async function combinedStatus(owner: string, name: string, sha: string) {
    return request(
      combinedStatusSchema,
      endpoint(
        options.restBaseUrl,
        `repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(sha)}/status`,
      ),
    );
  }

  return {
    login,
    repository,
    issues,
    issueEvents,
    pulls,
    issueComments,
    reviewComments,
    reviews,
    checkRuns,
    combinedStatus,
  };
}
