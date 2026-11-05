---
name: om-run-harness-evals
description: Run or inspect Open Mercato harness evaluations and monitor registered experiments with the local dashboard. Use for "run harness evals", "inspect experiment results", "compare eval runs", "uruchom ewaluacje harnessu", or "sprawdź wyniki eksperymentu".
---

# Run Harness Evals

Run the requested harness scope or inspect an existing experiment, then report every selected case with its actual outcome and available evidence. This repository-local operator skill does not ship into generated apps.

## Arguments

- A request to start a new evaluation, or one or more existing experiment directories to inspect.
- Optional case/lane selection, runner/model, and dashboard port. Resolve omissions from existing run metadata and canonical harness documentation; do not invent a provider adapter.
- Inspection is the default when the request points to existing results. A dashboard registration starts only an observer.

## Workflow

0. **Load setup** — read `references/agentic-setup.md` and `references/rules.md` on every invocation.
   This skill uses no pipeline configuration variables or tracker operations.
1. **Identify the scope.** Read root `AGENTS.md`, `packages/create-app/AGENTS.md`, and the existing run metadata. Distinguish a requested new run from inspecting an existing run before launching anything. Record the selected cases/lanes and intended denominator, including not-yet-evaluated cases.
2. **Inspect existing results.** Reuse a known dashboard or register the supplied directories with `yarn experiments:dashboard --experiment <directory>` (repeat for comparison; use `--port 0` if needed). Follow `scripts/experiment-dashboard/README.md` from the repository root for the producer/artifact contract and API. Do not invoke an evaluator, prepare fixtures, restart jobs, or change source results on this branch.
3. **Start a new run only when requested.** Read the actual standalone harness README and relevant runner instructions under `packages/create-app/agentic/shared/ai/harness/`. Use the canonical commands and supported options in the selected scaffold; preserve its isolation, acknowledgement, prerequisites, and certification gates. Record the exact runner/model and scope before launching. If a requested local model needs an unsupported adapter, explain that limitation and keep custom experimentation separately identified; do not present it as a certified lane.
4. **Observe progress.** Register the run's existing result directory without interrupting its producer. Use fresh snapshots to distinguish pending, running, pass, fail, blocked, error, skipped, and not-applicable. Treat stale metadata, absent counters, partial artifacts, and unknown process state explicitly. Never infer completion or liveness from file existence.
5. **Inspect evidence.** Open representative passing and failing cases plus every unavailable/error category. Check retained visible responses, generated files, tool activity, and evaluator diagnostics. Keep structured decisions separate from original responses. Do not alter grading, assertions, source captures, or case scope to improve a score or satisfy the dashboard.
6. **Report all selected cases.** Use `references/report-template.md`, link the local dashboard to the user, and retain a local report when requested. Give counts with denominators, per-case outcomes and evidence availability, remaining work, exact runner/model, and certification limits. Sanitize any report destined for the repository or a PR; leave raw artifacts local.

## Rules

- Preserve running experiments. Starting an observer never authorizes another model run or process control.
- Read `packages/create-app/agentic/shared/ai/skills/om-evolve-harness/references/knowledge-change.md` before changing harness knowledge, grading, runner contracts, or coverage. Use `om-refresh-standalone-harness` only for its explicit release-range workflow; observation does not satisfy either workflow's gates.
- Keep the tool README authoritative for snapshot and artifact formats; do not introduce a parallel result schema in this skill.
- Shared rules: `references/rules.md`.
