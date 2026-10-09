import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

export interface GitHubOptions {
  hostname: string;
  restBaseUrl: string;
  graphqlUrl: string;
}

const run = promisify(execFile);
const userSchema = z.object({ login: z.string() }).loose();
const repositorySchema = z
  .object({ default_branch: z.string(), html_url: z.url() })
  .loose();
const optionSchema = z.object({ id: z.string(), name: z.string() }).loose();
const pageInfoSchema = z.object({
  hasNextPage: z.boolean(),
  endCursor: z.string().nullable(),
});
const fieldSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    options: z.array(optionSchema).optional(),
  })
  .loose();
const fieldsSchema = z.object({
  nodes: z.array(fieldSchema.nullable()),
  pageInfo: pageInfoSchema,
});
const projectSchema = z
  .object({
    id: z.string(),
    number: z.number().int(),
    title: z.string(),
    url: z.url(),
    fields: fieldsSchema,
  })
  .loose();
const ownerProjectsSchema = z
  .object({
    projectsV2: z.object({
      nodes: z.array(projectSchema.nullable()),
      pageInfo: pageInfoSchema,
    }),
  })
  .nullable()
  .optional();
const discoverySchema = z.object({
  repository: z.object({ id: z.string() }).nullable(),
  organization: ownerProjectsSchema,
  user: ownerProjectsSchema,
});
const projectFieldsPageSchema = z.object({
  node: z.object({ fields: fieldsSchema }).nullable(),
});
const fieldValueSchema = z
  .object({
    optionId: z.string().nullable(),
    name: z.string().nullable(),
    updatedAt: z.string(),
  })
  .nullable();
const contentSchema = z
  .object({
    __typename: z.enum(["Issue", "PullRequest"]),
    number: z.number().int(),
    title: z.string(),
    url: z.url(),
  })
  .loose()
  .nullable();
const itemSchema = z.object({
  id: z.string(),
  updatedAt: z.string(),
  content: contentSchema,
  fieldValueByName: fieldValueSchema,
});
const projectItemsPageSchema = z.object({
  node: z
    .object({
      items: z.object({
        nodes: z.array(itemSchema.nullable()),
        pageInfo: z.object({
          hasNextPage: z.boolean(),
          endCursor: z.string().nullable(),
        }),
      }),
    })
    .nullable(),
});
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
const graphqlEnvelopeSchema = z
  .object({
    data: z.unknown().optional(),
    errors: z.array(z.object({ message: z.string() }).loose()).optional(),
  })
  .loose();

export type Repository = z.infer<typeof repositorySchema>;
export type ProjectItem = z.infer<typeof itemSchema>;
export type Pull = z.infer<typeof pullSchema>;
export type Comment = z.infer<typeof commentSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type CheckRun = z.infer<typeof checkRunSchema>;
export type CombinedStatus = z.infer<typeof combinedStatusSchema>;
export interface GitHubDiscovery {
  login: string;
  projects: Array<{
    id: string;
    number: number;
    title: string;
    url: string;
    fields: Array<{
      id: string;
      name: string;
      options: Array<{ id: string; name: string }>;
    }>;
  }>;
}

export interface GitHub {
  login(): Promise<string>;
  repository(owner: string, name: string): Promise<Repository>;
  discover(owner: string, repositoryName: string): Promise<GitHubDiscovery>;
  projectItems(projectId: string, fieldName: string): Promise<ProjectItem[]>;
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
  let token: string | undefined;
  let account: string | undefined;

