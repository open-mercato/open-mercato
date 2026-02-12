# SPEC-XXX: [Title]

## TLDR
**Key Points:**
- [What is being built — 1-2 sentences]
- [Primary goal / value proposition]

**Scope:**
- [Feature 1]
- [Feature 2]

**Concerns (if any):**
- [Significant risks or constraints — omit if none]

## Required Sections (MUST Include)

Every non-trivial spec must include these sections:

1. TLDR
2. Overview
3. Problem Statement
4. Proposed Solution
5. Phasing
6. Architecture
7. Data Models
8. API Contracts
9. Risks & Impact Review
10. Final Compliance Report
11. Changelog

## Overview
[What this module/feature does and why it is being implemented. Mention target audience and key benefits.]

> **Market Reference**: [Name the open-source market leader you studied. What did you adopt? What did you reject and why?]

## Problem Statement
[Describe the specific pain points, existing limitations, or gaps that this specification aims to solve.]

## Proposed Solution
[Describe the high-level technical approach and how it addresses the problem statement.]

### Design Decisions (Optional)
| Decision | Rationale |
|----------|-----------|
| [Choice] | [Why this over alternatives] |

### Alternatives Considered (Optional)
| Alternative | Why Rejected |
|-------------|-------------|
| [Option A] | [Reason] |

## User Stories / Use Cases
- **[User]** wants to **[Action]** so that **[Benefit]**
- **[User]** wants to **[Action]** so that **[Benefit]**

## Phasing

### Phase 1: [Name]
1. [Step — describe what is built and how to test it]
2. [Step — describe what is built and how to test it]

### Phase 2: [Name] (Optional)
1. [Step]

## Architecture
[Diagrams, component interactions, data flow]

### Commands & Events (if applicable)
- **Command**: `module.entity.action`
- **Event**: `module.entity.event`

## Data Models
### [Entity Name] (Singular)
- `id`: string (UUID)
- `organization_id`: string (FK)
- ...

## API Contracts
### [Endpoint Name]
- `METHOD /api/path`
- Request: `{...}`
- Response: `{...}`

## Internationalization (i18n)
- [Key keys needed]

## UI/UX
- [Mockups or descriptions]

## Configuration (Optional)
- [Env vars, settings]

## Migration & Compatibility
- [Database migrations, breaking changes]

## Implementation Plan

### Phase 1: [Name]
1. [Step]
2. [Step]

### Phase 2: [Name]
1. [Step]

### File Manifest (Optional)
| File | Action | Purpose |
|------|--------|---------|
| `path/to/file.ts` | Create / Modify | [What changes] |

### Testing Strategy (Optional)
- [Unit tests for ...]
- [Integration tests for ...]

### Open Questions (Optional)
- [Unresolved question 1]

## Risks & Impact Review
Document concrete risks across the categories below. For each feature, answer "what can go wrong," then record mitigations and residual risk.

### Data Integrity Failures
- What happens if the operation is interrupted mid-way (crash, timeout, network failure)? Is data left in an inconsistent state?
- Are there race conditions when multiple users modify the same entity concurrently? How are conflicts resolved?
- Can partial writes occur (e.g., parent created but child entities fail)? Are transactions used to ensure atomicity?
- What happens if referenced entities are deleted while this operation is in-flight (dangling foreign keys)?

### Cascading Failures & Side Effects
- Which other modules depend on this data? If this entity is corrupted or delayed, what breaks downstream?
- Does this feature emit events? What happens if a subscriber fails: block main operation, retry, or drop?
- Are there circular dependencies between modules that could cause loops or deadlocks?
- If an external service (email, payment, webhook) is unavailable, does the operation fail or degrade gracefully?

### Tenant & Data Isolation Risks
- Can a bug in this feature leak data between tenants? Describe the exact isolation boundary.
- Are there shared/global resources (caches, queues, counters) that could cause cross-tenant interference?
- What happens if a single tenant has far more data than others? Is noisy-neighbor impact bounded?

### Migration & Deployment Risks
- Can this change be deployed without downtime? Is migration backward-compatible?
- If migration fails halfway, can it be safely re-run or rolled back?
- Does this require data backfill? How long on millions of rows, and can traffic continue during backfill?
- Are there breaking API contract changes? How are existing clients protected?

### Operational Risks
- What monitoring/alerting gaps remain? How does on-call detect failure quickly?
- What is the blast radius if this feature fails entirely: isolated module or tenant-wide/system-wide effect?
- Are there rate-limiting/throttling concerns (bulk operations, event storms, notification floods)?
- What are storage growth implications at scale (audit logs, version history, generated artifacts)?

### Risk Register (Required Format)

Use this format for every explicit risk:

```markdown
#### [Risk Title]
- **Scenario**: What exactly goes wrong and under what conditions
- **Severity**: Critical / High / Medium / Low
- **Affected area**: Which modules, APIs, or user-facing features are impacted
- **Mitigation**: How the design addresses this (transaction boundaries, retry logic, circuit breaker, fallback)
- **Residual risk**: What remains unmitigated and why it is acceptable
```

## Final Compliance Report
Use this exact structure:

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
| packages/cache/AGENTS.md | Tag-based invalidation | Compliant | Tags declared in cache section |
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
- **Rule**: Exact rule text
- **Source**: Which AGENTS.md file
- **Gap**: What is missing or wrong
- **Recommendation**: Specific fix needed

### Verdict

- **Fully compliant**: Approved — ready for implementation
- **Non-compliant**: Blocked — items must be resolved before implementation
```

## Changelog
### [YYYY-MM-DD]
- Initial specification
