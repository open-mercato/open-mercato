# Mercato CLI Skills Sync

- **Date**: 2026-04-24
- **Status**: Proposal
- **Scope**: OSS - `packages/cli`, `packages/create-app`
- **Related**:
  - [SPEC-057](implemented/SPEC-057-2026-03-05-standalone-app-ai-folder.md)
  - [SPEC-058](implemented/SPEC-058-2026-03-10-agentic-tool-setup-standalone-app.md)
  - [SPEC-059](implemented/SPEC-059-2026-03-11-standalone-app-skills.md)
  - [Develop Snapshot Release](2026-03-21-open-mercato-develop-snapshot-release.md)
  - [packages/create-app/AGENTS.md](../../packages/create-app/AGENTS.md)
  - [packages/cli/AGENTS.md](../../packages/cli/AGENTS.md)
  - [BACKWARD_COMPATIBILITY.md](../../BACKWARD_COMPATIBILITY.md)

## TLDR

Keep the existing `.ai/skills/` layout, but stop treating it as a frozen copy.

Add an official CLI command:

```bash
yarn mercato skills sync
```

The command syncs `.ai/skills/` from the `open-mercato/open-mercato` `develop` branch, using the existing standalone skill source inside the monorepo. It is safe by default: locally modified skills are never overwritten silently. In the normal terminal flow, the user is asked what to do for each conflict.

There is no `yarn dev` automation in this proposal. Skill updates stay explicit and manual.

## Overview

The current standalone skill distribution model is operationally simple at scaffold time but wrong over the lifetime of the project. `create-mercato-app` and `yarn mercato agentic:init` copy skill files once, then those files drift forever unless someone manually updates them.

The previously explored plugin-based approach solves freshness, but at the cost of another distribution channel, another repository, and tool-specific behavior that mainly fits Claude Code. That increases complexity and does not help existing Open Mercato installations, custom OM-adjacent projects, or teams using Codex and Cursor.

The simpler path is to keep the current on-disk contract exactly as it is:

- skills still live in `.ai/skills/`
- Claude/Codex/Cursor still point at the same local directory
- `create-mercato-app` and `agentic:init` still generate the initial files

What changes is the lifecycle: the official Mercato CLI becomes the update mechanism for that folder.

## Problem Statement

### 1. Skill copies drift immediately

Standalone apps currently receive scaffold-time copies from:

```text
packages/create-app/agentic/shared/ai/skills/
```

Those files are not tied to package upgrades and are not refreshed by `yarn upgrade @open-mercato/*`. The result is predictable:

- newer Open Mercato conventions do not reach old apps
- bug fixes in skills stay trapped in the monorepo
- apps created in different months run materially different guidance

### 2. A plugin/repo layer increases operational complexity

The plugin proposal introduces a separate repository and a Claude-specific distribution path. That creates more moving parts than the problem requires:

- extra sync automation outside the main monorepo
- another release surface to maintain
- another place where drift can happen
- a solution that does not naturally cover Codex, Cursor, or existing local `.ai/skills/` consumers

### 3. Existing OM projects need the same safety and freshness

The problem is broader than freshly scaffolded standalone apps. Existing Open Mercato installations and OM-adjacent repositories such as `mercato-builder`, `github-janitor`, and Cezar-managed projects already use the same local skill-folder structure. They need the same update path without being migrated onto a new plugin ecosystem.

### 4. Manual updates are risky when teams customize skills locally

Some teams patch skill files locally for project-specific conventions. A naive sync command would destroy those edits. The update mechanism must therefore distinguish:

- files last synced from Open Mercato and left untouched since then
- files intentionally customized in the local project

### 5. The maintenance path should stay explicit and predictable

The goal is to reduce drift without adding runtime behavior, background sync, or new startup failure modes. The right operational model is one explicit command that developers run when they want to refresh the local skill pack:

```bash
yarn mercato skills sync
```

That keeps the workflow boring, understandable, and easy to trust.

## Proposed Solution

### 1. Add an official `skills sync` command to Mercato CLI

Introduce a new additive CLI contract:

```bash
yarn mercato skills sync
```

Behavior in v1:

- sync target is always local `.ai/skills/`
- upstream source is the Open Mercato monorepo `develop` branch
- source directory for the standalone pack is:

```text
packages/create-app/agentic/shared/ai/skills/
```

- default mode is interactive when a modified local skill is encountered
- `--non-interactive` skips modified local skills
- `--force` is available to overwrite locally modified files deliberately

This keeps the user-facing API minimal while solving the real problem.

### 2. Preserve the existing `.ai/skills/` contract

This spec does **not** change:

