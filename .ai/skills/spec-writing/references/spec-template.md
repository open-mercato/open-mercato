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
### Data Integrity
- [How is data consistency ensured?]

### Isolation
- [Any cross-module dependencies?]

### Security & PII (if applicable)
- [PII handling, auth scopes]

## Final Compliance Report
- [ ] Singular naming used?
- [ ] Undo logic defined?
- [ ] Tenant isolation preserved?

## Changelog
### [YYYY-MM-DD]
- Initial specification
