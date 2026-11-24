# Module-owned provider cutovers

Implement specs 3–6 from design PR #10508. Stack on #10540 to test the combined module boundaries while that branch implements specs 1–2. Both builds inherit prerequisites from #10129.

Source doc: .ai/specs/2026-11-24-workflow-named-rule-provider.md
Source doc: .ai/specs/enterprise/2026-11-24-record-locks-audit-history-provider.md
Source doc: .ai/specs/enterprise/2026-11-24-record-locks-settings-initialization.md
Source doc: .ai/specs/enterprise/agent-orchestrator/2026-11-24-owner-provided-example-workflow-seeding.md

## Implementation Plan

1. Characterize workflow rule behavior and move named START and transition rules behind Business Rules DI.
2. Move conflict and active-editor history retrieval to Audit Logs, preserving authorized scope and the optimistic version guard.
3. Initialize global Record Locks settings through Configs using the setup manager, with atomic merge and post-commit cache handling.
4. Create editable workflow examples through Workflows authoring, with scoped idempotency and existing DI override support.
5. Sync #10540, regenerate, run focused and configured checks, and review compatibility and failure cases.

## Risks

A missing provider must preserve optional-peer behavior. Test authorization before audit decryption, transaction and race handling for setup writes, and existing public APIs and DI overrides.

## Validation

- Synced #10540 through `7cd942a027`.
- Local runner passed package build, generation, rebuild, i18n checks, typecheck, workspace tests (51 tasks), and the Enterprise app build.
- Nine PostgreSQL integration tests passed for scoped example creation and concurrent settings initialization.
- Sixteen live checks passed across the Enterprise app runs, including CLI examples and rerun, settings repair, onboarding email, scoped history, merge and force release, and named workflow rules. Three tests for absent peers skipped in the full composition.
- Both live tests passed in the reduced Enterprise app with Configs and Audit Logs disabled.
- Compatibility review verified the public START entry point, existing DI override behavior, and the version floor. A follow-up regression test covers retaining lock decisions on audit failures.

## Progress

PR: #10542

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Named workflow rules

- [x] 1.1 Migrate and verify named START and transition evaluation. — 7609d9ad67

### Phase 2: Audit history

- [x] 2.1 Migrate and verify scoped conflict and notification history reads. — 5f68d2856a

### Phase 3: Record Locks settings

- [x] 3.1 Migrate and verify atomic tenant-setup initialization. — c576b734e1

### Phase 4: Example workflows

- [x] 4.1 Migrate and verify scoped create-if-absent example seeding. — ec5269453f

### Phase 5: Integration

- [x] 5.1 Sync prerequisites and verify the combined implementation. — 31a03f15eb
