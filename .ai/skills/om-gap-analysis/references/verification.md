# Phase 2 — Verification (the gated batch loop)

The full Phase-2 procedure: for every `status: pending` story, dispatch a read-only subagent to investigate the platform, then **gate** its findings before writing them into the MD. `<skill-dir>` below is this skill's install directory; run every command from the repository root.

## Preconditions (all three, in order)

1. **`bin/gap-orientation-preflight` returns 0** — it validates and hard-freshens the local checkouts, printing exactly two stdout lines on success:

   ```bash
   <skill-dir>/bin/gap-orientation-preflight \
     --repo "$PLATFORM_REPO" --branch "$PLATFORM_BRANCH" \
     ${PLATFORM_COMPANION_REPO:+--companion-repo "$PLATFORM_COMPANION_REPO"} \
     ${PLATFORM_CANDIDATES:+--candidates "$PLATFORM_CANDIDATES"} \
     ${PLATFORM_COMPANION_CANDIDATES:+--companion-candidates "$PLATFORM_COMPANION_CANDIDATES"} \
     ${PLATFORM_CLONE_URL:+--clone-url "$PLATFORM_CLONE_URL"} \
     ${PLATFORM_COMPANION_CLONE_URL:+--companion-clone-url "$PLATFORM_COMPANION_CLONE_URL"}
   ```

   - **Line 1, `<REPO_ROOT>` (required).** A clean checkout of `platform.repo` on `platform.branch` — not a fork or feature-branch WIP — just fetched-and-fast-forwarded, with `HEAD` asserted equal to the remote tip. This checkout carries **three** jobs: code reading for orientation, merged-code verdict grounding (`bin/gap-validate-finding` greps it), and the platform's own routing/agent docs (`AGENTS.md` files read directly from it — never from a separately vendored copy, which is just a staler duplicate).
   - **Line 2, `<COMPANION_ROOT>` (best-effort).** The same validation for `platform.companionRepo` — a shipped capability there is real positive evidence, not just an open-PR signal. Prints the literal string `UNAVAILABLE` if this checkout couldn't be validated/provisioned (that alone never fails the preflight — a smaller, auxiliary repo being briefly unreachable shouldn't block the run); `bin/gap-validate-finding` then correctly fails only the specific findings that actually needed it.

   Orienting or grounding against fork/WIP code primes false positives; grounding against a stale checkout is a vendored snapshot with extra steps — which is why this preflight fetches and fast-forwards (and asserts `HEAD` equality, not just that a fast-forward was possible) rather than noting staleness. **exit 1** → stop, dispatch nothing, relay the preflight's stderr to the user verbatim — it names the concrete fix. **exit 2** → transient clone/fetch failure; wait ~60s and re-run.

