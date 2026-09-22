# Notify — 2026-09-22-release-2-availability-contract

> Append-only log. Every entry is UTC-timestamped. Never rewrite prior entries.

## 2026-09-22T00:00:00Z — run started
- Brief: Implement `.ai/specs/2026-08-14-availability-contract.md` §13 Phases 1 and 2 only (shared availability contract + `availability` policy module + `wms` provider). Phase 3 (reservations) and all other ecommerce-suite specs are explicit non-goals.
- External skill URLs: none
- Classified as a Spec-implementation run (spec-driven, multi-phase, new module + DB entity + migration, UI + API + tests together).

## 2026-09-22T12:30:00Z — checkpoint 1 (Steps 1.1–2.4)
- Steps landed: shared availability contract (types/registry/catalog-only fallback), `availability` module skeleton + entity/migration + policy resolution chain + commands + CRUD API route + integration spec.
- Full `packages/shared` + `packages/core` test suites and both typechecks green; `yarn generate`/`yarn db:generate` no-op check for `availability` passed.
- Fixed two full-suite regressions the new module surfaced: `auth` module's ACL-feature i18n catalog guard (added `auth.acl.features.availability.*` keys, all 5 locales) and the enterprise `record_locks` coverage guard (added the `availability:AvailabilityPolicy` decision, `status: 'enabled'`, standard `makeCrudRoute` wiring).
- Caught and fixed a real gap during Step 2.4: the create command was missing tenant/org scope validation on the client-supplied payload (present on update/delete, missing on create) — a client could otherwise have created a policy row under an arbitrary tenant. Fixed before commit.
- Decision: the new `TC-AVAIL-001-policies-crud.spec.ts` Playwright integration spec could not be executed in this sandbox (no container runtime for the ephemeral Postgres + live app server it needs) — typechecked cleanly against real helper signatures instead; deferred to the final gate for actual execution.
