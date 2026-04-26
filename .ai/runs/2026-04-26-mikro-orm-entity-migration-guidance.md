# MikroORM Entity Migration Guidance And Example Snapshots

## Goal

Make coding-agent guidance for new MikroORM entities match the v7 migration rules, reduce accidental unrelated `yarn db:generate` diffs by requiring scoped SQL and snapshot review, and repair stale standalone example module snapshots that currently regenerate already-committed migrations.

## Scope

- Update only agent-facing guidance in relevant `AGENTS.md` and `SKILL.md` files.
- Update only example module migration snapshots needed to make `example` and `example_customers_sync` report no changes in scaffolded standalone apps.
- Do not change runtime code or historical migration files.

## Implementation Plan

### Phase 1: Guidance Alignment

1. Clarify where coding agents should look when creating a new entity: root router, `packages/core/AGENTS.md`, customers reference guide, CLI migration guide, and standalone template guide.
2. Update MikroORM migration skill guidance with v7 entity imports plus a scoped migration workflow that treats `yarn db:generate` as a diff probe, commits only intended SQL, and always updates `.snapshot-open-mercato.json`.
3. Adjust code-review guidance so reviewers check migration snapshots and reject unrelated generated SQL instead of blindly requesting another full generation.

### Phase 2: Snapshot Repair

1. Compare example entity metadata and committed migrations against their `.snapshot-open-mercato.json` files in `apps/mercato` and `packages/create-app/template`.
2. Update stale snapshots for `example_customer_priorities` and `example_customer_interaction_mappings`, including the later `deleted_at` migration for the sync module.
3. Verify `yarn db:generate` reports `example: no changes` and `example_customers_sync: no changes`.

### Phase 3: PR Hygiene

1. Run docs/snapshot validation and self-review for backward compatibility.
2. Open a PR against `develop` with documentation/bug labels and a concise verification summary.

## Risks

- Migration snapshots are generated JSON and easy to over-edit. Mitigation: keep changes limited to the two affected example module snapshots and verify with `yarn db:generate`.
- Existing guidance appears in multiple agent bundles. Mitigation: update the canonical root/package skill files in this repo and standalone template guidance touched by this bug.
- `yarn db:generate` needs a usable database URL. If the local DB is unavailable, record the exact blocker and still verify the snapshot diff manually.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Guidance Alignment

- [x] 1.1 Clarify new-entity guidance entry points — 54b34f77a
- [x] 1.2 Update MikroORM migration skill scoped migration workflow — 54b34f77a
- [x] 1.3 Adjust code-review migration snapshot checks — 54b34f77a

### Phase 2: Snapshot Repair

- [x] 2.1 Compare example entities, migrations, and snapshots — 7f3a452aa
- [x] 2.2 Update stale example migration snapshots — 7f3a452aa
- [x] 2.3 Verify db generation reports no example changes — 7f3a452aa

### Phase 3: PR Hygiene

- [ ] 3.1 Run validation and BC self-review
- [ ] 3.2 Open PR with focused labels and summary