2. **Pipeline channel reachable** — run the tracker's **repo-info** operation against `platform.repo` (and `platform.companionRepo` when configured), each with the explicit `{repo}` argument. Any failure → **stop, dispatch nothing**, and surface the tracker's error (most commonly auth: the descriptor's **auth-check** names the fix). This channel feeds the **Upstream pipeline** field only — it never grounds a verdict — so reachability is all it needs; but starting Phase 2 on a dead channel would silently under-report the pipeline signal on every story.

3. **`bin/gap-checklist-gate` returned 0 in Phase 1.5.** Do not enter Phase 2 on a tree that has not passed the completeness gate.

## Architecture: orchestrator + subagents + gate

- **You are the orchestrator.** You parse the MD, dispatch the investigation subagents in one message, **validate each returned block through `bin/gap-validate-finding`**, edit the MD, update statuses. You do **not** explore the codebase yourself.
- **Subagents** are read-only investigators (one story each). They do not edit files. They propose the grounding query; they do not need to be trusted on whether they ran it.
- **The gate** (`bin/gap-validate-finding`) is the structural surface *outside each subagent's model loop*. This is load-bearing: prose rules in a subagent prompt do **not** bind it against fabrication-shape failures. The gate must verify the *goal* (a story-grounded verdict), not a *proxy* (a query↔verdict agreement a strawman query satisfies) — the `--story` token guard re-ties it to the goal.

## Steps

0. **Preflights — the first action in Phase 2.** Run the three preconditions above. Capture `<REPO_ROOT>` and `<COMPANION_ROOT>` from the orientation preflight's stdout.

1. **Fetch the Upstream-pipeline snapshot once, for the whole run — never per-story.** The orchestrator is the sole tracker caller for this channel, exactly once, regardless of story count (see "Why the snapshot is fetched once" below). Build `.ai/tmp/om-gap-analysis/pipeline-snapshot-<project>.md` from three parts:

   - `## Open PRs — platform (<platform.repo>)` — the tracker's **list-prs** operation against `platform.repo` (explicit `{repo}` argument), state open, limit 100, requesting the **widened field list**: `number,title,additions,deletions,changedFiles,reviewDecision,isDraft,updatedAt` — the depth fields ride the same single call at zero marginal cost. One line per PR:
     `- PR #<number>: <title> [+<additions>/-<deletions>, <changedFiles> files, <DRAFT | reviewDecision | no review yet>, updated <updatedAt>]`
   - `## Open PRs — companion (<platform.companionRepo>)` — the same call against the companion repo (when configured), lines prefixed `- companion PR #<number>: …`.
   - `## Planned specs — <platform.specsPath> (platform@<platform.branch>)` — a plain listing of `*.md` files in `<REPO_ROOT>/<platform.specsPath>` read from the validated local checkout (no tracker call needed — the checkout is already fresh), one `- <filename>` per line.

   If the tracker cannot supply the depth fields, fall back to `number,title` lines and say so in the run report — depth-dependent checks then degrade honestly (the depth gate's size half has nothing to read).

   Pass this file's path to every subagent as `<PIPELINE_SNAPSHOT>`. Subagents match their story's domain against it themselves (semantic judgment, not a mechanical grep) — they never call the tracker.

2. **Load the MD.** Parse frontmatter + tree. List `status: pending` stories. Set `phase: 2-verifying`.

3. **Dispatch all `pending` investigation subagents in one message.** No hand-counted batching — the agent runtime bounds its own concurrency. Each subagent gets one story (the prompt template in `references/subagent-prompt.md`) and returns a findings block in that template's schema.

4. **Gate the returned blocks — one at a time — before writing each.** For each, write the story's title + acceptance criteria to a temp file and pass it with `--story`; pass `<REPO_ROOT>` with `--repo-root`, `<COMPANION_ROOT>` with `--companion-root` whenever it isn't `UNAVAILABLE`, and the tier map (when `platform.tierMap` is configured, materialized as a `<path-prefix> <tier>` lines file) with `--tier-map`:

   ```bash
   printf '%s\n' "$STORY_TITLE_AND_CRITERIA" > .ai/tmp/om-gap-analysis/story-<id>.txt
   GATE_ARGS=(--repo-root "$REPO_ROOT" --story .ai/tmp/om-gap-analysis/story-<id>.txt)
   [ "$COMPANION_ROOT" != "UNAVAILABLE" ] && GATE_ARGS+=(--companion-root "$COMPANION_ROOT")
   [ -n "$TIER_MAP_FILE" ] && GATE_ARGS+=(--tier-map "$TIER_MAP_FILE")
   printf '%s\n' "$BLOCK" | <skill-dir>/bin/gap-validate-finding <story-id> "${GATE_ARGS[@]}"
   ```

   The gate **requires** the story to ground a `❌ Missing` (without it, it cannot prove the grounding query references the story rather than a strawman), and **always re-runs every grounded verdict** — there is no shape-trust exemption for any `Grounding source` (a local search costs nothing).

   - **exit 0 (PASS)** → write the block into the story's `#### Gap analysis`, flip `**Status**` to `done`, set `**Investigated**`. Stdout carries `CRITERIA: <covered>/<total>` (the criteria-derived fraction the gate verified against the block's own rows) and, for a positive verdict, `TIER: <tier>` — record both on the verdict line: `🟡 Partial (2/4, core)` / `✅ Implemented (3/3, licensed)`. Both are gate-derived, never subagent-claimed; tier partitions the covered set (the summary splits the headline by it) and neither changes *whether* something is covered.
   - **exit 1 (FAIL)** → do **not** write. Mark `**Status**: needs-review`, re-dispatch *once* with a reinforced prompt (echo the gate's stderr reason into the retry). If it fails again, leave `needs-review` and move on.

5. **Report progress** briefly: "X/Y done, Z needs-review."

6. **Resumability**: a story already `done` at phase-2 start is skipped.

7. **Cross-check the Upstream-pipeline citations — once, at the Phase 2→3 transition.** When all stories are `done` or `needs-review`:

   ```bash
   <skill-dir>/bin/gap-pipeline-crosscheck .ai/gap-analysis/<project>.md .ai/tmp/om-gap-analysis/pipeline-snapshot-<project>.md
   ```

   Why this exists: the field's *content* is the only per-story output decided purely by each subagent's isolated judgment against a one-line PR title — `bin/gap-validate-finding` checks its *shape* only, by design. Rare per-call variance multiplied by ~90+ independent calls per run keeps producing a handful of misses regardless of prompt quality — so the backstop is deterministic and orchestrator-side, never a "try harder" prompt rewrite.

   - **exit 0** → proceed to step 8.
   - **exit 1** → the stdout report lists each flagged story — a **missing** citation (cites nothing while above-threshold candidates exist; the ranked candidate list follows) or a **phantom** one (cites a value found nowhere in the snapshot). Review each row — this is the semantic judgment the script deliberately does not make: hand-edit the story's `**Upstream pipeline**` field where a flag is real; dismiss it where the lexical overlap is coincidental (a legitimate outcome — note dismissals briefly, do not loop until exit 0). **Never auto-apply; never touch Verdict, Evidence, Effort, or Gaps.**
   - **exit 2** → wrong file or bad invocation (fails closed rather than passing vacuously); fix and re-run.

8. **Fetch review bodies for significant reviewed PRs — one bounded pass.** For each *distinct* PR that (a) is cited by any story and (b) has actually been human-reviewed per the snapshot (`APPROVED` / `CHANGES_REQUESTED` — `REVIEW_REQUIRED` is the un-discriminating default of every open PR in a review-gated repo, not a signal), fetch its review discussion once via the tracker's **get-pr** operation (its field list includes the reviews) — the one thing the list call structurally cannot carry. This rides the same "once, not per-story" shape as the snapshot; it is bounded by the count of distinct reviewed PRs cited across the tree. The review text feeds Phase 3's summary (what state the PR is actually in — "close, narrow fixes pending" reads very differently from a bare open tag). Then set `phase: 3-synthesizing` and flow into Phase 3 (`references/synthesis.md`).

## Why the snapshot is fetched once — not per-story

Step 3 dispatches *all* pending subagents in one message; anything they fetched directly would race the host's rate limiters in a parallel burst. Verdict grounding has no such exposure (it's a local search against `<REPO_ROOT>`), but the pipeline signal would reacquire it if fetched per-story: dozens of parallel list-PR calls is exactly the burst shape secondary rate limiters trip on. Fetching the snapshot once, before any subagent is dispatched, sidesteps this entirely — subagents read a static file, they never call the tracker.

**Validation (step 4) stays sequential, one story at a time — for a plainer reason.** With grounding local and the snapshot pre-fetched, there is no shared external resource left to protect; sequential processing keeps the resumable per-story `**Status**` field consistent one story at a time. If you parallelize this loop, nothing external breaks — it just isn't necessary.

## Currency: atomic commits, never T-shirt sizes

Effort is an **atomic-commit score 0–5** — one self-contained, testable increment that a single focused loop can deliver. Do **not** use XS/S/M/L/XL and never person-days; the gate rejects T-shirt sizes.

| Score | Meaning |
|---|---|
| 0 | Platform does it, zero commits |
| 1 | 1 commit: config/seed only |
| 2 | 1–2 commits: small gap |
| 3 | 2–3 commits: medium gap |
| 4 | 3–5 commits: large gap |
| 5 | 5+ commits or external dependency |

**FLAG** any story whose plan means contributing to the platform or a shared module rather than the app — those carry upstream dependencies (an upstream PR + approval before the phase can ship).

## Source-of-evidence rule (verdict-conditional)

| Use | Allowed source |
|---|---|
| **Routing** — which module/area to look at, where a feature would live | the platform's own agent/routing docs (`AGENTS.md` and per-module equivalents), read directly from `<REPO_ROOT>` |
| **Code-level orientation** — read real entities/routes/UI to sanity-check a positive | `<REPO_ROOT>` (platform) or `<COMPANION_ROOT>`, whichever the story's domain points to |
| **✅/🟡 verdict evidence — platform capability** | a local `git grep`/`rg` hit in `<REPO_ROOT>`, re-run by `bin/gap-validate-finding` |
| **✅/🟡 verdict evidence — shipped in the companion repo** | a local hit in `<COMPANION_ROOT>`, re-run the same way (`Grounding source: companion`) — a real, merged module there is genuine coverage, not merely the Upstream-pipeline signal below |
| **❌ Missing verdict evidence** | a local search in the relevant checkout returning no match, re-run and confirmed by the gate, **always**. Never "I didn't see it" without the re-run. |
| **Upstream pipeline** (an *open, unmerged* PR on either repo / a planned spec — supplementary, never verdict-altering) | the one-time snapshot the orchestrator fetched in step 1 — never a per-story tracker call |
| **Auditing the local app's own code** (implementation phase) | local Glob/Grep, only here |

In one line: **the validated checkouts carry routing, orientation, AND every verdict's grounding, unconditionally; the tracker narrows to one orchestrator-only bulk fetch for the Upstream-pipeline signal plus one bounded review-body pass.**

## What the gate does NOT do (scope it honestly)

The gate is an asymmetric **falsifier**, not a truth oracle. Record these as known gaps; do not let a green run read as "everything verified":

1. **Falsifier, not confirmer.** A search hit proves a string matches — not that the matched code satisfies the story's acceptance criteria. A positive pointing at real-but-irrelevant code passes clean. Semantic judgment stays with the subagent. *This is the one residual semantic hole.*
2. **Strawman queries — closed on the `❌` path.** The gate re-runs *the query the subagent named*, and rejects any verdict whose grounding query shares no noun token with the story title/criteria. What it still can't catch is a *plausibly-related-but-too-narrow* query — the token overlaps, so it passes, but the search misses. That narrower case collapses into hole 1 (semantic relevance), not a free strawman.
3. **The integration branch can contain unreleased code.** A verdict grounded in either checkout proves the capability exists on that branch — not that it has shipped in a tagged release. The orientation preflight surfaces this at the run level (how far the branch sits ahead of the default branch, when the clone's history allows the count) rather than per-finding — coarse but honest.
4. **The tier map settles only what its prefixes name.** License-tier tagging is deterministic from hit paths, but a repo whose paid/free boundary is not path-visible needs its map maintained; per-module licensing inside a companion repo is a per-engagement calibration, like the depth threshold.

A separate failure — a **stale or wrong checkout** — is not a per-finding hole this gate can see: it trusts whatever roots it's handed. It is closed one step earlier by `bin/gap-orientation-preflight`, which validates each checkout's remote and branch and hard-fetches it fresh before anything is dispatched. Another — a **dead pipeline channel** — cannot corrupt a verdict (that field is never verdict-altering) but would silently under-report the pipeline signal; it is closed by the **repo-info** reachability precondition. A third — a subagent that reads the snapshot but fails to *cite* the matching entry — is caught by `bin/gap-pipeline-crosscheck` at the phase transition. A fourth — a significant cited PR that never reaches the client-facing summary — is caught after synthesis by `bin/gap-depth-check` (`references/synthesis.md`).
