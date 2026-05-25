---
name: auto-upgrade-0.4.10-to-0.5.0
description: Migrate a standalone Open Mercato app from framework 0.4.10 to 0.5.0. This release is the biggest Open Mercato release so far and bundles 250+ post-Hackathon fixes plus several important dependency upgrades, so this skill acts as the executable companion to the 0.5.0 upgrade notes. It mechanically applies the documented codemods for the 0.4.10 → 0.5.0 window — Meilisearch class rename, Stripe API-version typing, lucide-react brand-icon removals and metadata-icon safety fixes, react-markdown className wrap, cron-parser `CronExpressionParser.parse` rename, @simplewebauthn Uint8Array narrowing, react-email CLI rename, plus the Jest ESM allow-list. Runs inside the user's app, detects which patterns are actually in use, edits files in place, typechecks, and reports what was migrated and what still needs a human eye. Use when a user asks to "upgrade my Open Mercato project from 0.4.10 to 0.5.0", "bump open-mercato to 0.5.0", or "apply the 0.5.0 upgrade notes".
---

# auto-upgrade-0.4.10-to-0.5.0

Apply the Open Mercato `0.4.10` → `0.5.0` dependency-upgrade codemods to this standalone
application.

Context for this window:
- `0.5.0` is the biggest Open Mercato release so far
- it includes more than 250 fixes and improvements after the Hackathon in Sopot
- several important dependency upgrades landed in the same release, which is why
  dedicated upgrade notes and this companion skill were added

## Scope

This skill operates on the current standalone app created with `create-mercato-app`
or any downstream app that depends on `@open-mercato/*`.

It applies the mechanical parts of the upgrade. It does NOT bump the `@open-mercato/*`
dependencies themselves — that is still the user's pinning decision. Run this skill
after the user bumps their dependencies and runs `yarn install`.

## When to use

- User says: "upgrade Open Mercato from 0.4.10 to 0.5.0", "bump open-mercato to 0.5.0",
  "migrate my code for the new open-mercato version", "apply the 0.5.0 upgrade notes".
- After the user changes their `@open-mercato/*` pins from `0.4.10` to `0.5.0` and runs
  `yarn install`.

## When NOT to use

- The user is on a version older than `0.4.10` or newer than `0.4.10` targeting `0.5.0`.
  Use or create the matching `auto-upgrade-<from>-<to>` skill instead.
- The user wants to upgrade deferred majors such as MikroORM `6 → 7`, TypeScript `5 → 6`,
  or Awilix `12 → 13`.

## Arguments

- `--path <dir>` (optional) — root of the standalone app. Default: current working directory.
- `--dry-run` (optional) — print planned edits without writing.
- `--skip <id[,id...]>` (optional) — skip specific codemods by id.
- `--only <id[,id...]>` (optional) — run only specific codemods.

## Codemods

| id | What it does | Detect |
|----|--------------|--------|
| `meilisearch-class-rename` | `MeiliSearch` → `Meilisearch` in imports, `new` calls, type refs | grep `\bMeiliSearch\b` excluding imports of `meilisearch-js-plugins` |
| `meilisearch-jest-esm` | Add `transformIgnorePatterns` allow-list to Jest config | file `jest.config.{cjs,js,ts,mjs}` exists and doesn't already allow-list meilisearch |
| `stripe-api-version-type` | Replace `as Stripe.LatestApiVersion` with `as StripeConfig['apiVersion']` and inject the `StripeConfig` type alias | grep `Stripe\.LatestApiVersion` |
| `stripe-retrieve-current` | `stripe.accounts.retrieve()` with no args → `stripe.accounts.retrieveCurrent()` | grep `\.accounts\.retrieve\(\s*\)` |
| `lucide-brand-icons` | Replace `Linkedin` → `Briefcase`, `Twitter` → `AtSign` in `lucide-react` imports and usages, with a `TODO` comment asking the user to confirm semantics | grep `from 'lucide-react'` that pulls `Linkedin` or `Twitter` |
| `lucide-metadata-icons` | In metadata-like server files, replace Lucide component references used as icon values with kebab-case icon names when the mapping is unambiguous | grep `icon:` in `page.meta.ts`, nav config, or backend chrome config files that also import from `lucide-react` |
| `react-markdown-classname-wrap` | Wrap `<ReactMarkdown className=\"...\">...</ReactMarkdown>` in a parent `<div className=\"...\">` and remove the direct `className` prop | AST find JSX `ReactMarkdown` elements with a `className` prop |
| `cron-parser-api` | `import parser from 'cron-parser'` + `parser.parseExpression(...)` → `import { CronExpressionParser } from 'cron-parser'` + `CronExpressionParser.parse(...)` | grep `cron-parser` |
| `simplewebauthn-uint8array` | Add `.slice()` to `new TextEncoder().encode(...)` and `new Uint8Array(Buffer.from(...))` results passed into `@simplewebauthn/server` helpers | grep `@simplewebauthn/server` plus the constructors in the same file |
| `react-email-cli` | Rename `email` CLI usage in `package.json` scripts to `react-email` | grep `"email "` or `"email\\|\\s*email"` in the `scripts` block |

