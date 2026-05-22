# Dev Database Name Override

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Codex |
| **Created** | 2026-05-07 |
| **Related** | [SPEC-067-2026-03-17-cli-standalone-app-support.md](./SPEC-067-2026-03-17-cli-standalone-app-support.md), [BACKWARD_COMPATIBILITY.md](../../BACKWARD_COMPATIBILITY.md), [packages/create-app/AGENTS.md](../../packages/create-app/AGENTS.md), [packages/cli/AGENTS.md](../../packages/cli/AGENTS.md) |

## TLDR
**Key Points:**
- Add an optional database-name override flag to the shared dev runner used by monorepo `yarn dev`, monorepo `yarn dev:greenfield`, and standalone `yarn setup` / `yarn dev`.
- The flag lets developers run multiple long-lived local Open Mercato instances against the same PostgreSQL server without accidentally sharing one persistent database.
- Preserve 100% backward compatibility: when the new flag is omitted, all scripts and `.env` handling behave exactly as they do today.

**Scope:**
- Add a new optional CLI flag, proposed as `--database-name[=<name>]`, parsed by `scripts/dev.mjs`, copied into the standalone template, and forwarded by `packages/create-app/template/scripts/setup.mjs`.
- Support an explicit name (`--database-name=open-mercato-alpha`) and an empty value (`--database-name` or `--database-name=`) that derives the database name from the current working directory.
- When the flag is provided, ask whether to update `.env` / `apps/mercato/.env`; default answer is yes. The prompt is never shown when the flag is omitted.
- Update every README/docs page that points users to `yarn dev`, `yarn dev:greenfield`, `yarn setup`, or the standalone template scripts where database isolation is relevant.

**Concerns:**
- The feature edits connection strings, so it must parse and rewrite `DATABASE_URL` structurally with `URL`, not by string slicing.
- Empty-flag CWD derivation must produce a PostgreSQL-safe, deterministic database name and avoid collisions for similarly named folders where practical.
- Non-interactive runs must not hang on prompts.

## Overview
Open Mercato already has an ephemeral dev mode for throwaway databases, but some developers need multiple normal, persistent local instances running in parallel. Examples:

- a monorepo app on `open-mercato-main`
- a standalone app on `client-a`
- another standalone app on `client-b`

Today all quick-start paths default to `DATABASE_URL=postgres://postgres:postgres@localhost:5432/open-mercato`. If two apps use the default `.env`, migrations and seed data collide in the same persistent database. The workaround is to manually edit `.env` before startup, which is easy to forget during greenfield or standalone setup.

**Market Reference:** Rails and Django both expose database names through generated config/env, while Docker Compose examples commonly derive project resource names from the project directory. This spec adopts the ergonomic part: a local-only command-line override that can persist into `.env`, without changing deployment configuration or requiring a new database abstraction.

## Problem Statement
The current local startup flow has five pain points:

1. `yarn dev`, `yarn dev:greenfield`, and standalone `yarn setup` all assume the database encoded in `.env`.
2. Fresh standalone setup copies `.env.example` to `.env`, keeping the shared default `open-mercato` database name.
3. Developers who run multiple normal instances in parallel can accidentally run migrations, seed data, or manual tests against the wrong database.
4. Existing `yarn dev:ephemeral` solves throwaway isolation, but not long-lived persistent database isolation.
5. Documentation points users at the scripts but does not offer an on-the-spot database-name override.

## Proposed Solution
Add an optional flag to the shared dev orchestration entrypoint:

```bash
yarn dev --database-name=my-feature-db
yarn dev:greenfield --database-name=my-feature-db
yarn setup --database-name=my-client-app
yarn dev --database-name
```

Rules:

- If the flag is omitted, no new prompt appears and no `.env` mutation occurs.
- If the flag is present with a non-empty value, that value is used as the database name after validation and normalization.
- If the flag is present with no value, the runner derives a database name from `process.cwd()`.
- If the flag is present, the runner prompts: `Update .env to use database "<name>"? [Y/n]`.
- The default answer is yes.
- If the user answers yes, the runner updates the `DATABASE_URL` path database segment in the app env file before any migration/initialization stage.
- If the user answers no, the runner injects the rewritten `DATABASE_URL` into child process environments for the current run only.
- Non-interactive runs default to updating `.env` unless `--no-update-env` is passed.

### Flag Naming
Use `--database-name` rather than `--db-name` as the primary documented flag because the value changes only the database segment of `DATABASE_URL`; it does not alter host, port, username, password, schema, SSL, Redis, or queue storage.

Optional aliases may be added only if they are fully additive:

```bash
--db-name=<name>
--database=<name>
```

The spec recommends shipping only `--database-name` in MVP to keep docs and tests small.

### CWD-Derived Name
When the flag is present without a value:

1. Read `path.basename(process.cwd())`.
2. Lowercase it.
3. Replace any run of non-alphanumeric characters with `_`.
4. Trim leading/trailing `_`.
5. Prefix with `om_` if the result starts with a digit.
6. Fall back to `open_mercato_dev` if empty after normalization.

Examples:

| CWD basename | Derived database name |
|--------------|-----------------------|
| `open-mercato` | `open_mercato` |
| `client-a` | `client_a` |
| `2026-redesign` | `om_2026_redesign` |

## Design Decisions
| Decision | Rationale |
|----------|-----------|
| Make the flag optional and no-op by default | Preserves existing script semantics and current `.env` behavior. |
| Prompt only when the flag is provided | Avoids adding friction to the common `yarn dev` path. |
| Default prompt answer to yes | The user asked for `.env` update by default; it also makes subsequent runs consistent. |
| Use current-run env injection when the user declines `.env` update | Keeps the override useful for one-off runs without persisting state. |
| Parse `DATABASE_URL` with `new URL()` | Avoids corrupting credentials, query params, IPv6 hosts, or schema query strings. |
| Implement in shared runner and sync standalone template | `scripts/dev.mjs` and `packages/create-app/template/scripts/dev.mjs` are already required to stay aligned. |

## Alternatives Considered
| Alternative | Why Rejected |
|-------------|--------------|
| Tell users to edit `.env` manually | Existing behavior remains possible, but it does not solve the setup/greenfield footgun. |
| Add only an env var such as `OM_DEV_DATABASE_NAME` | Useful for CI, but less discoverable and does not cover "on the spot" CLI usage. |
| Reuse `dev:ephemeral` | Ephemeral containers are intentionally throwaway and not equivalent to persistent parallel databases. |
| Create a new package script per database | Does not scale and would modify user app package scripts unnecessarily. |

## User Stories / Use Cases
- **Monorepo developer** wants `yarn dev:greenfield --database-name=pricing-v2` so a full reinstall initializes a persistent isolated DB.
- **Standalone app developer** wants `yarn setup --database-name` so a new generated app gets a database name derived from its folder.
- **Maintainer** wants `yarn dev --database-name=review-1720 --no-update-env` so a one-off review run does not permanently edit local config.
- **CI/operator** wants non-interactive behavior that never blocks waiting for stdin.

## Architecture
### Components
| Component | File | Responsibility |
|-----------|------|----------------|
| Shared dev runner | `scripts/dev.mjs` | Parse flag, resolve env file path, prompt/update/inject `DATABASE_URL`, pass env to child stages. |
| Standalone template runner | `packages/create-app/template/scripts/dev.mjs` | Mirror shared runner behavior for generated apps. |
| Standalone setup wrapper | `packages/create-app/template/scripts/setup.mjs` | Forward `--database-name`, `--database-name=<name>`, and `--no-update-env` to `scripts/dev.mjs --setup`. |
| Env URL helper | `scripts/dev-database-url.mjs` or inline helper | Structured `DATABASE_URL` parsing, database-name normalization, `.env` update. |
| Documentation | README and docs pages | Explain persistent database isolation and examples. |