  async function authenticate() {
    if (token) return token;
    const result = await run(
      "gh",
      ["auth", "token", "--hostname", options.hostname],
      { signal, maxBuffer: 1024 * 1024 },
    );
    token = result.stdout.trim();
    if (token.length === 0)
      throw new Error("gh returned an empty GitHub token");
    return token;
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
      if (response.status === 401) token = undefined;
      const apiMessage = z
        .object({ message: z.string() })
        .loose()
        .safeParse(body);
      throw new Error(
        `GitHub ${response.status.toString()}: ${apiMessage.success ? apiMessage.data.message : response.statusText}`,
      );
    }
    return schema.parse(body);
  }

  async function graphql<T>(
    schema: z.ZodType<T>,
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const envelope = await request(graphqlEnvelopeSchema, options.graphqlUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    if (envelope.errors && envelope.errors.length > 0)
      throw new Error(
        `GitHub GraphQL: ${envelope.errors.map((error) => error.message).join("; ")}`,
      );
    return schema.parse(envelope.data);
  }

  async function login() {
    if (account) return account;
    account = (await request(userSchema, endpoint(options.restBaseUrl, "user")))
      .login;
    return account;
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

  async function discover(owner: string, repositoryName: string) {
    const query = `query Discover($owner: String!, $repository: String!, $organizationAfter: String, $userAfter: String, $includeOrganization: Boolean!, $includeUser: Boolean!) {
      repository(owner: $owner, name: $repository) { id }
      organization(login: $owner) @include(if: $includeOrganization) { projectsV2(first: 100, after: $organizationAfter) { nodes { id number title url fields(first: 100) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } pageInfo { hasNextPage endCursor } } } pageInfo { hasNextPage endCursor } } }
      user(login: $owner) @include(if: $includeUser) { projectsV2(first: 100, after: $userAfter) { nodes { id number title url fields(first: 100) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } pageInfo { hasNextPage endCursor } } } pageInfo { hasNextPage endCursor } } }
    }`;
    const fieldsQuery = `query ProjectFields($project: ID!, $after: String!) {
      node(id: $project) { ... on ProjectV2 { fields(first: 100, after: $after) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } pageInfo { hasNextPage endCursor } } } }
    }`;
    const projects: Array<z.infer<typeof projectSchema>> = [];
    let organizationAfter: string | null = null;
    let userAfter: string | null = null;
    let includeOrganization = true;
    let includeUser = true;

    function nextCursor(pageInfo: z.infer<typeof pageInfoSchema>) {
      if (!pageInfo.hasNextPage) return null;
      if (!pageInfo.endCursor)
        throw new Error("GitHub pagination returned no next cursor");
      return pageInfo.endCursor;
    }

    do {
      const result = await graphql(discoverySchema, query, {
        owner,
        repository: repositoryName,
        organizationAfter,
        userAfter,
        includeOrganization,
        includeUser,
      });
      if (!result.repository)
        throw new Error(`Repository ${owner}/${repositoryName} was not found`);
      if (includeOrganization) {
        const connection = result.organization?.projectsV2;
        if (!connection) includeOrganization = false;
        else {
          for (const project of connection.nodes)
            if (project) projects.push(project);
          organizationAfter = nextCursor(connection.pageInfo);
          includeOrganization = organizationAfter !== null;
        }
      }
      if (includeUser) {
        const connection = result.user?.projectsV2;
        if (!connection) includeUser = false;
        else {
          for (const project of connection.nodes)
            if (project) projects.push(project);
          userAfter = nextCursor(connection.pageInfo);
          includeUser = userAfter !== null;
        }
      }
    } while (includeOrganization || includeUser);

    const discovered = [];
    for (const project of projects) {
      const fields = [...project.fields.nodes];
      let after = nextCursor(project.fields.pageInfo);
      while (after !== null) {
        const page: z.infer<typeof projectFieldsPageSchema> = await graphql(
          projectFieldsPageSchema,
          fieldsQuery,
          { project: project.id, after },
        );
        if (!page.node)
          throw new Error(`GitHub Project ${project.id} was not found`);
        fields.push(...page.node.fields.nodes);
        after = nextCursor(page.node.fields.pageInfo);
      }
      discovered.push({
        id: project.id,
        number: project.number,
        title: project.title,
        url: project.url,
        fields: fields.flatMap((field) =>
          field?.options
            ? [
                {
                  id: field.id,
                  name: field.name,
                  options: field.options,
                },
              ]
            : [],
        ),
      });
    }
    return { login: await login(), projects: discovered };
  }

  async function projectItems(projectId: string, fieldName: string) {
    const query = `query ProjectItems($project: ID!, $field: String!, $after: String) {
      node(id: $project) { ... on ProjectV2 { items(first: 100, after: $after) { nodes { id updatedAt content { __typename ... on Issue { number title url } ... on PullRequest { number title url } } fieldValueByName(name: $field) { ... on ProjectV2ItemFieldSingleSelectValue { optionId name updatedAt } } } pageInfo { hasNextPage endCursor } } } }
    }`;
    const items: ProjectItem[] = [];
    let after: string | null = null;
    do {
      const page: z.infer<typeof projectItemsPageSchema> = await graphql(
        projectItemsPageSchema,
        query,
        {
          project: projectId,
          field: fieldName,
          after,
        },
      );
      if (!page.node)
        throw new Error(`GitHub Project ${projectId} was not found`);
      items.push(...page.node.items.nodes.filter((item) => item !== null));
      after = page.node.items.pageInfo.hasNextPage
        ? page.node.items.pageInfo.endCursor
        : null;
    } while (after !== null);
    return items;
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
    discover,
    projectItems,
    pulls,
    issueComments,
    reviewComments,
    reviews,
    checkRuns,
    combinedStatus,
  };
}
