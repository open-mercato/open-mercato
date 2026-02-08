# Specs Folder — Agent Guidelines

Check `.ai/specs/` before modifying any module. Create specs for new features, update specs when implementing changes.

## When to Create a Spec

- Before implementing a new module or significant feature
- When making architectural decisions that affect multiple files
- When adding new API contracts or data models
- Skip for small bug fixes, typo corrections, or single-file changes

## File Naming

Follow the pattern `SPEC-{number}-{date}-{title}.md`:

- **Number**: Sequential identifier (e.g., `001`, `002`)
- **Date**: Creation date in ISO format (`YYYY-MM-DD`)
- **Title**: Descriptive kebab-case (e.g., `sidebar-reorganization`)

Examples:
- `SPEC-003-2026-01-23-notifications-module.md`
- `SPEC-002-2026-01-23-messages-module.md`

Meta-documentation files (`AGENTS.md`, `CLAUDE.md`) use UPPERCASE names and are not numbered.

## Spec File Structure — MUST Include

Every spec MUST contain these sections:

1. **Overview** — what the module/feature does and why
2. **Architecture** — high-level design and component relationships
3. **Data Models** — entity definitions, relationships, database schema
4. **API Contracts** — endpoints, request/response schemas, examples
5. **UI/UX** — frontend components and interactions (if applicable)
6. **Configuration** — environment variables, feature flags, settings
7. **Risks & Impact Review** — what can go wrong, failure modes, and mitigation (see below)
8. **Changelog** — version history with dates and summaries

### Changelog Format — MUST Maintain

```markdown
## Changelog

### 2026-01-23
- Added email notification channel support
- Updated notification preferences API

### 2026-01-15
- Initial specification
```

## Workflow

### Before Coding

1. Check if a spec exists for the module you're modifying
2. Read the spec to understand design intent and constraints
3. Identify gaps or outdated sections

### When Adding Features

1. Update the corresponding spec with new functionality, API changes, and data model updates
2. Add a changelog entry with date and summary

### When Creating New Modules

1. Create `SPEC-{next-number}-{YYYY-MM-DD}-{module-name}.md`
2. Document the initial design before or alongside implementation
3. Include a changelog entry for the initial specification
4. Update [README.md](README.md) with a link to the new spec

### After Coding

Even when not explicitly asked:
- Update the spec when implementing significant changes
- Keep specs synchronized with actual implementation
- Document architectural decisions made during development
- **MUST create an integration test** for the implemented feature — follow `.ai/qa/AGENTS.md` to create an executable Playwright test (`.ai/qa/tests/<category>/TC-*.spec.ts`). Optionally create a markdown scenario (`.ai/qa/scenarios/TC-*.md`) for documentation.

## Risks & Impact Review — MUST Include in Every Spec

Every spec MUST contain a dedicated "Risks & Impact Review" section that explicitly answers the questions below. Do not hand-wave — each risk must state the concrete failure scenario, its severity (critical/high/medium/low), and the mitigation.

### What Can Go Wrong

For every feature in the spec, enumerate failure modes across these categories:

#### Data Integrity Failures

- What happens if the operation is interrupted mid-way (crash, timeout, network failure)? Is data left in an inconsistent state?
- Are there race conditions when multiple users modify the same entity concurrently? How are conflicts resolved?
- Can partial writes occur (e.g., parent created but child entities fail)? Are transactions used to ensure atomicity?
- What happens if referenced entities are deleted while this operation is in-flight (dangling foreign keys)?

#### Cascading Failures & Side Effects

- Which other modules depend on this data? If this entity is corrupted or delayed, what breaks downstream?
- Does this feature emit events? What happens if a subscriber fails — does it block the main operation or silently drop?
- Are there circular dependencies between modules that could cause infinite loops or deadlocks?
- If an external service (email, payment, webhook) is unavailable, does the operation fail or degrade gracefully?

#### Tenant & Data Isolation Risks

- Can a bug in this feature leak data between tenants? Describe the specific isolation boundary.
- Are there any shared/global resources (caches, queues, counters) that could cause cross-tenant interference?
- What happens if a tenant has significantly more data than others — does it degrade the system for everyone?

