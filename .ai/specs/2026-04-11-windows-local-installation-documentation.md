# Windows Local Installation Documentation

## TLDR
**Key Points:**
- Update local installation documentation so Windows developers choose the fastest reliable workflow: Docker Desktop for infrastructure services, then native Yarn commands for the application/runtime.
- Document why running the full `docker-compose.fullapp.dev.yml` stack on Windows/WSL can be slow for this repository: the source tree has many files, and bind-mounted Node.js monorepo workloads pay a high file I/O cost across the Windows/Linux filesystem boundary.
- Document the new Windows PowerShell optimization and rollback scripts as optional, explicit, review-before-apply tools.

**Scope:**
- `README.md` local installation, Windows, Docker, and standalone app sections.
- `apps/docs/docs/customization/standalone-app.mdx` — update the Docker Compose variants table which currently marks `docker-compose.fullapp.dev.yml` as "Recommended for Windows"; this must be corrected to avoid conflicting with the new guidance.
- Any existing docs installation page under `apps/docs/docs/` if the setup content is mirrored there.
- `packages/create-app/README.md` if standalone-app maintenance guidance needs the same "existing app checkout" path.

**Concerns:**
- The documentation must not imply that Microsoft Defender is disabled globally. The optimizer only adds specific Defender exclusions, enables long paths, adjusts global Git settings, and updates user-level `NODE_OPTIONS`.
- The Windows recommendation must distinguish infrastructure-in-Docker from full source-tree dev-in-Docker, because the latter can be materially slower on Windows/WSL for large Node.js monorepos.
- All documented commands must be verified against actual `package.json` and `package.json.template` scripts before publishing. Do not document commands that do not exist.

## Overview
The current documentation mentions Docker as the recommended Windows path, but it does not clearly separate two workflows:

1. full app-in-Docker development with `docker compose -f docker-compose.fullapp.dev.yml up --build`;
2. Windows-native Node/Yarn development using Docker Desktop only for dependent services such as PostgreSQL, Redis, and Meilisearch.

This spec will define documentation changes that make the second path the preferred Windows local-development path for day-to-day work. The full Docker dev stack remains valid, but should be framed as simpler and more isolated rather than fastest on Windows.

## Problem Statement
Windows developers currently lack a clear, ordered local setup path that explains:

- why Docker Desktop should still be used for PostgreSQL and supporting services;
- why the full `docker-compose.fullapp.dev.yml` dev stack may be slow on Windows/WSL due to bind-mounted monorepo file I/O;
- which Yarn commands to run after infrastructure is up;
- how to run the same guidance for an already-created standalone app checked out locally;
- what `windows-optimize.ps1` changes, when it prompts, and how `windows-rollback.ps1` can undo captured state.

Additionally, `apps/docs/docs/customization/standalone-app.mdx` currently lists `docker-compose.fullapp.dev.yml` as "Recommended for Windows or fully containerized workflows." This creates a contradiction with the new guidance and must be corrected in the same documentation update.

## Prerequisites
The documentation must list these prerequisites before the Windows setup sequence:

- **Node.js 24+** — required by the standalone app `preinstall` check and by the monorepo runtime.
- **Yarn via Corepack** — `corepack enable && corepack prepare yarn@stable --activate`.
- **Git** — required by `windows-optimize.ps1` to apply global Git config settings (`core.longpaths`, `core.autocrlf`, etc.).
- **Docker Desktop with WSL 2 backend** — for infrastructure services (PostgreSQL, Redis, Meilisearch).

## Proposed Documentation Changes

### Monorepo path (contributor workflow)

Add a Windows-native local development subsection targeting developers who cloned the monorepo. The sequence explicitly distinguishes this from the standalone app path:

1. Install prerequisites (Node.js 24+, Yarn via Corepack, Git, Docker Desktop with WSL 2 backend enabled).
2. Start only infrastructure services:

   ```powershell
   docker compose up -d
   ```

   This uses `docker-compose.yml` at the repo root, which starts PostgreSQL, Redis, and Meilisearch only — it does not run the application container.

3. Optionally run the Windows optimizer from the repository root:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\windows-optimize.ps1
   ```

4. The optimizer shows a plan, then asks to relaunch itself as Administrator. Accept the relaunch — a new elevated PowerShell window opens. In that window the plan is shown again; accept execution to apply all changes.
5. Close the original (non-elevated) window. Restart the terminal used for development so user-level environment variable changes (`NODE_OPTIONS`) take effect.
6. Continue with the standard monorepo setup:

   ```powershell
   yarn install
   yarn build:packages
   yarn generate
   yarn initialize
   yarn dev
   ```

   > **Note:** `yarn build:packages` is a monorepo-only step that compiles TypeScript packages to `dist/`. It does not exist in standalone apps.

7. For an existing database (re-initializing without resetting data), prefer:

   ```powershell
   yarn db:migrate
   yarn generate
   yarn dev
   ```

### Standalone app path (production app workflow)

Add a separate subsection for developers working with a standalone app created by `npx create-mercato-app`. This path does not include `yarn build:packages` (packages are pre-compiled npm dependencies).

#### New standalone app

```powershell
npx create-mercato-app my-store
cd my-store
cp .env.example .env
# Edit .env — set DATABASE_URL, JWT_SECRET, REDIS_URL at minimum
docker compose up -d
yarn setup
```

`yarn setup` handles code generation, migrations, and initial seed in one step. For the raw passthrough variant with no splash screen, use `yarn setup:classic`.

#### Existing standalone app (already cloned locally)

For a developer who cloned or copied an existing standalone app repository rather than running `npx create-mercato-app`:

```powershell
cd path\to\existing-standalone-app
cp .env.example .env
# Edit .env — set DATABASE_URL, JWT_SECRET, REDIS_URL at minimum
docker compose up -d
yarn install
yarn setup:reinstall
yarn dev
```

If the app already has a valid database and tenant and you only need to apply new migrations:

```powershell
yarn db:migrate
yarn generate
yarn dev
```

> **Note:** `yarn setup --reinstall` is not a valid command. Use `yarn setup:reinstall` (colon, not space). Alternatively, `yarn reinstall` runs the same underlying `mercato init --reinstall` directly.

### Rollback subsection

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\windows-rollback.ps1
```

