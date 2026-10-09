import type { Binding, PanelState } from "../shared/contracts";
import type { GitHub } from "./github";
import type { Signal, WorkspaceState } from "./state";

export interface Collection {
  signals: Signal[];
  cursors: Record<string, string>;
  counts: PanelState["counts"];
  attention: PanelState["attention"];
  login: string;
}

function issueNumber(url: string | undefined) {
  if (!url) return null;
  const match = /\/(?:issues|pulls)\/(\d+)(?:$|\/)/.exec(url);
  return match ? Number(match[1]) : null;
}

function signal(
  key: string,
  kind: Signal["kind"],
  subject: string,
  url: string | null,
  observedAt: string,
  actor: string | null,
  data: Record<string, string>,
): Signal {
  return { key, kind, subject, url, observedAt, actor, data };
}

export async function collectSignals(
  github: GitHub,
  binding: Binding,
  workspace: WorkspaceState,
  repairDueAt: string | null,
  now: string,
): Promise<Collection> {
  const owner = binding.repository.owner;
  const repository = binding.repository.name;
  const cursors = { ...workspace.cursors };
  const signals: Signal[] = [];
  const closedSince = cursors["pulls:closed-since"] ?? null;
  const [login, repositoryInfo, items, pulls] = await Promise.all([
    github.login(),
    github.repository(owner, repository),
    github.projectItems(binding.project.id, binding.statusField.name),
    github.pulls(owner, repository, closedSince),
  ]);
  cursors["pulls:closed-since"] = now;
  const counts = {
    ready: 0,
    building: 0,
    reviewing: 0,
    mergeQueue: 0,
    needsYou: 0,
  };
  const attention: PanelState["attention"] = [];

  for (const item of items) {
    const value = item.fieldValueByName;
    const content = item.content;
    if (!value?.name || !content) continue;
    const normalized = value.name.trim().toLowerCase();
    if (value.optionId === binding.readyValue.id) {
      counts.ready += 1;
      if (content.__typename === "Issue")
        signals.push(
          signal(
            `ready:${item.id}:${value.updatedAt}`,
            "ready",
            `Issue #${content.number.toString()} is Ready`,
            content.url,
            value.updatedAt,
            null,
            {
              issue: content.number.toString(),
              projectItem: item.id,
              status: value.name,
            },
          ),
        );
    } else if (normalized === "in progress") counts.building += 1;
    else if (normalized === "in review") counts.reviewing += 1;
    else if (normalized === "merge queue") {
      counts.mergeQueue += 1;
      attention.push({
        number: content.number,
        title: content.title,
        status: "merge_queue",
        detail: "Ready for your merge",
        url: content.url,
      });
    } else if (normalized === "blocked / hitl") {
      counts.needsYou += 1;
      attention.push({
        number: content.number,
        title: content.title,
        status: "needs_you",
        detail: "Needs your decision",
        url: content.url,
      });
    }
  }
  const reviewPulls = new Set<number>();

  for (const pull of pulls) {
    const cursorKey = `pull:${pull.number.toString()}`;
    const previous = Object.hasOwn(cursors, cursorKey)
      ? cursors[cursorKey]
      : undefined;
    const [
      previousState = "",
      previousHead = "",
      previousMerged = "",
      ,
      previousUpdated = "",
    ] = previous?.split("|") ?? [];
    const current = [
      pull.state,
      pull.head.sha,
      pull.merged_at ?? "",
      pull.closed_at ?? "",
      pull.updated_at,
    ].join("|");
    cursors[cursorKey] = current;
    if (previous === undefined || previousUpdated !== pull.updated_at)
      reviewPulls.add(pull.number);
    if (!workspace.initialized) continue;
    if (
      previous === undefined ||
      (previous.startsWith("closed|") && pull.state === "open")
    ) {
      signals.push(
        signal(
          `pr-opened:${pull.number.toString()}:${pull.created_at}`,
          "pr_opened",
          `PR #${pull.number.toString()} opened`,
          pull.html_url,
          pull.created_at,
          null,
          { pull: pull.number.toString(), headSha: pull.head.sha },
        ),
      );
      continue;
    }
    if (pull.merged_at && pull.merged_at !== previousMerged) {
      signals.push(
        signal(
          `pr-merged:${pull.number.toString()}:${pull.merged_at}`,
          "pr_merged",
          `PR #${pull.number.toString()} merged`,
          pull.html_url,
          pull.merged_at,
          null,
          { pull: pull.number.toString(), headSha: pull.head.sha },
        ),
      );
    } else if (previousState === "open" && pull.state === "closed") {
      signals.push(
        signal(
          `pr-closed:${pull.number.toString()}:${pull.closed_at ?? pull.updated_at}`,
          "pr_closed",
          `PR #${pull.number.toString()} closed`,
          pull.html_url,
          pull.closed_at ?? pull.updated_at,
          null,
          { pull: pull.number.toString(), headSha: pull.head.sha },
        ),
      );
    } else if (previousHead !== pull.head.sha) {
      signals.push(
        signal(
          `pr-updated:${pull.number.toString()}:${pull.head.sha}`,
          "pr_updated",
          `PR #${pull.number.toString()} has a new head`,
          pull.html_url,
          pull.updated_at,
          null,
          { pull: pull.number.toString(), headSha: pull.head.sha },
        ),
      );
    }
  }

  const refs = new Map<string, string>();
  const defaultStatus = await github.combinedStatus(
    owner,
    repository,
    repositoryInfo.default_branch,
  );
  refs.set("default", defaultStatus.sha);
  for (const pull of pulls)
    if (pull.state === "open")
      refs.set(`pr:${pull.number.toString()}`, pull.head.sha);
  for (const [scope, sha] of refs) {
    const aggregate =
      scope === "default"
        ? defaultStatus
        : await github.combinedStatus(owner, repository, sha);
    const runs = await github.checkRuns(owner, repository, sha);
    const aggregateKey = `ci-status:${scope}`;
    const aggregateFingerprint = `${aggregate.sha}|${aggregate.state}|${aggregate.total_count.toString()}`;
    if (
      workspace.initialized &&
      Object.hasOwn(cursors, aggregateKey) &&
      cursors[aggregateKey] !== aggregateFingerprint &&
      aggregate.state !== "pending"
    )
      signals.push(
        signal(
          `ci-status:${scope}:${aggregate.sha}:${aggregate.state}`,
          "ci",
          `${scope === "default" ? "Default branch" : `PR #${scope.slice(3)}`} CI ${aggregate.state}`,
          null,
          now,
          null,
          { scope, sha: aggregate.sha, result: aggregate.state },
        ),
      );
    cursors[aggregateKey] = aggregateFingerprint;
    for (const run of runs) {
      const runKey = `check-run:${run.id.toString()}`;
      const fingerprint = `${run.head_sha}|${run.status}|${run.conclusion ?? ""}|${run.completed_at ?? ""}`;
      if (
        workspace.initialized &&
        Object.hasOwn(cursors, runKey) &&
        cursors[runKey] !== fingerprint &&
        run.status === "completed"
      )
        signals.push(
          signal(
            `check-run:${run.id.toString()}:${run.head_sha}:${run.conclusion ?? "none"}`,
            "ci",
            `${run.name} ${run.conclusion ?? "completed"}`,
            run.html_url,
            run.completed_at ?? now,
            null,
            {
              scope,
              sha: run.head_sha,
              check: run.name,
              result: run.conclusion ?? "completed",
            },
          ),
        );
      cursors[runKey] = fingerprint;
    }
  }

  const previousCommentCheck = cursors["comments:since"];
  cursors["comments:since"] = now;
  if (workspace.initialized && previousCommentCheck) {
    const [issueComments, inlineComments] = await Promise.all([
      github.issueComments(owner, repository, previousCommentCheck),
      github.reviewComments(owner, repository, previousCommentCheck),
    ]);
    for (const comment of [...issueComments, ...inlineComments]) {
      if (comment.user.login !== login) continue;
      const number = issueNumber(comment.issue_url ?? comment.pull_request_url);
      const command = /^\/?(drain|review|retry|park|approve\s+A\d+)\b/i.exec(
        comment.body.trim(),
      );
      signals.push(
        signal(
          `comment:${comment.id.toString()}`,
          command ? "command" : "human_feedback",
          command
            ? `Human command: ${command[1]}`
            : `Human feedback${number ? ` on #${number.toString()}` : ""}`,
          comment.html_url,
          comment.updated_at,
          login,
          {
            body: comment.body,
            ...(number ? { pull: number.toString() } : {}),
          },
        ),
      );
    }
    for (const pull of pulls) {
      if (!reviewPulls.has(pull.number)) continue;
      for (const review of await github.reviews(
        owner,
        repository,
        pull.number,
      )) {
        if (
          review.user.login !== login ||
          !review.submitted_at ||
          review.submitted_at <= previousCommentCheck
        )
          continue;
        signals.push(
          signal(
            `review:${review.id.toString()}:${review.submitted_at}`,
            "human_feedback",
            `Human review on PR #${pull.number.toString()}`,
            review.html_url,
            review.submitted_at,
            login,
            {
              pull: pull.number.toString(),
              body: review.body ?? "",
              state: review.state,
              headSha: pull.head.sha,
            },
          ),
        );
      }
    }
  }

  if (repairDueAt)
    signals.push(
      signal(
        `repair:${binding.workspaceId}:${repairDueAt}`,
        "repair",
        "Repair check",
        binding.project.url,
        repairDueAt,
        null,
        {},
      ),
    );

  return { signals, cursors, counts, attention, login };
}