### Runtime Flow
```text
yarn setup --database-name=client_a
  -> setup.mjs forwards flag to dev.mjs --setup
    -> dev.mjs resolves target env file
    -> dev.mjs rewrites DATABASE_URL database segment
    -> user accepts default .env update
    -> install, migrate, initialize, dev all use client_a
```

```text
yarn dev --database-name
  -> dev.mjs derives database name from cwd
  -> user declines .env update
  -> child env gets DATABASE_URL with derived database name
  -> .env remains unchanged
```

### Env File Resolution
| Runtime | Env file path |
|---------|---------------|
| Monorepo root | `apps/mercato/.env` |
| Standalone app | `.env` |

If the file does not exist and `.env.example` exists, setup behavior continues to copy `.env.example` first. The database-name override then applies to the resulting `.env`.

### Prompt Behavior
- Prompt only when the database-name flag is present.
- Default answer is yes.
- Treat Enter as yes.
- Treat `y`, `yes`, `1`, `true` as yes.
- Treat `n`, `no`, `0`, `false` as no.
- In non-interactive mode (`CI=true` or no TTY), do not prompt:
  - default to update `.env`
  - respect `--no-update-env`
  - optionally support `--update-env` for explicitness

### Database Creation
The flag changes the selected database name; it does not by itself guarantee the database exists. Implementation should either:

1. rely on the existing migration/bootstrap path if it already creates the target DB, or
2. add a narrowly scoped PostgreSQL ensure-database step before migrations when the server is reachable.

If ensure-database is added, it must:

- connect to the same server using the same credentials, targeting `postgres` or the existing fallback database
- use parameterized identifier handling where available, or strict validated identifiers if PostgreSQL requires dynamic `CREATE DATABASE`
- treat "already exists" as success
- emit a clear message when credentials lack create-database permission

MVP may skip automatic creation if current `db:migrate` already documents that the database must exist. The implementation issue should verify the current behavior before deciding.

## Data Models
No application data model, entity, migration, or tenant-scoped table is introduced.

The only persisted change is optional local `.env` text mutation for `DATABASE_URL`.

## API Contracts
No HTTP API routes are introduced.

### CLI Contract
Additive CLI surface:

```text
--database-name[=<name>]
--no-update-env
--update-env
```

Compatibility:

- Existing invocations without these flags are unchanged.
- Existing package script names are unchanged.
- Existing env variables and `DATABASE_URL` semantics are unchanged.
- Existing `.env` files remain valid.

## Internationalization
N/A. This is terminal and documentation copy only.

## UI/UX
No web UI changes.

Terminal copy should be concise:

```text
[dev] Using database "client_a" from --database-name.
[dev] Update .env to use this database? [Y/n]
[dev] Updated .env DATABASE_URL.
```

When using current-run only:

```text
[dev] Leaving .env unchanged; child commands will use database "client_a" for this run.
```

## Configuration
CLI flags are primary. Optional environment variable support may be added for automation:

| Variable | Default | Meaning |
|----------|---------|---------|
| `OM_DEV_DATABASE_NAME` | unset | Same as passing `--database-name=<value>` when the CLI flag is absent. |
| `OM_DEV_DATABASE_UPDATE_ENV` | unset | `true` / `false` non-interactive answer for `.env` persistence. |

If both CLI and env are set, CLI wins.

## Migration & Compatibility
This change is 100% backward compatible:

- No command is removed or renamed.
- No default database name changes.
- No auto-discovery file contract changes.
- No API route, event, ACL, DI key, or generated file contract changes.
- `.env` is updated only after an explicit new flag is present.
- Existing docs examples remain valid; new examples are additive.

The implementation must read [BACKWARD_COMPATIBILITY.md](../../BACKWARD_COMPATIBILITY.md) before touching command scripts because CLI commands and generated/template files are contract surfaces.

