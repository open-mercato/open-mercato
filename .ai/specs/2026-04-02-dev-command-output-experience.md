# Dev Command Output Experience

## TLDR
**Key Points:**
- `yarn dev` and `yarn dev:greenfield` currently feel noisy because they are shell-chained workflows that dump raw Turbo, generator, Next, worker, and scheduler output into one stream.
- The fix is not more ad hoc `console.log` cleanup. It is a dedicated dev runner that owns orchestration, log modes, stage progress, failure presentation, and service status.

**Scope:**
- Improve the developer experience of root `yarn dev` and `yarn dev:greenfield`.
- Improve the equivalent standalone-app experience in `apps/mercato` and `packages/create-app/template`.
- Reduce low-signal build/watch spam while keeping failures, warnings, and live service status visible.

**Concerns:**
- Hidden output is unacceptable if it makes failures harder to diagnose.
- The solution must work in TTY and non-TTY environments and must preserve a verbose passthrough mode.

## Overview

Open Mercato’s developer workflow has become technically stronger, but the terminal experience still feels like a pile of unrelated subprocesses. Root `yarn dev` is currently:

```bash
yarn build:packages && yarn watch:packages & sleep 3 && yarn dev:app
```

and root `yarn dev:greenfield` is:

```bash
yarn build:packages && yarn generate && yarn build:packages && yarn initialize -- --reinstall && yarn dev
```

At the app level, `apps/mercato` and the standalone template still run:

```bash
mercato generate watch & mercato server dev
```

That means package builds, generator watch, Next dev, workers, and scheduler all print directly into the same terminal. The result works, but it does not feel deliberate.

> **Market Reference**: adopt the concise, stage-oriented feel of `vite`, `pnpm`, and polished `bin/dev` workflows: short progress phases, compact ready summaries, and raw logs only when needed. Reject a mandatory full-screen TUI as the default because it complicates CI, copy-paste debugging, and remote terminals.

## Problem Statement

The current developer experience has four concrete issues.

1. Root scripts are shell orchestration, not productized workflows.
2. Turbo package build output is too verbose for the success path.
3. Long-running services print startup chatter without a clear steady-state dashboard.
4. `yarn dev:greenfield` mixes destructive/setup phases with normal dev startup, but the terminal never makes the phase boundaries or progress obvious.

Observed current-state characteristics:
- root `yarn dev` shows full `turbo run build` output before the actual dev services are ready
- root `yarn dev:greenfield` prints several full command transcripts back-to-back
- app-level `mercato generate watch & mercato server dev` creates interleaved output from generator watch, Next, queue worker, and scheduler
- success-path output is high-volume, but the high-signal questions developers care about are simple:
  - what phase is running right now
  - is it healthy
  - how long is it taking
  - which URL is ready
  - which service failed if something broke

This is a developer-experience defect, not a correctness defect.

## Proposed Solution

Introduce a dedicated orchestration layer for development commands and make it the single owner of terminal presentation.

### Core idea

Replace shell-chained script behavior with CLI-managed flows:

- `yarn dev` -> `mercato dev`
- `yarn dev:greenfield` -> `mercato dev greenfield`
- app/template `yarn dev` -> `mercato dev --app-only`

The new runner will:
- execute setup phases as explicit named stages
- suppress low-signal subprocess output by default
- show compact progress/status lines for successful phases
- stream warnings and errors immediately
- preserve full logs in memory and optional log files
- provide `--verbose` passthrough mode when raw output is needed

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| Replace shell chaining with a CLI dev runner | Shell scripts cannot manage concurrent logs, readiness, retries, or status rendering cleanly. |
| Keep current command names additive at the package.json surface | Developers should still type `yarn dev` and `yarn dev:greenfield`. |
| Default to compact success-path output | Most dev sessions are healthy; the terminal should optimize for the common case. |
| Keep a full verbose mode | Debugging must never be blocked by the pretty mode. |
| Use Turbo’s native log controls where possible | `--output-logs errors-only`, `--log-order grouped`, and `--log-prefix none` already solve part of the problem. |
| Fall back to custom log aggregation for long-running services | Next, generator watch, workers, and scheduler need richer status handling than Turbo alone provides. |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Manually remove some `console.log` calls from CLI commands | Reduces noise slightly but does not solve orchestration or mixed-process output. |
| Keep shell scripts and add more `&& echo` markers | Still brittle and not capable of structured progress or log buffering. |
| Make Turbo TUI the default | Too heavy for many terminals and not suitable as the only UX. |
| Hide almost all output permanently | Unsafe; failures would become opaque. |

## User Stories / Use Cases

