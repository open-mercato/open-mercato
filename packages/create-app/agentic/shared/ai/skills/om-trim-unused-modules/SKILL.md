---
name: om-trim-unused-modules
description: Propose disabling modules in src/modules.ts that the current standalone project does not actually use. Intended to be offered after the user adds a new custom module, because a fresh create-mercato-app scaffold enables every built-in module (classic mode) and that is rarely what the project actually needs in production.
---

# Trim Unused Modules

Slim a classic-mode standalone app down to the modules it actually uses. A fresh
`create-mercato-app` scaffold enables every built-in Open Mercato module by default, which
is rarely what a real project needs — it slows `yarn dev`, clutters the sidebar, and confuses
end users. This skill proposes disabling the dead-weight defaults after review and user confirmation.

## When to use

- The user just added a new module to `src/modules.ts` via `yarn mercato module add …` or by hand-creating `src/modules/<name>/`.
- The user asks "which modules do I really need?" or "how do I slim down the app?"
- You notice `src/modules.ts` still has every built-in module enabled AND the business domain clearly does not need some of them (e.g. a blog-only app with `sales`, `catalog`, `currencies`, `workflows`, `integrations`, `data_sync` all active).
- Not in a monorepo, on an imported ready app (`--app`/`--app-url`), or during a live `yarn dev` — see the "When NOT to run" section of `instructions.md`.

## What it contains

A single linear procedure: confirm intent, parse `src/modules.ts`, gather per-module usage
signals, protect hard-required and `@app` modules, present removal candidates via
`AskUserQuestion`, apply confirmed edits (including the `dashboards` → `page.tsx` redirect
fixup), re-run `yarn generate`, and report what was disabled vs kept. No packages are
uninstalled and no database tables are dropped.

## Reference map

| When | Load |
|------|------|
| Running the skill — full step-by-step procedure, constraints, and when-NOT-to-run rules | `instructions.md` |

## Non-negotiables

- NEVER disable modules silently — always confirm via `AskUserQuestion` before editing `src/modules.ts`.
- NEVER remove a `from: '@app'` entry, or the hard-required set: `auth`, `customer_accounts`, `entities`, `configs`, `organizations`, `tenants`, `users`.
- NEVER delete files from `node_modules/` or `src/modules/<mod>/`, and NEVER drop database tables — this skill only edits `src/modules.ts` (plus the `dashboards` `page.tsx` fixup).
- If `dashboards` is disabled, update `src/app/(backend)/backend/page.tsx` to redirect instead of rendering `<DashboardScreen />`, in the same change.
- Re-run `yarn generate` after editing, then report disabled vs kept modules.
