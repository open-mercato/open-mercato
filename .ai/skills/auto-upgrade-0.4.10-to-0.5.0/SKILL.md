---
name: auto-upgrade-0.4.10-to-0.5.0
description: Migrate a downstream Open Mercato user codebase from 0.4.10 to 0.5.0. Executable companion to UPGRADE_NOTES.md — detects which codemod patterns are in use, applies them in place, typechecks, and reports what still needs human review. Triggers on "upgrade open-mercato to 0.5.0", "bump to 0.5.0", or "apply UPGRADE_NOTES migrations".
---

# auto-upgrade-0.4.10-to-0.5.0

Apply the Open Mercato 0.4.10 → 0.5.0 dependency-upgrade codemods to a user's downstream
repository. Paired with [`UPGRADE_NOTES.md`](../../../UPGRADE_NOTES.md) — this skill is the
executable companion to that document for this specific version window.

Context for this window:
- `0.5.0` is the biggest Open Mercato release so far
- it includes more than 250 fixes and improvements after the Hackathon in Sopot
- several important dependency upgrades landed in the same release, which is why
  `UPGRADE_NOTES.md` and this companion skill were added

## Scope

This skill operates on a **user's** Open Mercato app (the repo produced by `create-app`,
or any app that depends on `@open-mercato/*`). It does NOT modify anything inside
`packages/` — framework-side migrations are the job of the framework authors.

It applies the mechanical parts of the upgrade. It does NOT bump the `@open-mercato/*`
dependencies themselves — that is the user's pinning decision. Run this skill **after**
the user bumps their pin.

## When to use

- User says: "upgrade Open Mercato from 0.4.10 to 0.5.0", "bump open-mercato to 0.5.0",
  "migrate my code for the new open-mercato version", "apply the UPGRADE_NOTES migrations".
- After the user changes their `@open-mercato/*` pins from `0.4.10` to `0.5.0` and runs
  `yarn install`.

## When NOT to use

- The user is on a version older than 0.4.10 or newer than 0.4.10 targeting 0.5.0.
  Use (or create) the `auto-upgrade-<their-from>-<their-to>` skill instead.
- The user wants to upgrade MikroORM 6→7, TypeScript 5→6, or awilix 12→13 — those are
  deferred majors with dedicated upgrade windows.

## Arguments

- `--path <dir>` (optional) — root of the user repo. Default: current working directory.
- `--dry-run` (optional) — print planned edits without writing.
- `--skip <id[,id...]>` (optional) — skip specific codemods by id (see table below).
- `--only <id[,id...]>` (optional) — run only specific codemods.

## Codemods

| id | What it does | Detect |
|----|--------------|--------|
| `meilisearch-class-rename` | `MeiliSearch` → `Meilisearch` in imports, `new` calls, type refs | grep `\bMeiliSearch\b` excluding imports of `meilisearch-js-plugins` |
| `meilisearch-jest-esm` | Add `transformIgnorePatterns` allow-list to Jest config | file `jest.config.{cjs,js,ts,mjs}` exists and doesn't already allow-list meilisearch |
| `stripe-api-version-type` | Replace `as Stripe.LatestApiVersion` with `as StripeConfig['apiVersion']` and inject the `StripeConfig` type alias | grep `Stripe\.LatestApiVersion` |
| `stripe-retrieve-current` | `stripe.accounts.retrieve()` (no args) → `stripe.accounts.retrieveCurrent()` | grep `\.accounts\.retrieve\(\s*\)` |
| `lucide-brand-icons` | Replace `Linkedin` → `Briefcase`, `Twitter` → `AtSign` in `lucide-react` imports and usages, with a `TODO` comment asking the user to confirm semantics | grep `from 'lucide-react'` that pulls `Linkedin` or `Twitter` |
| `lucide-metadata-icons` | In metadata-like server files, replace Lucide component references used as icon values with kebab-case icon names when the mapping is unambiguous | grep `icon:` in `page.meta.ts`, nav config, or backend chrome config files that also import from `lucide-react` |
| `react-markdown-classname-wrap` | Wrap `<ReactMarkdown className="...">...</ReactMarkdown>` in `<div className="...">...<ReactMarkdown>...</ReactMarkdown></div>` | AST find JSX `ReactMarkdown` elements with a `className` prop |
| `cron-parser-api` | `import parser from 'cron-parser'` + `parser.parseExpression(...)` → `import { CronExpressionParser } from 'cron-parser'` + `CronExpressionParser.parse(...)` | grep `cron-parser` |
| `simplewebauthn-uint8array` | Add `.slice()` to `new TextEncoder().encode(...)` and `new Uint8Array(Buffer.from(...))` results that are passed into `@simplewebauthn/server` helpers | grep `@simplewebauthn/server` + the two constructors in the same file |
| `react-email-cli` | Rename `email` CLI usage in `package.json` scripts to `react-email` | grep `"email "` or `"email\|\\s*email" ` in `scripts` block |

## Workflow

### 0. Gate checks

