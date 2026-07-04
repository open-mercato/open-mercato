---
name: om-auto-upgrade-0.4.10-to-0.5.0
description: Migrate a standalone Open Mercato app from framework 0.4.10 to 0.5.0. This release is the biggest Open Mercato release so far and bundles 250+ post-Hackathon fixes plus several important dependency upgrades, so this skill acts as the executable companion to the 0.5.0 upgrade notes. It mechanically applies the documented codemods for the 0.4.10 → 0.5.0 window — Meilisearch class rename, Stripe API-version typing, lucide-react brand-icon removals and metadata-icon safety fixes, react-markdown className wrap, cron-parser `CronExpressionParser.parse` rename, @simplewebauthn Uint8Array narrowing, react-email CLI rename, plus the Jest ESM allow-list. Runs inside the user's app, detects which patterns are actually in use, edits files in place, typechecks, and reports what was migrated and what still needs a human eye. Use when a user asks to "upgrade my Open Mercato project from 0.4.10 to 0.5.0", "bump open-mercato to 0.5.0", or "apply the 0.5.0 upgrade notes".
---

# auto-upgrade-0.4.10-to-0.5.0

Executable companion to the `0.4.10` → `0.5.0` upgrade notes. Detects which documented
codemods are actually in use in this standalone app, applies them in place, typechecks,
and reports what was migrated and what still needs a human eye.

## When to use

- User says: "upgrade Open Mercato from 0.4.10 to 0.5.0", "bump open-mercato to 0.5.0",
  "migrate my code for the new open-mercato version", "apply the 0.5.0 upgrade notes".
- After the user changes their `@open-mercato/*` pins from `0.4.10` to `0.5.0` and runs
  `yarn install`. This skill does NOT bump dependencies — that is the user's pinning decision.
- Not for other version windows or deferred majors (MikroORM `7`, TypeScript `6`, Awilix `13`) —
  see the When-NOT list in `instructions.md`.

## What it contains

A single linear upgrade procedure: gate checks → detection scan → apply codemods →
typecheck/test verification → report → out-of-scope flags. Covers ten codemods spanning
Meilisearch, Stripe, lucide-react, react-markdown, cron-parser, @simplewebauthn, and
react-email, plus the Jest ESM allow-list.

## Reference map — load what the task needs

| When | Load |
|------|------|
| Running the upgrade — arguments, codemod table with detect rules, full workflow (gate/scan/apply/verify/report), out-of-scope list, and rules | [`instructions.md`](instructions.md) |

## Non-negotiables

- Detect before editing: build a `PlannedEdits` plan, skip codemods with no matches, and
  confirm with the user unless an automatic run was explicitly requested.
- Every codemod is idempotent and minimal; if a pattern is not unambiguous, skip it and add
  it to the manual follow-up list. Never rewrite whole files for a targeted edit.
- Never touch `node_modules/`, `.yarn/`, `dist/`, `.next/`, `build/`, or regenerate `yarn.lock`.
- Verify with `yarn tsc --noEmit` (and `yarn test` when a Jest config exists); roll back any
  codemod that clearly breaks the typecheck. Always list the exact edited files in the report.
