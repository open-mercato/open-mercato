# Final Compliance Review

This is the final gate after checklist review and before approval.

## Objective

Verify the spec is aligned with all relevant AGENTS rules and internally consistent.

## Process

1. Identify all relevant `AGENTS.md` files using the root Task Router.
2. Read each related guide; do not skip applicable module/package rules.
3. Cross-reference each MUST rule and mark status: Compliant, Non-compliant, or N/A.
4. Re-read the spec for internal consistency (data, APIs, UI, risks, commands, cache).
5. Append the Final Compliance Report to the spec before changelog.

## AGENTS.md Cross-Reference Procedure

1. Start from root `AGENTS.md` task rows matching the spec scope.
2. Expand to all package/module guides named by those rows.
3. Extract concrete MUST statements from each guide.
4. Map each MUST statement to a spec section or a gap.
5. Record unresolved gaps as non-compliant items with actionable recommendations.

## Compliance Matrix Template

```markdown
### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Uses FK IDs only |
| root AGENTS.md | Filter by organization_id | Compliant | All queries scoped |
| root AGENTS.md (Design System Rules) | No hardcoded Tailwind status colors / arbitrary text sizes; use semantic tokens and the text scale | Compliant / Non-compliant | List any `text-red-*` / `text-[13px]` / inline `<svg>` survivors and the page they live on |
| `.ai/ds-rules.md` + `.ai/ui-components.md` | Use shared UI primitives (`StatusBadge`, `Alert`, `FormField`, `SectionHeader`, `CollapsibleSection`, `LoadingMessage`/`Spinner`/`DataLoader`, `EmptyState`); dialogs `Cmd/Ctrl+Enter` + `Escape`; `aria-label` on icon-only buttons | Compliant | Cite the spec UI section that mentions each primitive |
| packages/core/AGENTS.md → API Routes | CRUD routes use `makeCrudRoute` with `indexer: { entityType }` | Compliant / Non-compliant | Cite the file path the spec proposes |
| packages/core/AGENTS.md → Encryption | Sensitive / GDPR fields are declared in `<module>/encryption.ts` `defaultEncryptionMaps` and read via `findWithDecryption` | Compliant / Non-compliant | List the entity / field set; flag any hand-rolled `crypto.subtle` or "encrypt later" stubs |
| packages/ui/AGENTS.md | Backend forms use `<CrudForm>`; lists use `<DataTable>` with stable `entityId`/`extensionTableId`; non-`CrudForm` writes use `useGuardedMutation` | Compliant | — |
| packages/ui/src/backend/AGENTS.md | All HTTP goes through `apiCall` / `apiCallOrThrow` (never raw `fetch`) | Compliant | — |
| packages/cache/AGENTS.md | Cache resolved via DI; tenant-scoped tags; tag-based invalidation declared per write path | Compliant | — |
| packages/events/AGENTS.md | Cross-module side effects go through `createModuleEvents` + subscribers, not direct imports | Compliant | — |
| packages/core/AGENTS.md | API routes MUST export openApi | Non-compliant | Missing on GET /api/... |
| ... | ... | ... | ... |
```

## Report Format

```markdown
## Final Compliance Report — {YYYY-MM-DD}

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/<relevant>/AGENTS.md`
- ...

### Compliance Matrix
{table}

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass / Fail | ... |
| API contracts match UI/UX section | Pass / Fail | ... |
| Risks cover all write operations | Pass / Fail | ... |
| Commands defined for all mutations | Pass / Fail | ... |
| Cache strategy covers all read APIs | Pass / Fail | ... |

### Non-Compliant Items

For each non-compliant item:
- **Rule**: Exact rule text
- **Source**: Which AGENTS.md file
- **Gap**: What is missing or wrong
- **Recommendation**: Specific fix needed

### Verdict
- **Fully compliant**: Approved — ready for implementation
- **Non-compliant**: Blocked — items must be resolved before implementation
```