## Implementation Plan
### Phase 1: Shared Parser And URL Rewriter
1. Add focused tests for parsing `--database-name`, `--database-name=value`, `--database-name=`, `--no-update-env`, and omitted flags.
2. Add a helper that normalizes CWD-derived names and validates explicit database names.
3. Add a helper that rewrites only the pathname database segment of `DATABASE_URL` using `new URL()`.
4. Support preserving query strings such as `?schema=custom`.

### Phase 2: Monorepo Dev And Greenfield
1. Wire the helper into `scripts/dev.mjs` before greenfield migrations/initialize and before standard dev child launch.
2. Resolve the monorepo env file as `apps/mercato/.env`.
3. Apply prompt/default behavior and child env injection.
4. Verify `yarn dev` without flags remains byte-for-byte behaviorally unchanged aside from internal refactoring.

### Phase 3: Standalone Setup And Dev
1. Mirror the shared runner changes into `packages/create-app/template/scripts/dev.mjs`.
2. Forward the database flags from `packages/create-app/template/scripts/setup.mjs`.
3. Update any template tests that validate script API compatibility.
4. If a helper file is added, include it in the template and ensure create-app build copies it.

### Phase 4: Documentation
1. Update root `README.md` quick-start blocks for monorepo and standalone.
2. Update `packages/create-app/README.md`.
3. Update `packages/create-app/template/AGENTS.md` environment/script guidance.
4. Update docs pages that directly describe these scripts:
   - `apps/docs/docs/installation/monorepo.mdx`
   - `apps/docs/docs/installation/standalone.mdx`
   - `apps/docs/docs/installation/setup.mdx`
   - `apps/docs/docs/customization/standalone-app.mdx`
   - `apps/docs/docs/cli/overview.mdx`
5. Add a troubleshooting note for parallel persistent databases.

### Phase 5: Verification
1. Run unit tests for the helper/parser.
2. Run `yarn dev --database-name=test_name --no-update-env` in a dry/smoke mode if available, or verify child env construction by tests.
3. Run a standalone template smoke against Verdaccio or the existing create-app smoke flow if feasible.
4. Run docs lint/build target if available.

## File Manifest
| File | Action | Purpose |
|------|--------|---------|
| `scripts/dev.mjs` | Modify | Parse and apply database-name override for monorepo dev/greenfield. |
| `scripts/dev-database-url.mjs` | Create optional | Share parsing/rewriting logic if keeping `dev.mjs` small. |
| `packages/create-app/template/scripts/dev.mjs` | Modify | Mirror standalone dev behavior. |
| `packages/create-app/template/scripts/setup.mjs` | Modify | Forward database flags to standalone setup. |
| `packages/create-app/template/package.json.template` | Review | No script rename expected; ensure Yarn argument forwarding remains documented. |
| `README.md` | Modify | Add quick-start examples. |
| `packages/create-app/README.md` | Modify | Add standalone setup/dev examples. |
| `packages/create-app/template/AGENTS.md` | Modify | Document local DB isolation flag for agents/users. |
| `apps/docs/docs/**` | Modify | Update script docs and troubleshooting. |

## Testing Strategy
- Unit test database name normalization and URL rewriting, including:
  - credentials containing symbols
  - URL query params
  - trailing slash/path-only DB segment
  - invalid explicit names
  - empty flag CWD derivation
- Unit test setup flag forwarding.
- Smoke test monorepo behavior without the flag to confirm no prompt and no `.env` write.
- Smoke test standalone `yarn setup --database-name=<name>` against generated app where practical.
- Documentation examples should include Yarn argument forwarding syntax when needed.

## Risks & Impact Review
#### Accidental `.env` Corruption
- **Scenario**: String replacement rewrites the wrong segment of `DATABASE_URL`, damaging credentials, host, query params, or schema.
- **Severity**: High
- **Affected area**: Local developer setup, standalone first-run setup.
- **Mitigation**: Use `new URL()` for parse/rewrite, preserve all fields except pathname database segment, test credentials/query strings.
- **Residual risk**: Some non-standard connection strings may fail URL parsing; fail closed with a clear message and leave `.env` untouched.