- **Core developer** wants `yarn dev` to show a clean startup sequence so they can see readiness fast without scrolling through package build noise.
- **Core developer** wants `yarn dev:greenfield` to feel like a guided reset workflow so they know which phase is running and where time is being spent.
- **Standalone app developer** wants the same calm output style in a generated app so first-run experience feels polished.
- **Maintainer** wants `--verbose` mode so deep debugging still exposes the raw underlying command output.
- **CI or non-TTY user** wants plain, stable line-oriented output instead of spinner-heavy presentation.

## Architecture

### Command model

Add a new CLI module for dev orchestration:

```ts
type DevMode = 'dev' | 'greenfield'
type OutputMode = 'pretty' | 'plain' | 'verbose' | 'json'

type DevStageId =
  | 'build-packages'
  | 'generate'
  | 'build-packages-post-generate'
  | 'initialize'
  | 'watch-packages'
  | 'watch-generators'
  | 'next-dev'
  | 'queue-worker'
  | 'scheduler'

type DevStageState = 'pending' | 'running' | 'ready' | 'failed' | 'skipped'
```

New CLI entrypoints:

```bash
mercato dev
mercato dev greenfield
mercato dev --app-only
mercato dev --verbose
mercato dev --plain
mercato dev --json
```

### Orchestration flow

#### `mercato dev`

1. run package build phase with compact progress
2. start package watch in background
3. start generator watch in background
4. start Next dev in background
5. start queue worker in background if enabled
6. start scheduler in background if enabled
7. render a persistent compact status block until exit

#### `mercato dev greenfield`

1. build packages
2. generate artifacts
3. rebuild packages
4. run initialize with reinstall
5. transition into normal `mercato dev`

The greenfield flow should feel like one cohesive product flow, not several unrelated commands chained together.

### Output modes

#### `pretty` mode

Default for interactive TTY.

Behavior:
- one-line phase progress during setup
- short success summaries with elapsed times
- compact service dashboard after startup
- warnings/errors streamed immediately
- raw subprocess logs suppressed unless flagged high-signal

Example shape:

```text
Open Mercato Dev

Setup
  ✓ Build packages              4.0s
  ✓ Generate artifacts          2.2s
  ✓ Rebuild packages            3.7s

Services
  ✓ Next dev                    ready   http://localhost:3000
  ✓ Generator watch             watching structural files
  ✓ Queue workers               8 queues, local strategy
  ✓ Scheduler                   polling every 30s

Tips
  press v to toggle verbose logs
  press l to show last error log tail
  press q / Ctrl+C to stop
```

#### `plain` mode

Default for non-TTY or `--plain`.

Behavior:
- no spinners
- deterministic line-oriented messages
- one line per stage transition
- suitable for CI logs and terminal copy/paste

#### `verbose` mode

Explicit passthrough mode.

Behavior:
- existing raw subprocess logs remain visible
- orchestration still adds stage boundaries and failure summaries
- intended for debugging build/watch problems

#### `json` mode

Optional machine-readable mode for future tooling:
- stage started/completed/failed
- service ready/failure
- URLs and timings

### Build-phase log suppression

Use Turbo flags first:

```bash
turbo run build --filter='./packages/*' \
  --output-logs=errors-only \
  --log-order=grouped \
  --log-prefix=none
```

For success-path builds, the runner should print:
- stage label
- elapsed time
- package count
- cached vs executed counts when available

On failure, the runner should print:
- failing package/task
- concise error tail
- hint to rerun with `--verbose`

### Long-running service aggregation

The dev runner should spawn child processes with piped stdio and classify log lines:

- `noise`: repetitive startup chatter, watch-heartbeat lines
- `status`: ready/watching/started lines used to update the dashboard
- `warning`: shown immediately and retained
- `error`: shown immediately, retained, and surfaced in dashboard state
- `important`: URLs, credentials, port changes, warmup summary

Initial classifier targets:
- Next dev output
- generator watch output
- queue worker startup lines
- scheduler startup lines

### Failure behavior

Failures must become clearer, not quieter.

On any stage or service failure:
- stop the spinner/dashboard
- print a red failure summary
- show the last `N` relevant log lines for the failing subprocess
- point to a persisted raw log file if enabled

Suggested log location:

```text
.mercato/logs/dev/<timestamp>-<stage>.log
```

### Script changes

Root `package.json`:

```json
{
  "dev": "yarn mercato dev",
  "dev:greenfield": "yarn mercato dev greenfield"
}
```

App and template:

```json
{
  "dev": "mercato dev --app-only"
}
```

This preserves the public script names while centralizing behavior in the CLI.

## Data Models

No persistent database model changes.

