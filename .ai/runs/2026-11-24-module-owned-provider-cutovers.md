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

## Progress

PR: #10542

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Named workflow rules

- [x] 1.1 Migrate and verify named START and transition evaluation. — 7609d9ad67

### Phase 2: Audit history

- [ ] 2.1 Migrate and verify scoped conflict and notification history reads.

### Phase 3: Record Locks settings

- [x] 3.1 Migrate and verify atomic tenant-setup initialization. — c576b734e1

### Phase 4: Example workflows

- [x] 4.1 Migrate and verify scoped create-if-absent example seeding. — ec5269453f

### Phase 5: Integration

- [ ] 5.1 Sync prerequisites and verify the combined implementation.