#### Migration & Deployment Risks

- Can this change be deployed without downtime? Is the migration backward-compatible?
- If the migration fails halfway, can it be safely re-run or rolled back?
- Does this change require data backfill? How long will it take on millions of rows, and can the system serve traffic during backfill?
- Are there breaking changes to API contracts? How are existing clients affected?

#### Operational Risks

- What are the monitoring/alerting gaps? How would an on-call engineer detect a problem with this feature?
- What is the blast radius if this feature fails completely — is it isolated to one module or does it take down the entire tenant?
- Are there rate-limiting or throttling concerns (e.g., bulk import triggering thousands of events/notifications)?
- What are the storage growth implications at scale (millions of records, audit logs, version history)?

### Risk Documentation Format

Each risk entry in the spec MUST follow this structure:

```markdown
#### [Risk Title]
- **Scenario**: What exactly goes wrong and under what conditions
- **Severity**: Critical / High / Medium / Low
- **Affected area**: Which modules, APIs, or user-facing features are impacted
- **Mitigation**: How the spec addresses this (transaction boundaries, retry logic, circuit breaker, fallback)
- **Residual risk**: What remains unmitigated and why it is acceptable
```

## Spec Review Step — MUST Perform Before Approval

After writing or updating a spec, perform a dedicated review pass. This is a separate step — do not combine it with writing. Re-read the entire spec with adversarial intent: look for what's missing, what's hand-waved, and what will break at scale.

### Review Process

1. **Re-read the full spec** from scratch as if you are a hostile reviewer trying to find flaws
2. **Run the Spec Review Checklist** (Security, Performance, Cache, Commands) below — every item must have an explicit answer in the spec, or a documented justification for why it does not apply
3. **Stress-test the Risks section** — for each risk, ask: "Is this mitigation actually sufficient? What if the mitigation itself fails?"
4. **Check cross-module implications** — read the specs of modules this feature touches; verify no conflicting assumptions
5. **Summarize review findings** as a comment block at the end of the spec, listing:
   - Items that passed review
   - Items that need revision (with specific questions)
   - Accepted residual risks with justification

### Review Output Format

Append to the spec changelog:

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

## Spec Review Checklist — MUST Challenge

Before approving any spec, critically review it against each of these areas. Flag gaps, push back on missing details, and require explicit answers.

### Security

- All user input MUST be validated with zod schemas — no unvalidated data reaches business logic or persistence
- SQL/NoSQL injection vectors: verify parameterized queries, no string interpolation in query construction
- XSS: any user-provided content rendered in UI MUST be escaped/sanitized; check for `dangerouslySetInnerHTML` or raw HTML injection
- Encoding: verify proper encoding for URLs, HTML entities, JSON payloads, and file paths — no raw concatenation
- Secrets/credentials MUST NOT appear in logs, error messages, or API responses
- Authentication/authorization: every endpoint MUST declare guards (`requireAuth`, `requireRoles`, `requireFeatures`)
- Tenant isolation: every query MUST filter by `organization_id` — challenge any spec that omits this

### Performance (millions of records per entity)

- Every query MUST specify which database indexes it relies on — if the spec introduces a new query pattern, it MUST declare the supporting index
- Data schemas MUST avoid unbounded arrays, nested JSON blobs, or denormalized fields that grow with record count
- List/search endpoints MUST use cursor-based or keyset pagination (not OFFSET-based) for large datasets
- N+1 query patterns MUST be identified and resolved — spec MUST show query count for key operations
- Bulk operations MUST use batch processing with configurable chunk sizes, not unbounded loops
- Query schemas MUST declare expected cardinality and access patterns (point lookup, range scan, full scan)
- Any operation touching >1000 rows MUST justify why it cannot be deferred to a background worker

### Cache Usage and Invalidation