Document that:
- Rollback reads `.\. mercato\windows-optimize-state.json` (created by the optimizer on first run).
- Defender exclusions that existed before optimization are preserved; only newly added exclusions are removed.
- If the state file is absent, rollback exits with an error rather than guessing at prior state.
- After rollback, restart the terminal so environment variable changes take effect.

### `standalone-app.mdx` Docker Compose table correction

Update the Docker Compose variants table in `apps/docs/docs/customization/standalone-app.mdx`. The current entry:

> `docker-compose.fullapp.dev.yml` — "Recommended for Windows or fully containerized workflows."

Must be changed to reflect that native Yarn + services-only Docker is the preferred Windows development path. The full dev stack remains available for fully containerized or CI-like workflows but is no longer the primary Windows recommendation.

## Optimizer behavior summary (for documentation accuracy)

The following changes are made by `windows-optimize.ps1`. Documentation must reflect these exactly and must not overstate scope:

| Change | Scope | Notes |
|--------|-------|-------|
| Microsoft Defender path exclusions | Project root + Node/Yarn/pnpm/turbo user dirs + `C:\Program Files\nodejs` | Not a global Defender disable |
| Microsoft Defender process exclusions | `node.exe`, `yarn.js`, `turbo.exe` | Not a global Defender disable |
| Windows long paths | HKLM registry (`LongPathsEnabled = 1`) | Requires Administrator |
| Git global config | `core.longpaths`, `core.autocrlf`, `core.eol`, `core.fscache`, `core.preloadindex` | User-level `.gitconfig` |
| `NODE_OPTIONS` | User-level environment variable, appends `--max-old-space-size=4096` if not already present | Requires terminal restart |
| Rollback state | Saved to `.mercato\windows-optimize-state.json` once; kept on re-run | Previous state is never overwritten |

## Implementation Plan
### Phase 1: Documentation Inventory
1. Identify the canonical installation page in `README.md` and `apps/docs/docs/`.
2. Identify standalone app documentation in `README.md`, `apps/docs/docs/customization/standalone-app.mdx`, and `packages/create-app/README.md`.
3. Confirm all commands listed in this spec exist in the relevant `package.json` / `package.json.template` before writing any documentation.

### Phase 2: Windows Local Setup Copy (Monorepo)
1. Add a Windows-native local development path that uses Docker Desktop for services and Yarn for the app.
2. Explain why the full Docker dev stack can be slower on Windows/WSL for large monorepos with many watched files.
3. Document the optimizer and rollback scripts with their two-confirmation-prompt flow, the elevated-window behavior, and the terminal-restart requirement.
4. Clarify that `yarn build:packages` is a monorepo-only step.

### Phase 3: Standalone App Copy
1. Add a path for new standalone app creation (includes `.env` copy step).
2. Add a separate path for existing standalone app repositories.
3. Use `yarn setup:reinstall` (not `yarn setup --reinstall`) for the reinstall flow.
4. Keep new-app creation and existing-app setup in separate subsections so developers do not rerun scaffold commands unnecessarily.
5. Ensure command ordering matches actual standalone `package.json.template` scripts.

### Phase 4: `standalone-app.mdx` Correction
1. Update the Docker Compose variants table to remove "Recommended for Windows" from `docker-compose.fullapp.dev.yml`.
2. Add a note explaining that native Yarn + `docker compose up -d` (services-only) is the preferred Windows path for day-to-day development.

### Phase 5: Verification
1. Run Markdown/MDX checks available in the repo for changed docs.
2. Manually verify all referenced commands exist in root `package.json` and standalone template `package.json.template`.
3. Confirm the optimizer `Show-Plan` output matches the table in this spec.

## Changelog
### 2026-04-11
- Initial skeleton specification for Windows local installation documentation updates.
- Revised after review: fixed non-existent `yarn setup --reinstall` command (correct form is `yarn setup:reinstall`); separated monorepo and standalone app sequences; added `yarn build:packages` monorepo-only note; added missing `docker compose up -d` (services-only) command; added `.env` copy step to standalone path; added Prerequisites section; added optimizer behavior summary table; added `standalone-app.mdx` Docker Compose table correction to scope; clarified two-window elevated-prompt behavior; added command verification requirement.
- Implemented documentation updates across `README.md`, `apps/docs/docs/installation/setup.mdx`, `apps/docs/docs/customization/standalone-app.mdx`, and `packages/create-app/README.md`; command references were checked against root `package.json`, standalone `package.json.template`, and the Windows optimizer/rollback scripts. Adjusted the services-only wording to avoid claiming the root compose file starts only three services because the current compose file also includes ancillary non-app services.
- Added documentation for the Windows cleanup scripts introduced by `d2b57c3c Add Windows clean scripts`: `scripts/clean-generated-windows.ps1` and `scripts/clean-packages-windows.ps1`. Also updated `apps/docs/docs/installation/prerequisites.mdx` so it no longer recommends Docker-only as the primary Windows path.
- Narrowed `clean-generated-windows.ps1` so it cleans `.mercato/generated` and `.mercato/next` instead of deleting the entire `.mercato` tree. This preserves `windows-optimize-state.json` for rollback and avoids wiping local queue data under `.mercato/queue`.