```bash
test -f package.json || { echo "Not a Node project — aborting"; exit 1; }
grep -q '"@open-mercato/' package.json || {
  echo "No @open-mercato/* dependency found — is this the right repo?"; exit 1;
}

# Confirm the user bumped their pins (warn, don't block)
grep -q '"@open-mercato/core": "\^\?0\.4\.11"' package.json || \
  echo "⚠️  @open-mercato/core is not pinned to 0.5.0 — run this skill after bumping."
```

Ask the user via `AskUserQuestion` to confirm they want to proceed if the version check
warns.

### 1. Detection scan

For each codemod id in the table above, run its detection grep/AST query and build a
`PlannedEdits` list: `{ codemodId, filePath, before, after }`.

Skip codemods that have no matches. Print the plan as a table before editing:

```
Codemod                            Matches  Files
meilisearch-class-rename           3        src/search/client.ts, src/search/admin.tsx
lucide-brand-icons                 2        src/components/SocialLinks.tsx
cron-parser-api                    1        src/jobs/reminder.ts
...
```

Ask the user to confirm (or pass `--dry-run` to stop here).

### 2. Apply codemods

Apply each planned edit using the `Edit` tool. Rules:

- One `Edit` call per file. Never `Write` a full file rewrite for a codemod.
- For the AST-shaped codemods (`react-markdown-classname-wrap`, `stripe-api-version-type`),
  read the file first, reason about exact formatting, then emit a single minimal `Edit`.
- Preserve surrounding indentation, comment formatting, and import ordering.
- For `lucide-brand-icons`, add a one-line comment above the replaced usage:
  ```tsx
  // TODO(open-mercato 0.5.0): lucide-react v1 removed brand icons; Briefcase is a generic substitute
  ```
  Users often want to swap in a vetted brand-icon library (`react-icons`, `simple-icons`)
  instead.

### 3. Post-edit verification

Run in this order and stop at the first failure:

```bash
# Fast syntax check
yarn tsc --noEmit 2>&1 | tail -40
```

If `tsc` fails with errors that are clearly caused by a codemod (e.g. `Meilisearch` not
exported because the user is on `meilisearch@0.55` still), roll back that codemod's edits
and add it to the "manual follow-up" list. Do not auto-revert unrelated TypeScript errors —
they are the user's pre-existing state.

```bash
# Run any existing tests if present
test -f jest.config.cjs -o -f jest.config.js -o -f jest.config.ts && yarn test 2>&1 | tail -20
```

Test failures that mention `meilisearch` + `SyntaxError: Cannot use import statement outside a module`
are handled by the `meilisearch-jest-esm` codemod — make sure it applied; re-run if not.

### 4. Report

Print a final summary:

```
Upgrade 0.4.10 → 0.5.0 complete.

Applied:
  ✅ meilisearch-class-rename    (3 edits in 2 files)
  ✅ cron-parser-api             (1 edit)
  ✅ lucide-brand-icons          (2 edits) — review the TODO comments
  ⏭️  stripe-api-version-type    skipped (no matches)

Needs human review:
  ⚠️  src/components/SocialLinks.tsx — Linkedin → Briefcase swap; confirm the
      visual is acceptable or pick a real brand-icon library.

Validation:
  yarn tsc --noEmit                ✅ clean
  yarn test                        ✅ 42 passed, 0 failed

Next steps:
  1. Inspect the TODO comments above.
  2. Commit the migration as a single `chore(deps): upgrade open-mercato 0.4.10 → 0.5.0` commit.
  3. If you use recharts, framer-motion, rate-limiter-flexible, or glob directly,
     review UPGRADE_NOTES.md — those aren't auto-migratable.
```

### 5. What this skill does NOT do

These are explicitly out of scope — flag them in the report so the user handles them
manually:

- **recharts 2 → 3** — too much surface area (custom `Tooltip`/`Legend` shapes, default
  prop changes). Point the user at https://recharts.org.
- **rate-limiter-flexible 9 → 11** — audit any custom `RateLimiterRedis` constructor.
- **framer-motion 11 → 12** — visual QA only; no code change is mechanically safe.
- **esbuild 0.25 → 0.28** — build-tooling concern; add `mkdir -p` to `--outdir` paths
  only if your build scripts assume implicit creation.
- **eslint 9 → 10** — `.eslintrc.*` → `eslint.config.mjs` migration; use ESLint's own
  `@eslint/migrate-config` rather than hand-written edits.
- **AI SDK majors** (`@ai-sdk/google` v2 → v3) — verify any direct `google.tool(...)` or
  custom-fetch usage against the AI SDK v3 migration notes.
- **The three deferred majors** (`@mikro-orm/*` 7, `typescript` 6, `awilix` 13) — not part
  of 0.5.0. Do not attempt to migrate them in this window.

## Rules

- Never edit files under `node_modules/`, `.yarn/`, `dist/`, `.next/`, or `build/`.
- Never edit files under `packages/` — this skill is for downstream users, not the
  framework itself.
- Never regenerate `yarn.lock`; that is the user's `yarn install` step.
- Every codemod must be idempotent — re-running the skill after success should no-op.
- If any codemod detection would require parsing complex JSX/TS AST and the change isn't
  unambiguous, skip it, add it to the "needs human review" list, and continue.
- The final summary must include the exact list of edited file paths so the user can
  `git diff` them before committing.
