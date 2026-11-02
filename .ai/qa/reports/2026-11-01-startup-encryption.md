# Startup encryption verification — PR #8377 follow-up

Runner: local. Result: **164 passed, 0 failed, 0 skipped**, including **24 live HTTP
startup cases**. Tests use disposable fixtures and never apply application
migrations or reset a developer database. This is evidence for the local follow-up
implementation, not certification of the separate production preflight currently
proposed in PR #8377.

## Verified live runtime matrix

Each cell covers four cases: empty file keys, a saved published fallback,
an externally supplied published fallback overriding blank file keys, and the
explicit unsafe opt-out with empty keys.

| Shipped config | Next dev / Webpack | Next dev / Turbopack | Next build + start |
| --- | --- | --- | --- |
| Monorepo | 4/4 pass | 4/4 pass | 4/4 pass |
| Create-app standalone | 4/4 pass | 4/4 pass | 4/4 pass |

Every live case serves HTTP 200 and checks the server-rendered fingerprint of
the effective root. Empty keys receive persistent random roots and an explicit
file-change notice. Saved/external roots remain unchanged, warnings include backup
and CLI rotation instructions, and unsafe mode leaves blank keys untouched.
Production build leaves the env file unchanged; production start prepares keys.

The live fixtures contain a minimal Next page rather than the full business app.
They use the shipped config and real encryption guard; unrelated CSP/origin
helpers are stubbed, package transpilation is unnecessary for the fixture page,
and Turbopack's root includes the shared test dependency directory. This proves
startup-hook behavior and HTTP serving, not module/database functionality.

## Command and variant coverage

| Public launch commands inspected | Common entrypoint verified |
| --- | --- |
| Root `dev`, `dev:classic`, `dev:verbose` | CLI dev preparation + both live dev bundlers |
| Root `dev:greenfield`, `dev:greenfield:classic`, `dev:greenfield:verbose` | CLI `init` / `db greenfield` preparation + live dev |
| Root `dev:ephemeral`, `dev:ephemeral:classic`, `dev:ephemeral:verbose` | Same app dev runtime after ephemeral infrastructure setup |
| Root `dev:app`, `dev:app:verbose`, `dev:profile` | Same app dev runtime |
| App workspace `dev`, `dev:classic`, `dev:verbose` | CLI dev preparation + live monorepo config |
| Standalone `dev`, `dev:classic`, `dev:verbose` | CLI dev preparation + live standalone config |
| Standalone `setup`, `setup:classic`, `setup:reinstall`, `setup:reinstall:classic` | CLI initialization preparation + live standalone dev |
| Root/workspace/standalone `start` | CLI production preparation + live build/start |
| Direct `mercato server dev`, `mercato server start`, Next dev/start | Preparation subprocesses + corresponding live runtime |
| `initialize`, `db:greenfield`, `db:migrate`, seeding, queue workers | Preparation subprocesses before database/bootstrap work |

The full outer orchestration scripts, destructive greenfield operations,
ephemeral Docker provisioning, full business-app HTTP routes, and actual Docker
container startup were **not** executed. The matrix identifies the common tested
runtime; it does not claim every outer shell command completed end to end.
Existing launcher-lifecycle, template-script-target, Compose environment and root
Compose parity checks pass. Compose only gains propagation of the default-off
unsafe opt-out to encryption consumers; its existing default keys are retained.
No remote PR branch was changed.

After adding Compose propagation of the unsafe opt-out, its focused environment
and parity suite was rerun: **14/14 passed**, including six new propagation cases.

## Data-safety and compatibility checks

- A real KMS-derived tenant DEK decrypts existing AES-GCM ciphertext after startup
  with a published root; lookup hashes remain identical.
- Saved preferred/legacy roots, dedicated lookup peppers, environment-only roots,
  and the opt-in implicit development root are preserved.
- CLI retains `.env` precedence; direct Next retains mode-specific precedence.
  Shadowed existing roots prevent generation of a competing root.
- External/file conflicts warn, preserving previous process precedence and both
  sources. No secret values appear in notices or warnings.
- Concurrent startup processes return the same persisted-root fingerprint.
- Private file permissions, atomic writes, write-failure cleanup, restart
  stability, and explicit changed-file notices are verified.
- Existing private keys containing escaped newlines retain dotenv's original
  parsing semantics; the guard does not reinterpret them through another parser.
- Disabled encryption and default-off `OM_ENCRYPTION_STARTUP_UNSAFE_SKIP` behavior
  are verified. Help/build/generate do not provision keys.
- Both encryption MDX documents compile; template sync, env parity, lessons
  validation, focused TypeScript checks, and shared/CLI package builds pass.

## Reproduction

```bash
OM_ENCRYPTION_STARTUP_LIVE=1 node --import tsx --test \
  scripts/__tests__/encryption-startup.test.mjs \
  packages/create-app/src/lib/template-env-parity.test.ts \
  packages/create-app/src/lib/template-security-headers.test.ts \
  packages/create-app/src/lib/template-node-protocol-imports.test.ts \
  packages/create-app/src/lib/template-script-targets.test.ts \
  packages/create-app/src/lib/template-optimize-package-imports.test.ts \
  scripts/__tests__/dev-runtime-lifecycle.test.mjs \
  scripts/__tests__/root-compose-backcompat.test.mjs \
  scripts/__tests__/fullapp-compose-runtime-env.test.mjs
```

Live tests are opt-in; the normal scripts suite skips only those live cases.
Processes have timeouts and are stopped by their owned process IDs; fixtures are
removed afterward. The installed Next/SWC and esbuild host/native versions in the
local environment were mismatched. Matching native tools were selected from an
isolated external cache for the final passing run; no dependency manifests or
lockfiles were changed. Broader shared-package typechecking still reports seven
unrelated missing/stale cross-package declarations in this dependency installation;
the changed startup helpers pass focused typechecking. Full repository validation
and a freshly published Verdaccio standalone installation were not performed.

## Checkout-isolation follow-up — 2026-11-02

CLI env lookup now resolves the active app from its on-disk layout and stops at
its Git boundary. It does not infer env ownership from installed package symlinks.
Both early loading and provisioning, plus the ordinary CLI loader, share that
lookup. Standalone and monorepo regressions with two distinct borrowed-dependency
checkouts failed before this fix and pass afterward, proving that foreign env
files are neither loaded nor modified.

The non-live startup and Compose run passes 70 cases; 24 opt-in live cases were
skipped in that initial narrow run. The complete follow-up run then passes all
164 cases, including all 24 live HTTP starts and the additional checkout-isolation
and Compose propagation cases. Shared/CLI builds, focused TypeScript checking,
MDX compilation, lessons validation and template parity checks pass. The template
check used the equivalent direct Node/tsx script because this worktree has no
Yarn node_modules state file. No dependency manifests or lockfiles changed.

Independent review identified a missing cwd env fallback for production env-only
startup. The correction retains that fallback inside the requested checkout;
explicit cwd loading cannot leak settings from an unrelated process cwd. Both
new production/telemetry regressions failed before the correction and pass after
it, alongside the two symlink-isolation regressions (4/4 focused checks).
Two additional failing-before/passing-after cases verify that root env keys and
an explicit encryption-off setting are honored before provisioning. All loaders
and the preparer now use the same selected env-file path (6/6 focused checks).

Independent re-review approved commit `ecf6a08333` after verifying the six focused
regressions and supplemental boundary/precedence probes. The reviewer made no
source changes. The parent's final run passes all 164 cases with no skips, and
the CLI package build passes. Disposable live fixture directories are ignored by
Git so concurrent task snapshots cannot stage them.
