# Execution plan — telemetry: sanitize SQL literals from Postgres span statements

## Goal

Postgres spans exported by `@open-mercato/telemetry` carry the query shape only — never the literal values MikroORM inlines into the SQL text.

## Background

MikroORM inlines bound parameters (`AbstractSqlConnection.execute` → `platform.formatQuery` → `CompiledQuery.raw(formatted)`), so `pg` receives a finished SQL string with no values array. `@opentelemetry/instrumentation-pg` copies `queryConfig.text` into `db.query.text` (0.73) / `db.statement` (≤0.71). `enhancedDatabaseReporting: false` only suppresses the (empty) values array, so record content, user ids and session ids leak to the OTLP backend.

## Scope

- `packages/telemetry/src/provider/sanitize-sql.ts` (new) — literal-stripping tokenizer.
- `packages/telemetry/src/provider/otlp-provider.ts` — `requestHook` on `PG_INSTRUMENTATION_OPTIONS` that overwrites `db.query.text` and `db.statement`, failing closed.
- Tests: `sanitize-sql.test.ts` (new), `pg-instrumentation.test.ts` (inlined-literal probe query).
- `packages/telemetry/README.md` Security and privacy.

## Non-goals

- Changing MikroORM to send bound parameters.
- Redacting log bodies / error messages (pg error status messages are a follow-up).
- Removing the statement attribute entirely.
- Redis/HTTP URL sanitization.

## Implementation Plan

### Phase 1: Sanitizer and wiring

1.1 Add `sanitizeSqlStatement` with unit tests (strings, E-strings, dollar quotes, numbers, booleans; identifiers, placeholders kept; unterminated → undefined).
1.2 Wire it via `requestHook` in `PG_INSTRUMENTATION_OPTIONS`; extend the child-process pg probe with an inlined-literal query.
1.3 Update the README privacy statement.

## Risks

- Over-redaction of keyword-like tokens is the safe direction.
- pg error messages on failed queries can still carry values (follow-up).

## Progress

PR: #9803

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Sanitizer and wiring

- [x] 1.1 Add sanitizeSqlStatement with unit tests — 440ec7eb23
- [x] 1.2 Wire requestHook and extend pg probe test — 440ec7eb23
- [x] 1.3 Update README privacy statement — 440ec7eb23

## Review

Independent review pass: no blockers; three minor literal leaks (nested comments, PG16 hex/underscore numbers, non-ASCII dollar tags) fixed in ce8b500271.