- Read-heavy API endpoints MUST declare a caching strategy (memory, SQLite, or Redis) with TTL
- Cache keys MUST be tenant-scoped (`organization_id` in key or tag)
- Tag-based invalidation MUST be specified — every write operation MUST list which cache tags it invalidates
- Spec MUST explicitly state what happens on cache miss (fallback query, cold-start behavior)
- Nested/composed data (e.g., resolved prices, aggregated stats) MUST declare invalidation chains — changing a child entity MUST invalidate parent caches
- Cache MUST NOT serve stale cross-tenant data — challenge any shared/global cache without tenant scoping

### Commands and Undo/Redo

- All write operations (create, update, delete) MUST be implemented as commands via `registerCommand`
- Multi-step operations MUST use compound commands that group atomic steps
- Every command MUST be undoable — spec MUST describe the undo behavior (what state is restored, what side effects are reversed)
- Commands that trigger side effects (events, notifications, external API calls) MUST document which side effects are reversible and which are not
- Bulk operations MUST be expressed as compound commands with per-item granularity for partial undo

## Final Compliance Review — MUST Perform as Last Step

After the spec review checklist passes, perform a final compliance review. This is the last gate before a spec is approved. The goal is to verify that the spec is fully aligned with all architectural principles defined across the project's AGENTS.md files.

### Process

1. **Identify all related AGENTS.md files** — use the Task Router in the root `AGENTS.md` to find every guide relevant to the modules, packages, and patterns the spec touches
2. **Read each related AGENTS.md** — do not skip any; use subagents to read them in parallel if needed
3. **Cross-reference every MUST rule** — for each rule in each related AGENTS.md, check whether the spec complies; mark as compliant, non-compliant, or not applicable
4. **Re-read the spec itself** — verify internal consistency: do the data models match the API contracts? Do the API contracts match the UI/UX section? Does the risk section cover all the operations described?
5. **Produce the Final Compliance Report** — append it to the spec as the last section before the changelog

### Final Compliance Report Format

```markdown
## Final Compliance Report — {YYYY-MM-DD}

### AGENTS.md Files Reviewed
- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/<relevant>/AGENTS.md`
- ...

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Uses FK IDs only |
| root AGENTS.md | Filter by organization_id | Compliant | All queries scoped |
| packages/core/AGENTS.md | API routes MUST export openApi | Non-compliant | Missing on GET /api/... |
| packages/cache/AGENTS.md | Tag-based invalidation | Compliant | Tags declared in §Cache |
| ... | ... | ... | ... |

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
- **Rule**: The exact rule text
- **Source**: Which AGENTS.md file
- **Gap**: What the spec is missing or doing wrong
- **Recommendation**: Specific change needed to achieve compliance

### Verdict

- **Fully compliant**: Approved — ready for implementation
- **Non-compliant**: Blocked — list of items that MUST be resolved before implementation begins
```

### Key Rules for the Final Review

- Do NOT rubber-stamp — if you cannot verify compliance, mark as "Unable to verify" with explanation
- Every non-compliant item MUST have a concrete recommendation, not just "fix this"
- The spec author MUST resolve all non-compliant items before the spec moves to implementation
- If the spec touches a module without an AGENTS.md guide, flag this as a gap and recommend creating one

## MUST Rules

1. **MUST check for existing specs** before making changes to any module
2. **MUST update specs** when implementing features — even if not explicitly requested
3. **MUST create specs** for new modules or significant features
4. **MUST maintain changelogs** with clear, dated entries
5. **MUST NOT leave specs out of sync** with the codebase after implementation
6. **MUST review every spec** against the Security, Performance, Cache, and Commands checklist above before approving
7. **MUST include a Risks & Impact Review section** in every spec — no spec is complete without documented failure modes and mitigations
8. **MUST perform a separate review pass** after writing — re-read adversarially, append review findings to changelog
9. **MUST perform a Final Compliance Review** as the last step — cross-reference all related AGENTS.md files, produce a compliance matrix, and block implementation until all non-compliant items are resolved
10. **MUST create an integration test** after implementing a spec — follow `.ai/qa/AGENTS.md` to produce both a markdown test case and an executable Playwright `.spec.ts` file
