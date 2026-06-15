# Proposal Intake (optional)

> This file is present only when the collaborative proposal skills (`om-proposal` /
> `om-brainstorm`) are installed. When present, `om-spec-writing` consumes a matching proposal as
> the starting brief. When absent, spec-writing proceeds normally — the guarded step is a no-op.

## When to apply

Before initializing the spec file (Workflow Step "Load Context" / "Initialize"), check whether the
work being spec'd already has a proposal.

## Procedure

1. **Locate** a matching proposal under `.ai/proposals/**/<slug>.md` (check both the root folder
   and `.ai/proposals/ready/`). Match by topic/slug; if several look relevant, ask the user which.
   If none exists, skip the rest of this procedure.
2. **Read** the proposal's `## For the spec` (the agreed brief) and `## Findings` (decisions and
   rationale). Use them to seed the spec's TLDR, Problem Statement, and Proposed Solution instead
   of starting from scratch.
3. **Carry forward open questions**: any item in the proposal's `## Open Questions` still marked
   `open` or `deferred` becomes a candidate for the spec's **Open Questions** gate (Skeleton step).
   Do not silently assume answers the proposal explicitly deferred.
4. **Reference** the proposal in the spec (e.g. "Derived from `.ai/proposals/ready/<slug>.md`") so
   the ideation trail is traceable.

## Rules

- MUST NOT resolve a question the proposal left `deferred` — surface it in the spec's Open Questions.
- MUST keep the proposal as the source of *intent*; the spec remains the source of *design*.
