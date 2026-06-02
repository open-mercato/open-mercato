# Execution Plan — Align create-app template with app source (`example` module drift)

## Goal

Resolve the pre-existing `create-app` template drift flagged as a Low finding during the
`auto-review-pr` pass on PR #2390: the `example` module's `generate-watch-smoke` backend page
and its i18n keys exist in `apps/mercato/src/modules/example` but are missing from the
`packages/create-app/template` mirror, so `yarn template:sync` reports drift.

## Scope

- Mirror `apps/mercato/src/modules/example/backend/generate-watch-smoke/` (`page.meta.ts`,
  `page.tsx`) into the template.
- Mirror the five `example.generateWatchSmoke.*` i18n keys into the template's
  `example/i18n/{en,de,es,pl}.json`.
- Achieve byte-for-byte parity so `yarn template:sync` exits clean for the `example` module.

### Non-goals

- No behavior change to the live `apps/mercato` app — the app source is the source of truth and is
  left untouched.
- No changes to `app/globals.css` template copy (its `../../../../` → `../../` node_modules path is a
  deliberate `template-sync` content transform, not drift).
- No new feature, no other modules, no `template-sync.ts` mapping changes (modules are synced by the
  default `SYNC_FOLDERS` glob, already covered).

## Findings (drift, on `origin/develop`)

```
Only in apps/mercato/src/modules/example/backend: generate-watch-smoke
Files .../example/i18n/{de,en,es,pl}.json differ  → missing 5 example.generateWatchSmoke.* keys
```

The page is a dev/QA smoke target for structural module-watch + sidebar regeneration. Its i18n keys
are English placeholders in all four locales in the source; parity requires mirroring them verbatim.

## Risks

- Low. Template-only scaffold change; the live app build is unaffected. The only correctness gate is
  byte-for-byte parity, verified by `yarn template:sync` (itself covered by `test:scripts`).
- JSON key ordering must match source exactly or `template-sync` content-hash comparison fails — copy
  files verbatim rather than hand-editing.

## Verification

- `yarn template:sync` — must report the `example` module in parity (no drift for these files).
- `yarn test:scripts` — template-sync test suite stays green.
- `yarn i18n:check-sync` / `yarn i18n:check-usage` — locale key sync/usage gates.
- Full gate before PR: `yarn build:packages`, `yarn generate`, `yarn typecheck`, `yarn test`,
  `yarn build:app`.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Mirror the generate-watch-smoke page

- [ ] 1.1 Copy `backend/generate-watch-smoke/page.meta.ts` + `page.tsx` into the template
- [ ] 1.2 Mirror the five `example.generateWatchSmoke.*` keys into template `i18n/{en,de,es,pl}.json`

### Phase 2: Verify parity and run checks

- [ ] 2.1 Confirm `yarn template:sync` reports parity for the `example` module
- [ ] 2.2 Run i18n checks and the full validation gate