#### Non-Interactive Prompt Hang
- **Scenario**: CI or scripted scaffolding passes `--database-name` and waits forever for prompt input.
- **Severity**: Medium
- **Affected area**: CI, create-app smoke tests, scripted local setup.
- **Mitigation**: Detect `CI=true` or non-TTY stdin and choose default yes unless `--no-update-env` is passed.
- **Residual risk**: Exotic shells may misreport TTY state; explicit `--update-env` / `--no-update-env` provides an escape hatch.

#### Invalid Database Names
- **Scenario**: User passes a value PostgreSQL rejects, or a CWD name begins with a digit/special character.
- **Severity**: Medium
- **Affected area**: Migration/setup phase.
- **Mitigation**: Normalize derived names; validate explicit names to a conservative `[A-Za-z0-9_][A-Za-z0-9_-]*`-style subset or document exact allowed characters.
- **Residual risk**: Strict validation may reject legal quoted PostgreSQL names; acceptable for a dev convenience flag.

#### Database Does Not Exist
- **Scenario**: The override points to a database that has not been created and migrations fail.
- **Severity**: Medium
- **Affected area**: First setup/greenfield run.
- **Mitigation**: Verify current migration behavior. Add ensure-database if needed or document the prerequisite clearly.
- **Residual risk**: Users without create-database permission may still need manual DBA setup.

#### Template Drift
- **Scenario**: Monorepo `scripts/dev.mjs` and standalone template `scripts/dev.mjs` diverge.
- **Severity**: Medium
- **Affected area**: Standalone app generation and first-run experience.
- **Mitigation**: Follow `packages/create-app/AGENTS.md` template sync checklist and add tests for helper/template presence.
- **Residual risk**: Future edits can still drift; docs and tests should make the contract visible.

## Final Compliance Report — 2026-05-07
### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/cli/AGENTS.md`
- `packages/create-app/AGENTS.md`
- `.ai/skills/spec-writing/SKILL.md`
- `BACKWARD_COMPATIBILITY.md`

### Compliance Matrix
| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | Keep code minimal and focused | Compliant | Spec scopes changes to dev/setup scripts and docs only. |
| root AGENTS.md | Backward compatibility contract | Compliant | Adds optional flags only; omitted-flag behavior remains unchanged. |
| root AGENTS.md | Use structured APIs/parsers | Compliant | Requires `URL` parsing for `DATABASE_URL`. |
| packages/create-app/AGENTS.md | Sync template equivalents | Compliant | Explicit phase/file manifest covers template `dev.mjs` and setup wrapper. |
| packages/create-app/AGENTS.md | Test both environments | Compliant | Verification includes monorepo and standalone smoke paths. |
| packages/cli/AGENTS.md | CLI/generator changes must respect standalone app behavior | Compliant | Standalone template is first-class scope. |
| BACKWARD_COMPATIBILITY.md | CLI commands are contract surfaces | Compliant | No command removal/rename; additive flags only. |

### Internal Consistency Check
| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | N/A | No app data/API changes. |
| API contracts match UI/UX section | N/A | CLI-only feature. |
| Risks cover all write operations | Pass | `.env` mutation is covered. |
| Commands defined for all mutations | N/A | Local script env-file mutation, not app domain command. |
| Cache strategy covers all read APIs | N/A | No read APIs/cache. |
| Docs coverage matches file manifest | Pass | Relevant quick-start and CLI docs are listed. |

### Non-Compliant Items
None.

### Verdict
**Fully compliant**: Approved — ready for implementation.

## Changelog
### 2026-05-07
- Initial specification for optional dev/setup database-name override with `.env` update prompt and BC-preserving docs coverage.

### Review — 2026-05-07
- **Reviewer**: Codex
- **Security**: Passed; `.env` rewrite must be structured and fail closed.
- **Performance**: Passed; no runtime hot-path changes.
- **Cache**: N/A
- **Commands**: Passed; CLI surface is additive only.
- **Risks**: Passed; env corruption, prompt behavior, database existence, and template drift covered.
- **Verdict**: Approved