## Workflow

### 0. Gate checks

```bash
test -f package.json || { echo "Not a Node project — aborting"; exit 1; }
grep -q '"@open-mercato/' package.json || {
  echo "No @open-mercato/* dependency found — is this the right repo?"; exit 1;
}

grep -q '"@open-mercato/core": "\^\\?0\\.5\\.0"' package.json || \
  echo "⚠️  @open-mercato/core is not pinned to 0.5.0 — run this skill after bumping."
```

If the version check warns, ask the user to confirm before editing.

### 1. Detection scan

For each codemod id in the table above, run its detection grep or AST query and build a
`PlannedEdits` list: `{ codemodId, filePath, before, after }`.

Skip codemods with no matches. Print the plan before editing:

```text
Codemod                            Matches  Files
meilisearch-class-rename           3        src/search/client.ts, src/search/admin.tsx
lucide-brand-icons                 2        src/components/SocialLinks.tsx
cron-parser-api                    1        src/jobs/reminder.ts
```

Ask the user to confirm, unless the user explicitly requested an automatic run.

### 2. Apply codemods

Rules:

- One minimal edit per file where practical. Do not rewrite whole files when a targeted edit is enough.
- Preserve indentation, surrounding comments, and import ordering.
- For AST-shaped codemods such as `react-markdown-classname-wrap` and `stripe-api-version-type`,
  read the file first and then make the smallest correct edit.
- For `lucide-brand-icons`, add a one-line follow-up comment above the substituted usage:

```tsx
// TODO(open-mercato 0.5.0): lucide-react v1 removed brand icons; Briefcase is a generic substitute
```

### 3. Post-edit verification

Run in this order and stop at the first failure:

```bash
yarn tsc --noEmit 2>&1 | tail -40
```

If `tsc` fails with errors clearly caused by a codemod, roll back that codemod and add it
to the manual follow-up list. Do not auto-revert unrelated pre-existing errors.

If the app has a Jest config, run:

```bash
yarn test 2>&1 | tail -20
```

If tests fail with `meilisearch` ESM import errors, make sure the `meilisearch-jest-esm`
codemod applied.

### 4. Report

Print a final summary with:

- applied codemods
- skipped codemods
- manual review items
- validation results
- exact edited file paths

Suggested close-out structure:

```text
Upgrade 0.4.10 → 0.5.0 complete.

Applied:
  ✅ meilisearch-class-rename
  ✅ cron-parser-api
  ✅ lucide-brand-icons — review the TODO comments

Needs human review:
  ⚠️ src/components/SocialLinks.tsx — confirm the generic icon replacement.

Validation:
  yarn tsc --noEmit ✅
  yarn test ✅
```

### 5. Out of scope

Flag these for manual handling instead of editing them automatically:

- `recharts` `2 → 3`
- `rate-limiter-flexible` `9 → 11`
- `framer-motion` `11 → 12`
- `esbuild` `0.25 → 0.28`
- `eslint` `9 → 10`
- AI SDK major migrations
- deferred majors such as MikroORM `7`, TypeScript `6`, or Awilix `13`

## Rules

- Never edit `node_modules/`, `.yarn/`, `dist/`, `.next/`, or `build/`.
- Never regenerate `yarn.lock`; dependency installation belongs to the user's `yarn install` step.
- Every codemod must be idempotent.
- If a codemod is not unambiguous, skip it and add it to manual follow-up.
- Always include the exact list of edited files in the final report.
