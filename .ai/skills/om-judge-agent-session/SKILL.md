> **Repo-local override.** Points the base skill at Open Mercato's review checklist, code-review extension, and harness-result schemas; the concrete project guards live in `.ai/judge-criteria.md`.

## Step 0 — project rules (add)

- This repository has no `CODE_REVIEW.md`; read `.ai/review-checklist.md` in its place.
- The judge criteria (project guards, dependency provenance, design system) are in `.ai/judge-criteria.md`, the default `judge.criteria` path.

## Step 1 — harness results (add)

Harness results come from the standalone-app agent harness that `create-mercato-app` emits. Read the result schemas from `packages/create-app/agentic/shared/ai/harness/` (`result.schema.json`, `generated-code-review-result.schema.json`, `release-result.schema.json`), or from `.ai/harness/` inside a generated app; never guess the shape.

## Step 4 — code review (add)

Apply `om-code-review` together with its repo-local extension `.ai/skills/om-code-review/SKILL.md` (layer classification, severity mapping).