Ephemeral runner state only:

### DevRunState
- `mode`: `'dev' | 'greenfield'`
- `outputMode`: `'pretty' | 'plain' | 'verbose' | 'json'`
- `startedAt`: number
- `stages`: `DevStageRuntime[]`
- `services`: `DevServiceRuntime[]`
- `lastFailure`: `DevFailure | null`

### DevStageRuntime
- `id`: `DevStageId`
- `label`: string
- `state`: `pending | running | ready | failed | skipped`
- `startedAt`: number | null
- `completedAt`: number | null
- `durationMs`: number | null

### DevServiceRuntime
- `id`: `'next' | 'generator-watch' | 'watch-packages' | 'queue' | 'scheduler'`
- `label`: string
- `state`: `pending | running | ready | failed | stopped`
- `detail`: string | null
- `pid`: number | null

## API Contracts

No HTTP API changes.

CLI contract additions:

### `mercato dev`
- starts the standard developer flow
- defaults to `pretty` in TTY and `plain` in non-TTY

### `mercato dev greenfield`
- runs destructive reset/setup stages, then starts normal dev

### Flags

```text
--app-only
--verbose
--plain
--json
--no-build
--no-watch-packages
--no-workers
--no-scheduler
--log-file
```

### Environment variables

```text
MERCATO_DEV_OUTPUT=pretty|plain|verbose|json
MERCATO_DEV_LOG_FILE=1
MERCATO_DEV_ERROR_TAIL_LINES=80
```

Backward compatibility:
- `yarn dev` and `yarn dev:greenfield` remain the user-facing commands
- app/template `yarn dev` remains the user-facing command
- no removal of existing lower-level CLI commands such as `mercato server dev` or `mercato generate watch`

## Internationalization (i18n)

No user-facing app i18n changes.

CLI copy should remain English-only for now and concise. If CLI localization is ever introduced, it should be a separate spec.

## UI/UX

Terminal UX goals:
- cleaner than the current raw stream
- visually structured without becoming gimmicky
- strong success-path compression
- immediate and readable failure output

Specific UX rules:
- one branded header at startup, not repeated banners from every subprocess
- fixed stage names with elapsed times
- service section shows current state and key details
- ready state always surfaces the app URL prominently
- `greenfield` mode shows destructive/setup phases distinctly from live services
- avoid emoji spam; use a restrained visual system

## Configuration

Default behavior:
- TTY -> `pretty`
- non-TTY -> `plain`
- explicit `--verbose` or `MERCATO_DEV_OUTPUT=verbose` -> raw passthrough

The runner should also honor existing controls:
- `AUTO_SPAWN_WORKERS`
- `AUTO_SPAWN_SCHEDULER`
- `QUEUE_STRATEGY`

## Migration & Compatibility

- No database migration required.
- No module-discovery changes.
- No generated-file contract changes.
- Existing script names remain unchanged.
- Existing low-level commands remain supported for power users and automation.

Rollout strategy:
1. add `mercato dev` and `mercato dev greenfield`
2. switch root/app/template scripts to call them
3. keep `mercato server dev` and `mercato generate watch` available
4. document `--verbose` as the escape hatch for raw logs

## Implementation Plan

### Phase 1: Dev Runner Foundation
1. Add a new CLI dev orchestration module.
2. Implement stage/runtime state tracking.
3. Add output-mode selection for TTY vs non-TTY.
4. Switch root `package.json` scripts to the new CLI entrypoints.

### Phase 2: Compact Build And Setup Output
1. Route package-build phases through Turbo with compact log flags.
2. Summarize successful build/generate/initialize phases with durations instead of full output.
3. On failure, print concise tails plus a `--verbose` hint.

### Phase 3: Long-Running Service Dashboard
1. Pipe output from Next, generator watch, queue workers, and scheduler.
2. Classify lines into status/noise/warning/error buckets.
3. Render a stable service section with readiness state and details.
4. Preserve raw logs for failure-tail display and optional log-file persistence.

### Phase 4: Greenfield UX
1. Move `yarn dev:greenfield` to `mercato dev greenfield`.
2. Present reset/build/generate/initialize as guided stages.
3. Transition cleanly into the steady-state dev dashboard without restarting the whole renderer.

### File Manifest

| File | Action | Purpose |
|------|--------|---------|
| `packages/cli/src/mercato.ts` | Modify | Register new `dev` commands or delegate to a new module |
| `packages/cli/src/lib/dev/*` | Create | Orchestration, rendering, log classification, stage state |
| `package.json` | Modify | Point root `dev` and `dev:greenfield` to the new CLI runner |
| `apps/mercato/package.json` | Modify | Replace shell backgrounding with `mercato dev --app-only` |
| `packages/create-app/template/package.json.template` | Modify | Keep standalone template aligned |

