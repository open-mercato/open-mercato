# Provision encryption keys before application startup

Status: implemented; local verification complete. Follow-up to PR #8377.

## Problem and implementation

Blank example keys must not silently disable tenant encryption. Before CLI
initialization, greenfield, server or worker bootstrap, and direct Next dev/start,
prepare the application's effective `.env` files. When encryption is on (the
default), fill empty roots with a cryptographically random 32-byte secret,
persisted before exposing it to the process. Never replace any non-empty key,
including a published development root. Existing published roots produce a warning
with backup requirements and a rotation CLI example. Preserve existing roots and the legacy-key precedence; never generate a separate
lookup pepper, since doing so changes existing lookup hashes.

Preserve each launcher's file precedence: direct Next uses mode-specific files,
including `.env.local`, while CLI keeps its existing `.env` loader. An existing
root shadowed by empty values prevents competing-root generation and warns.
CLI env-file lookup uses the active app's filesystem layout and its Git boundary,
never the target of a borrowed workspace-package symlink. Both env loading and
provisioning use that same lookup.
If the discovered app has no env file, early loading retains the requested
working directory's env-file fallback without reading from another checkout.
Validate inherited
keys before dotenv can hide their origin. Externally managed keys may belong to
an existing deployment, so published external roots and process/file conflicts
warn with backup and migration advice, preserving the existing process precedence
and every configured key. Startup does not probe the database. Existing opt-in
implicit development roots are likewise preserved with a warning. Missing env
files or fresh copies from `.env.example` get random roots; published sample roots
can be replaced only while creating that first env file, before data initialization.
Environment-only private keys remain supported without requiring writable files.
Disabled encryption and read-only CLI commands do not provision keys. File writes
are private, atomic, and serialized across concurrent startup processes.
Every write announces its path and changed variable names without secrets.
`OM_ENCRYPTION_STARTUP_UNSAFE_SKIP` is an additive, default-off unsafe opt-out
that bypasses provisioning/checks and warns that previous behavior is retained.

## Migration & Backward Compatibility

This is the user-requested change to unsafe startup defaults; exported crypto
interfaces, derivation, ciphertext, database schema, CLI flags and API routes stay
unchanged. Existing private keys are retained. Administrators must preserve old
roots and migrate existing ciphertext and lookup hashes before replacing a
published key. A non-empty published root is never automatically replaced.
Automatic provisioning is for new installations; it is not data
rotation. Inherited keys without a matching env file also warn, since those may
belong to an existing environment-only installation. Configured keys and conflicts
never block startup solely because of their value; necessary persistence failures
when no root is configured still stop startup instead of silently disabling encryption.
Downstream apps need the updated CLI and Next config hook.

## Verification

Self-contained temporary-file and subprocess regressions cover generation,
restart stability, private and legacy keys, disabled encryption, process/file
conflicts, dotenv syntax/precedence, read-only environment deployments, failed
writes, simultaneous launches, and supported startup entrypoints. No API or UI
paths change. Build the affected packages and check template parity.

Local verification: 160 checks pass, including 24 real Next HTTP fixture starts
across monorepo/standalone, Webpack/Turbopack dev and production, with empty,
saved-default, external-default and unsafe configurations. Shared and CLI builds,
focused TypeScript checks, MDX compilation, template sync and lessons validation
pass. See [the report](../qa/reports/2026-11-01-startup-encryption.md) for exact scope,
command alias coverage and remaining full-app/installation validation limits.

## Changelog

- 2026-11-02: Isolated CLI env reads/writes to the active checkout when worktrees
  share package symlinks; added standalone and monorepo regressions that failed
  before the fix and verify the foreign checkout is untouched afterward.
- 2026-11-02: Review caught the missing production env-only cwd fallback; restored
  it within the requested checkout and added failing-before/passing-after implicit
  and explicit cwd regressions covering early telemetry configuration.

- 2026-11-01: Drafted startup provisioning and mismatch guard requested for #8377.
- 2026-11-01: User clarified that no non-empty key may be changed, including dummy
  defaults. Existing published keys are preserved, with backup/rotation warnings;
  externally managed keys and conflicts also warn without blocking existing
  deployments. Updated user and architecture docs with backup-first rotation examples.
