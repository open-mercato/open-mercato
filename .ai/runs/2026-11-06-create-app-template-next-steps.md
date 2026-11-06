# Execution plan: `--template` next steps that match the created app

Goal: after `create-mercato-app --template`, print the start commands the created app can actually run — `yarn setup` for an infra-aware template, like a normal scaffold.

Stacked on #8732 (`feat/create-app-template`).

## Scope

- `packages/create-app/src/lib/templates/finalize.ts` — `printTemplateImportNextSteps` picks one of three cases; a helper reads the created app's `package.json` scripts.
- `packages/create-app/src/lib/templates/template-step.ts` — builds the extra input (`startup`, `hasDockerCompose`).
- Tests in `templates.test.ts`; docs where the `--template` next steps are described.

Cases:
1. `setup` + `infra:up` → optional `cp .env.example .env` + keys only when keys are declared (`scripts/setup.mjs` copies `.env.example` itself), `yarn setup` with the scaffold's explanation, and the `yarn setup --no-infra` alternative.
2. `setup` without `infra:up` → `cp .env.example .env`, keys, `docker compose up -d` (or a dim note to start services), `yarn setup`.
3. Neither → unchanged (`yarn install`, `yarn initialize`, `yarn dev`).

## Non-goals

- `--app` / `--app-url` next steps (`printImportedReadyAppNextSteps`).
- Any change to what the import writes into the app.

## Risks

- Older apps with a `setup` that needs services already running: handled by case 2.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Next steps by startup kind

- [ ] 1.1 Detect the startup kind and pick the matching next steps
- [ ] 1.2 Tests for the three cases with and without env keys

### Phase 2: Docs and verification

- [ ] 2.1 Update the `--template` next-steps docs
- [ ] 2.2 Build create-app and capture the demo template output