### Testing Strategy

- Unit: output-mode selection and TTY fallback behavior
- Unit: log-line classification for Next/generator/worker/scheduler
- Unit: failure-tail extraction and summary formatting
- Unit: stage transitions in `dev` and `greenfield` flows
- Integration: root `yarn dev` happy path
- Integration: root `yarn dev:greenfield` happy path
- Integration: failing package build shows concise failure summary and non-zero exit
- Integration: standalone template `yarn dev` uses the same compact runner

### Integration Coverage

| Scenario | Coverage |
|----------|----------|
| Monorepo `yarn dev` successful startup | Integration |
| Monorepo `yarn dev` package build failure | Integration |
| Monorepo `yarn dev:greenfield` successful startup | Integration |
| Monorepo `yarn dev --verbose` passthrough | Integration |
| Standalone app `yarn dev` successful startup | Integration |
| Non-TTY plain output mode | Unit / integration |

## Risks & Impact Review

#### Hidden Failure Detail
- **Scenario**: Compact mode suppresses the exact log line a developer needs to debug a failure.
- **Severity**: High
- **Affected area**: package builds, generators, Next startup, worker startup
- **Mitigation**: always show a failure tail, preserve raw logs, and support `--verbose` passthrough.
- **Residual risk**: Low if failure tails and verbose mode are tested.

#### Fragile Log Parsing
- **Scenario**: The runner relies too heavily on exact output text from Next or Turbo and breaks when upstream wording changes.
- **Severity**: Medium
- **Affected area**: service readiness detection, warning classification
- **Mitigation**: keep parsing shallow and pattern-based, treat unmatched lines as generic logs, and prefer process lifecycle events plus a few high-confidence markers.
- **Residual risk**: Medium because third-party CLIs do change wording over time.

#### TTY-Only UX Regresses CI Or Remote Shells
- **Scenario**: Pretty output assumes an interactive terminal and becomes unreadable in CI, tmux logs, or file redirection.
- **Severity**: Medium
- **Affected area**: automation, remote development
- **Mitigation**: default non-TTY sessions to `plain`, keep `json` optional, avoid mandatory cursor control in plain mode.
- **Residual risk**: Low.

#### Root And Template Flows Drift
- **Scenario**: Monorepo `yarn dev` gains the new UX but the standalone template keeps the old shell-based output.
- **Severity**: High
- **Affected area**: first-run standalone developer experience
- **Mitigation**: drive both from the same CLI command and update template scripts in the same change.
- **Residual risk**: Low if covered by standalone integration checks.

#### Compact Success Output Hides Useful Warnings
- **Scenario**: A warning is misclassified as noise and never shown.
- **Severity**: Medium
- **Affected area**: dependency warnings, startup warnings, dev diagnostics
- **Mitigation**: surface stderr by default unless known-benign, keep warning patterns conservative, and persist raw logs.
- **Residual risk**: Medium.

## Final Compliance Report — 2026-04-02

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `.ai/specs/AGENTS.md`
- `packages/cli/AGENTS.md`
- `packages/create-app/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root `AGENTS.md` | Check existing specs before non-trivial changes | Compliant | Searched `.ai/specs/` and `.ai/specs/enterprise/` for related dev-output specs first. |
| root `AGENTS.md` | Keep command compatibility additive | Compliant | `yarn dev` and `yarn dev:greenfield` remain; new CLI runner sits behind them. |
| `.ai/specs/AGENTS.md` | New specs use `{date}-{title}.md` naming | Compliant | File uses dated kebab-case naming. |
| `packages/cli/AGENTS.md` | CLI changes should preserve generator/build workflow correctness | Compliant | Spec changes orchestration/output only; build order remains explicit. |
| `packages/create-app/AGENTS.md` | Must keep standalone app template aligned | Compliant | Template `dev` script is included in scope and file manifest. |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Problem statement matches current script wiring | Pass | References current root/app/template scripts directly. |
| Proposed solution addresses both `dev` and `dev:greenfield` | Pass | Separate flows covered in architecture and phases. |
| Monorepo and standalone are both covered | Pass | Template script changes are part of the proposal. |
| Failure diagnosis remains possible | Pass | Verbose mode, failure tails, and raw log persistence are explicit. |

### Non-Compliant Items

- None for the specification itself.

### Verdict

- **Fully compliant**: Approved — ready for implementation.

## Changelog

### 2026-04-02
- Initial specification for quieter, more intentional developer-facing output in `yarn dev` and `yarn dev:greenfield`.
