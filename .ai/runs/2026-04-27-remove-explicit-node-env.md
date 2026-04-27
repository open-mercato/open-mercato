# Remove explicit `NODE_ENV` from env files

## Goal

Stop shipping `NODE_ENV=development` in `.env.example` files so Next.js can manage `NODE_ENV` itself based on the command (`next dev` → `development`, `next build`/`next start` → `production`, `next test` → `test`). When `NODE_ENV` is set explicitly in `.env`, Next.js prints a "non-standard NODE_ENV value" warning at startup regardless of the value, because Next.js treats *any* explicit override of its managed `NODE_ENV` as non-standard.

## Scope

Files changed in this PR:

- `apps/mercato/.env.example`
- `packages/create-app/template/.env.example`

Note: `apps/mercato/.env` is gitignored, so the local-only file is fixed by the developer outside the PR.

## Non-goals

- Any change to runtime behavior, build outputs, or other env keys.
- Touching the gitignored `apps/mercato/.env` from this PR.
- Documentation rewrites unrelated to `NODE_ENV`.

## Risks

- Local environments that currently *depend* on `NODE_ENV=development` being set before `next` boots (e.g., a non-Next.js script run via `node` directly using the `.env` file as its sole source of `NODE_ENV`) will fall back to `node`'s default (`undefined`). Mitigation: those scripts already run under `yarn dev`/`turbo` which set `NODE_ENV` themselves, so impact is expected to be nil. Users who need a custom value can still add it locally.

## Implementation Plan

### Phase 1: Remove `NODE_ENV` from tracked env templates

- Edit `apps/mercato/.env.example`: drop the `# Node environment` comment and `NODE_ENV=development` line.
- Edit `packages/create-app/template/.env.example`: drop the `NODE_ENV=development` line and any associated comment.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Remove `NODE_ENV` from tracked env templates

- [ ] 1.1 Remove `NODE_ENV` from `apps/mercato/.env.example`
- [ ] 1.2 Remove `NODE_ENV` from `packages/create-app/template/.env.example`
