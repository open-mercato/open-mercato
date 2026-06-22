# Agent Orchestrator — spec index

This folder holds the Agent Orchestrator design corpus, reorganized **2026-06-22** around
what has actually shipped. The feature is substantially implemented; these docs are split
into the implemented baseline, the roadmap (`next/`), and historical material (`archive/`).

> **Folder rename:** this directory was `agent-orchiestrator` (typo) and is now
> `agent-orchestrator`, matching the module id `agent_orchestrator`.

## Start here

- **[`00-IMPLEMENTED-BASELINE.md`](./00-IMPLEMENTED-BASELINE.md)** — the authoritative,
  code-grounded spec of everything that exists today: the propose-only contract, the two
  coexisting runtimes (in-process `defineAgent` + OpenCode file-defined agents), registry/SDK,
  skills, sub-agents, disposition, the `INVOKE_AGENT` workflow activity, data model, APIs, UI,
  ACL, events, examples, and tests. **Build on this.**
- **Live OpenCode work** (outside this folder): the OpenCode file-defined-agents feature is
  specified in [`../2026-06-22-opencode-file-defined-agents.md`](../2026-06-22-opencode-file-defined-agents.md)
  and its [`../2026-06-22-opencode-file-defined-agents-phase0-findings.md`](../2026-06-22-opencode-file-defined-agents-phase0-findings.md)
  (the locked implementation contract).
- **Code:** `packages/core/src/modules/agent_orchestrator/` (+ its `AGENTS.md`), the generator
  at `packages/cli/src/lib/generators/extensions/agent-files.ts`, and examples in
  `apps/mercato/src/modules/agent_examples/`.
- **House-style conventions** (still live): [`2026-06-19-agent-orchestrator-conventions.md`](./2026-06-19-agent-orchestrator-conventions.md).

## `next/` — roadmap overlays (not yet built)

Each overlay builds **on top of** the implemented baseline; align its entities/APIs/events with
the shipped module before implementing. Design backing for each lives in `next/gap-analysis/`.
Suggested implementation order (dependencies first):

| # | Overlay | Spec | Backing gaps |
|---|---------|------|--------------|
| 1 | **Runtime guardrails** — blocking pre/post-call safety (injection / PII / grounding / schema) | [`next/2026-06-19-agent-runtime-guardrails.md`](./next/2026-06-19-agent-runtime-guardrails.md) | gap-07, 08, 09 |
| 2 | **Trace + eval / metrics** — run traces, eval set, rollup metrics (unblocks 6 & 7) | [`next/2026-06-19-agent-trace-eval-capture.md`](./next/2026-06-19-agent-trace-eval-capture.md), [`next/2026-06-20-agent-eval-harness-and-metrics.md`](./next/2026-06-20-agent-eval-harness-and-metrics.md) | gap-04, 05 |
| 3 | **Context knowledge plane** — governed TDCR context bundles + doc-ingest/OCR | [`next/2026-06-19-agent-context-knowledge-plane.md`](./next/2026-06-19-agent-context-knowledge-plane.md) | gap-06, 10 |
| 4 | **Identity & on-behalf-of** — agents as principals, audited delegation, scoped creds | [`next/2026-06-19-agent-identity-and-on-behalf-of.md`](./next/2026-06-19-agent-identity-and-on-behalf-of.md) | gap-16 |
| 5 | **Dispatch + A2A** — route tasks to internal/pull/A2A runtimes (needs #4) | [`next/2026-06-19-agent-dispatch.md`](./next/2026-06-19-agent-dispatch.md) | gap-15 |
| 6 | **Lifecycle / deployment gating** — shadow/canary/autonomy ramp, eval-gated promotion (needs #2) | [`next/2026-06-19-agent-deployment-and-regression-gating.md`](./next/2026-06-19-agent-deployment-and-regression-gating.md) | gap-14 |
| 7 | **Compliance / AI-Act / DSAR / fairness** — explanation, contest, erasure (person-affecting agents) | [`next/2026-06-19-agent-decision-transparency-and-ai-act.md`](./next/2026-06-19-agent-decision-transparency-and-ai-act.md) | gap-11, 12, 13 |
| 8 | **Retention / archival** — partitioning + S3 archival, ≥6yr audit tiers | _(gap only)_ | gap-19 |
| + | **Operations UI (full cockpit)** — Admin KPIs + Engineer trace/eval inspector on the built cockpit (needs #2) | [`next/2026-06-19-agent-operations-ui.md`](./next/2026-06-19-agent-operations-ui.md) | — |

Before implementing any overlay, run the spec-writing / pre-implement skills and reconcile the
spec's assumptions against the shipped code (some specs predate the MVP-inversion and the
OpenCode work — treat the baseline doc + module as the source of truth on conflicts).

## `archive/` — historical, not a plan

- **`archive/as-built/`** — the MVP design that shipped (`agent-sdk`, hackathon sketch,
  `mvp/00-05`, the orchestration step & proposal/disposition keystone). Superseded as a *plan*
  by the baseline doc; kept as the as-built design record.
- **`archive/superseded/`** — decided or inverted framing: the program index (`SPEC-00`),
  `ADR-001` (engine decision, now implemented), the heavy `agent-orchestration-architecture`,
  the SDK simplification audit (its inversion is now reality), the OpenCode-vs-in-process
  runtime evaluation (decided + implemented both ways), the build-gaps tracker, the
  internal-runtime/capability-registry deep dive, and the already-built/decided gaps
  (01, 02, 03, 17, 18, 20).
- **`archive/mockups/`** — the HTML cockpit/architecture diagrams the built UI was based on.

The old `agent-orchestrator-specs.zip` and `.DS_Store` were removed (redundant binary / junk).

## Known follow-ups surfaced during the reorg

- ~~Duplicate agent id `deals.health_check`~~ — **fixed 2026-06-22**: the file-defined example
  was renamed to `deals.health_check_file` so it no longer collides with the in-process demo in
  `agent_orchestrator/ai-agents.ts` (which `loadFileAgents` was silently skipping).
- **`OPENCODE_VERSION` pin** and the installer's version env var are ASSUMPTION-to-verify against
  the running OpenCode image (see the phase-0 findings).
- **OpenCode-native sub-agent runs** are not yet recorded as nested `AgentRun` rows
  (`parent_run_id` is wired only for the in-process delegate path).
