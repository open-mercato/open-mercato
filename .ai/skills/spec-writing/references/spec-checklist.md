# Spec Review Checklist

Use this checklist during review. Every item must be explicitly answered in the spec or marked N/A with justification.

## Review Process (Required)

1. Re-read the full spec from scratch with adversarial intent.
2. Run this checklist section-by-section.
3. Stress-test each mitigation in Risks & Impact Review.
4. Cross-check related module specs for conflicting assumptions.
5. Record the review result using the output format below.

## Review Output Format

Append to changelog:

```markdown
### Review — {YYYY-MM-DD}
- **Reviewer**: Agent / Human
- **Security**: Passed / {list of issues}
- **Performance**: Passed / {list of issues}
- **Cache**: Passed / {list of issues}
- **Commands**: Passed / {list of issues}
- **Risks**: Passed / {list of gaps}
- **Verdict**: Approved / Needs revision
```

## 1. Design Logic & Phasing
- [ ] TLDR defines scope, value, and clear boundaries.
- [ ] MVP is explicit; future work is deferred and labeled.
- [ ] User stories/use cases map to API/data/UI sections.
- [ ] Terminology aligns with existing modules and AGENTS naming.
- [ ] Phase plan is testable and incrementally deliverable.

## 2. Architecture & Module Isolation
- [ ] Cross-module links use FK IDs only (no direct ORM relations).
- [ ] Tenant isolation and `organization_id` scoping are explicit.
- [ ] Module/package placement is correct for monorepo conventions.
- [ ] DI usage is specified for service wiring (Awilix).
- [ ] Event/subscriber/worker boundaries are clear and non-circular.

## 3. Data Integrity & Security
- [ ] Entities/records include required tenancy/lifecycle columns where applicable.
- [ ] Write operations define atomicity/transaction boundaries.
- [ ] Input validation is defined using zod schemas.
- [ ] PII/sensitive fields and decryption behavior are documented.
- [ ] Security criteria covered:
- [ ] All user input is validated with zod before business logic/persistence.
- [ ] SQL/NoSQL injection vectors are mitigated with parameterized queries (no string interpolation).
- [ ] XSS protections are documented for user-rendered content (no unsafe raw HTML rendering).
- [ ] Proper encoding is defined for URLs, HTML entities, JSON payloads, and file paths.
- [ ] Secrets/credentials are excluded from logs, error messages, and API responses.
- [ ] Authentication/authorization guards are declared (`requireAuth`, `requireRoles`, `requireFeatures`).
- [ ] Tenant isolation rule is explicit: every scoped query filters by `organization_id`.

## 4. Commands, Events & Naming
- [ ] Naming is singular and consistent for entities/commands/events.
- [ ] All mutations are represented as commands.
- [ ] Undo/rollback behavior is specified for each mutation.
- [ ] Multi-step flows use compound commands or equivalent orchestration.
- [ ] Side-effect reversibility (events/notifications/external calls) is documented.
- [ ] Commands with side effects document which effects are reversible and which are not.
- [ ] Bulk operations use compound commands with per-item granularity where partial undo is required.

## 5. API, UI & Compatibility
- [ ] API contracts are complete (request/response/errors) and consistent with models.
- [ ] Routes include `openApi` expectations.
- [ ] UI uses shared primitives/patterns (`CrudForm`, `DataTable`, etc.) when applicable.
- [ ] i18n keys are planned for all user-facing strings.
- [ ] Pagination limits are defined (`pageSize <= 100`) where applicable.
- [ ] Migration/backward compatibility strategy is explicit.

## 6. Performance, Cache & Scale
- [ ] Query/index strategy is defined for expected access patterns.
- [ ] N+1 risks and large-list behavior are addressed.
- [ ] Bulk operations define batching/chunking strategy.
- [ ] Background worker threshold for heavy operations is considered.
- [ ] Every query pattern identifies supporting index(es).
- [ ] Schemas avoid unbounded arrays, nested JSON blobs, and count-growing denormalized fields.
- [ ] Large list/search APIs use cursor/keyset pagination (not OFFSET) for scale.
- [ ] N+1 mitigation states expected query count for critical operations.
- [ ] Operations touching >1000 rows justify foreground execution or defer to worker.
- [ ] Query schemas define expected cardinality/access pattern (point lookup, range scan, full scan).
- [ ] Cache criteria covered:
- [ ] Read-heavy endpoints declare caching strategy (memory/SQLite/Redis) and TTL.
- [ ] Cache keys/tags are tenant-scoped.
- [ ] Every write path lists cache tag invalidations.
- [ ] Cache miss behavior is explicit (fallback query, cold-start behavior).
- [ ] Nested/composed data declares invalidation chains (child changes invalidate parent caches).
- [ ] Cache design prevents stale cross-tenant data leakage.

## 7. Risks, Impact & Anti-Patterns
- [ ] Risks & Impact Review includes concrete scenarios and severities.
- [ ] Each risk has mitigation and residual risk.
- [ ] Blast radius and operational detection are described.
- [ ] Anti-pattern checks:
- [ ] Does not restate obvious platform boilerplate as feature scope.
- [ ] Does not mix MVP build plan with speculative future phases.
- [ ] Does not skip undoability for state changes.
- [ ] Does not introduce cross-module ORM links.
- [ ] Does not use plural command/event naming.