- the directory name `.ai/skills/`
- skill folder names
- Claude/Codex/Cursor skill symlink strategy
- the fact that `create-mercato-app` and `agentic:init` generate local files

The lifecycle changes, not the layout.

### 3. Store a local sync manifest next to the skills

Add a local manifest file:

```text
.ai/skills/.mercato-sync.json
```

The manifest records the last synced hash of each managed file. That gives the CLI a safe baseline for future updates.

Rules:

- if a local file hash still matches the last synced hash, it is safe to update
- if a local file hash differs, it is treated as locally modified and requires an explicit decision
- if an upstream-managed file was removed and the local file is still unmodified, the local file may be deleted
- locally modified or unknown extra files are never deleted automatically

### 4. Bootstrap new apps with a manifest from day one

`create-mercato-app` and `yarn mercato agentic:init` must write the initial sync manifest when they create `.ai/skills/`.

This avoids the "I do not know what was originally scaffolded" problem for all newly created or newly initialized projects.

### 5. Handle existing projects safely with bootstrap mode

Projects created before this spec will not have a sync manifest. For those projects, the first manual run of:

```bash
yarn mercato skills sync
```

must enter bootstrap mode:

- scan the current local `.ai/skills/`
- write `.ai/skills/.mercato-sync.json` using the current local files as the protected baseline
- do **not** overwrite any skill files during this first bootstrap run
- print a clear summary telling the user that the baseline was recorded and a second run is needed to pull official updates

`--force` may bypass bootstrap mode and perform a full reset to upstream if the user explicitly wants that.

This is intentionally conservative. Without a prior baseline, safely inferring which older files were manually customized is impossible.

### 6. Keep sync explicit and manual

This proposal intentionally does **not** integrate with `yarn dev`.

Rules:

- no background sync
- no startup-time network call
- no extra wizard prompt in `create-mercato-app`
- no hidden automatic mutation of `.ai/skills/`

The only update path in v1 is the explicit CLI command.

### 7. Make conflict handling interactive by default

When a locally modified managed file is detected, the default terminal flow should ask the user what to do instead of silently skipping or overwriting.

Prompt shape:

```text
Modified local skill detected:
.ai/skills/code-review/SKILL.md

An official update is available from open-mercato/develop.
What do you want to do?

[o] overwrite this file
[s] skip this file
[a] overwrite this and all remaining modified files
[k] skip this and all remaining modified files
[q] abort sync
```

Rules:

- prompt only for locally modified managed files
- prompt loop runs once per conflicting file unless the user selects a global action with `a` or `k`
- `o` overwrites only the current file and advances the manifest baseline for that file
- `s` skips only the current file and keeps the existing manifest baseline
- `a` overwrites the current file and all remaining modified files without further prompts
- `k` skips the current file and all remaining modified files without further prompts
- `q` aborts the command without processing remaining conflicts
- unmodified managed files continue syncing normally without prompts
- deleted local files count as local modifications and follow the same prompt flow

## Architecture

### Source of truth

The source of truth remains inside the main Open Mercato monorepo:

```text
open-mercato/open-mercato
  packages/create-app/agentic/shared/ai/skills/
```

The CLI downloads the `develop` snapshot of that repository and extracts only the skill-pack directory it needs.

This deliberately avoids:

- a plugin marketplace dependency
- a secondary repository
- duplicating skills into npm-only discovery paths that Claude/Codex do not auto-load

### Project profiles

To keep v1 simple while still supporting OM-adjacent repositories, the sync system stores a `profile` in the manifest/config. v1 ships only one profile:

| Profile | Upstream source | Local target | Intended projects |
|---------|-----------------|--------------|-------------------|
| `standalone-app` | `packages/create-app/agentic/shared/ai/skills/` | `.ai/skills/` | standalone apps and external repos that intentionally use the standalone skill set |

Rules:

- standalone OM apps auto-detect `standalone-app`
- external repos may declare the same profile manually in `package.json`
- adding more profiles later is additive and out of scope for v1

### Local files

#### Synced skill tree

```text
.ai/skills/
  <skill-id>/SKILL.md
  <skill-id>/references/*
  .mercato-sync.json
```

#### Optional package configuration

```json
{
  "mercato": {
    "skills": {
      "profile": "standalone-app",
      "sourceRef": "develop"
    }
  }
}
```

Rules:

- `sourceRef` defaults to `develop`
- standalone apps usually do not need this block because the profile can be auto-detected
- external repositories may add it manually when they want to opt into the same sync source

### Sync algorithm

#### Manual sync

