# SPEC-{number} — {Title}

**Date**: {YYYY-MM-DD}
**Status**: Draft

## TLDR

**Key Points:**
- [What is being built — 1-2 sentences]
- [Primary goal / value proposition]

**Scope:**
- [Feature 1]
- [Feature 2]

## Open Questions *(remove before finalizing)*

- **Q1**: [Critical unknown — e.g. "Should this store data per-tenant or globally?"]
- **Q2**: [Critical unknown — e.g. "Does this replace X or coexist with it?"]

---

## Overview

[What this feature does and why. Target audience and key benefits.]

> **Market Reference**: [Name the open-source leader you studied. What did you adopt vs. reject?]

## Problem Statement

[Specific pain points or gaps this solves.]

## Proposed Solution

[High-level technical approach.]

### Design Decisions (Optional)

| Decision | Rationale |
|----------|-----------|
| [Choice] | [Why this over alternatives] |

## User Stories

- **[User]** wants to **[Action]** so that **[Benefit]**

## Data Models

### [Entity Name] (Singular)

- `id`: string (UUID)
- `organization_id`: string (FK)
- `created_at`: Date
- `updated_at`: Date
- ...

## API Contracts

### [Endpoint Name]

- `METHOD /api/path`
- Request: `{...}`
- Response: `{...}`

## Implementation Plan

### Phase 1: [Name]

1. [Step — testable]
2. [Step — testable]

### Phase 2: [Name]

1. [Step]

## Risks

| Risk | Severity | Mitigation | Residual |
|------|----------|------------|----------|
| [What goes wrong] | High/Med/Low | [How addressed] | [What remains] |

## Changelog

| Date | Change |
|------|--------|
| {date} | Initial spec |
