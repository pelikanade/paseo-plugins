# Paseo nstack

Terms for linking Paseo workspaces to GitHub repositories and starting nstack orchestration from issue workflow states and repository activity.

## Language

**Paseo project**:
A sidebar grouping that contains one or more workspaces and represents a repository or directory known to Paseo.
_Avoid_: Workspace, repository

**Paseo workspace**:
One working context within a Paseo project, backed by a directory or worktree and containing its own agents, terminals, and tabs.
_Avoid_: Project, repository

**Workflow state**:
An nstack issue's stage of work, expressed by one canonical workflow label: Backlog, Ready, In progress, In review, Merge queue, Blocked / HITL, or Done.
_Avoid_: Status field, column

**Binding**:
A saved association between one Paseo workspace and one GitHub repository.
_Avoid_: Link, connection, project setup

**Signal**:
A GitHub change or timed repair check that may require one orchestrator agent.
_Avoid_: Trigger, event

**Handled signal**:
A signal whose orchestrator-agent start has already been accepted, identified consistently across repeated checks.
_Avoid_: Deduplicated event, processed trigger

**Orchestrator agent**:
A fresh Paseo agent responsible for applying nstack orchestration to one signal.
_Avoid_: Seat, pump, worker

**Pause**:
A state that prevents new orchestrator agents while retaining bindings and history.
_Avoid_: Disable, stop watching

**Repair check**:
A recurring signal that asks the orchestrator to find missed or stale work.
_Avoid_: Sweep, cleanup run