1. Resolve profile and source ref.
2. Ensure `.ai/skills/` exists.
3. Load `.ai/skills/.mercato-sync.json` if present.
4. If no manifest exists, run bootstrap mode and stop unless `--force` is passed.
5. Download the upstream Open Mercato archive for `develop`.
6. Build the upstream managed file map.
7. Compare each managed local file to the last synced hash.
8. Apply updates immediately to files that are unmodified since last sync.
9. For locally modified files:
   - overwrite immediately if `--force` is enabled
   - skip immediately if `--non-interactive` is enabled
   - otherwise prompt the user file-by-file
10. Remove upstream-deleted files only if the local copy is still unmodified.
11. Write the new manifest for all successfully synced files.

#### Non-TTY behavior

The command must never hang waiting for input in a non-interactive environment.

Rules:

- if no modified managed files are detected, the command proceeds normally
- if modified managed files are detected and `--non-interactive` is set, they are skipped
- if modified managed files are detected and `--force` is set, they are overwritten
- if modified managed files are detected, no TTY is available, and neither `--non-interactive` nor `--force` is set, the command fails with a clear message explaining how to continue

### Create-app and agentic-init integration

#### `create-mercato-app`

When the user selects agentic tooling:

- generate `.ai/skills/` exactly as today
- generate `.ai/skills/.mercato-sync.json`

#### `yarn mercato agentic:init`

When skills are generated into an existing standalone app:

- generate the same initial manifest
- preserve existing `agentic:init` behavior otherwise

This keeps the current initialization surfaces intact while making later sync safe.

## Data Models

### `SkillSyncManifest`

Stored at:

```text
.ai/skills/.mercato-sync.json
```

Recommended shape:

```json
{
  "schemaVersion": 1,
  "profile": "standalone-app",
  "source": {
    "repo": "open-mercato/open-mercato",
    "ref": "develop",
    "sourcePath": "packages/create-app/agentic/shared/ai/skills"
  },
  "lastSyncAt": "2026-04-24T10:30:00.000Z",
  "files": {
    "spec-writing/SKILL.md": {
      "syncedSha256": "..."
    },
    "code-review/references/review-checklist.md": {
      "syncedSha256": "..."
    }
  }
}
```

Rules:

- the manifest stores the last synced hash, not the current local hash
- extra local files outside `files` are preserved
- file keys are always relative to `.ai/skills/`

### `SkillSyncConfig`

Stored in `package.json`:

```json
{
  "mercato": {
    "skills": {
      "profile": "standalone-app",
      "sourceRef": "develop"
    }
  }
}
```

This is optional operational config for explicit source/profile selection, mainly useful outside the default standalone-app detection path.

## API Contracts

This spec introduces no HTTP API changes.

### CLI contract

Add a new additive command group:

```bash
yarn mercato skills sync
```

Supported flags in v1:

```bash
yarn mercato skills sync --non-interactive
yarn mercato skills sync --force
```

Contract rules:

- `skills sync` is additive and does not rename or remove any existing CLI command
- default behavior must be interactive when a TTY is available and conflicts are detected
- `--non-interactive` must skip locally modified managed files
- `--force` may overwrite locally modified files and bypass bootstrap mode
- in non-TTY environments with detected conflicts, the command must require `--non-interactive` or `--force`

### Affected operational paths

Runtime API paths:

- none

Key developer paths:

- `yarn mercato skills sync`
- `yarn mercato agentic:init`
- `create-mercato-app`

### Output summary

The command should print a compact summary like:

- files updated
- files added
- files removed
- files overwritten after interactive confirmation
- files skipped because of local modifications
- whether bootstrap mode was used

Machine-readable output is out of scope for v1.

## Configuration

### Defaults

| Setting | Default | Why |
|---------|---------|-----|
| source repo | `open-mercato/open-mercato` | same repo, no extra distribution surface |
| source ref | `develop` | latest OM guidance with minimum ceremony |
| profile | `standalone-app` for standalone apps | matches current generated skill set |

### Files intentionally out of scope

This v1 syncs only:

```text
.ai/skills/
```

It does not automatically sync:

- `AGENTS.md`
- `.ai/specs/`
- `.ai/qa/`
- `.ai/guides/`

That is a deliberate scope cut to keep the first implementation small and safe.

## Alternatives Considered

### 1. Separate plugin repository and marketplace distribution

Rejected because it adds an unnecessary operational surface and mainly benefits Claude Code. It does not naturally solve the same problem for Codex, Cursor, or existing repositories that already depend on local `.ai/skills/`.

### 2. Keep frozen scaffold-time copies forever

Rejected because drift is the core problem.

### 3. Sync from the installed npm package instead of GitHub `develop`

Rejected for the main use case. The goal is to receive the latest Open Mercato skill updates from `develop` without requiring the whole app to upgrade to a new published CLI version first.

### 4. Always overwrite local files

Rejected because it destroys intentional project-specific skill edits.

### 5. Always skip modified files without asking

Rejected because the command is explicitly manual. When a developer runs it in a terminal, asking for confirmation on conflicts is a better default than silently doing less work than requested.

### 6. Sync more than `.ai/skills/` in v1

Rejected for now. Skills are the highest-value drift source, while syncing AGENTS/guides/spec templates would widen the change surface and make safe local customization harder.

## Risks & Impact Review

| Risk | Severity | Affected area | Mitigation | Residual risk |
|------|----------|---------------|------------|---------------|
| GitHub unavailable or slow | Medium | manual sync | sync fails clearly and leaves local files untouched | developers may temporarily stay stale |
| Existing repos without manifest cannot safely infer prior local edits | Medium | old standalone apps, external repos | bootstrap mode records baseline and performs no overwrite on first run | one extra manual run is required before updates apply |
| Command is run in CI or piped shell with modified skills present | Medium | automation, non-TTY environments | require `--non-interactive` or `--force` when no TTY is available | callers must choose the intended behavior explicitly |
| Skill references drift against unsynced `AGENTS.md` or guide files | Medium | long-lived older apps | keep skill IDs stable; keep v1 scope explicit; document that only skills are synced | some guidance links may age separately |
| Upstream deletes a skill that a project depends on locally | Low | custom repositories | only remove files that are still unmodified since last sync | local custom or modified files remain |
| Tooling confusion between generated files and synced files | Low | create-app + agentic:init | keep `.ai/skills` layout unchanged and use a single manifest file inside the directory | documentation updates still required |

## Migration & Backward Compatibility

### Backward compatibility

This spec is additive against the contract surfaces in `BACKWARD_COMPATIBILITY.md`:

- existing CLI commands remain unchanged
- new `skills sync` command is additive
- `agentic:init` remains available and keeps its current purpose
- `yarn dev` behavior remains unchanged
- `.ai/skills/` layout is preserved

### Existing apps and repositories

Migration flow:

1. Run `yarn mercato skills sync`
2. The first run bootstraps `.ai/skills/.mercato-sync.json` without changing any skills
3. Run `yarn mercato skills sync` again to pull official updates safely

### New apps

New `create-mercato-app` scaffolds still receive local skill files immediately and can work offline after scaffolding. Manual sync becomes available as an explicit follow-up command.

## Implementation Plan

1. Add CLI command parsing for `yarn mercato skills sync`.
2. Implement sync engine with:
   - upstream archive download
   - manifest read/write
   - bootstrap mode
   - interactive conflict prompt
   - `--non-interactive` skip-modified behavior
   - `--force`
3. Generate `.ai/skills/.mercato-sync.json` from:
   - `packages/create-app/src/setup/tools/shared.ts`
   - `packages/cli/src/lib/agentic-setup.ts`
4. Document the flow in:
   - `packages/create-app/AGENTS.md`
   - user-facing scaffold output where appropriate
5. Verify:
   - new standalone scaffold writes the baseline manifest
   - existing app first-run bootstrap behavior
   - interactive prompt appears for a modified local skill
   - `o` overwrites one file
   - `s` skips one file
   - `a` overwrites all remaining modified files
   - `k` skips all remaining modified files
   - non-TTY conflict fails clearly without flags
   - `--non-interactive` skips modified files
   - `--force` overwrites modified files

## Final Compliance Report

| Requirement | Status | Notes |
|-------------|--------|-------|
| No separate repo or plugin | Compliant | source stays in the main Open Mercato repository |
| Keep `.ai/skills/` layout unchanged | Compliant | lifecycle changes only |
| Use official Mercato CLI | Compliant | new `yarn mercato skills sync` command |
| Protect local customizations | Compliant | manifest-based detection plus explicit per-conflict confirmation |
| Keep manual sync ergonomic | Compliant | interactive by default in terminal sessions |
| Keep sync explicit and manual | Compliant | no `yarn dev` automation in v1 |
| Avoid breaking existing CLI/dev flows | Compliant | additive command only; no dev runtime changes |

## Changelog

- **2026-04-24**: Initial proposal for official Mercato CLI-based skill synchronization from `open-mercato` `develop`, replacing the separate plugin/repository direction.
- **2026-04-25**: Simplified the proposal to a manual-only sync model; removed `yarn dev` auto-sync and related wizard/runtime changes.
- **2026-04-25**: Changed conflict handling to interactive-by-default with `--non-interactive` skip mode and `--force` overwrite mode.
