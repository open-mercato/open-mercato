# SPEC-ENT-002: Enterprise Record Lock Extensibility (Moved)

- Date: 2026-02-20
- Status: Moved to OSS scope on 2026-02-22

## TLDR
This document is no longer the canonical spec. The mutation guard mechanism is framework-level and now documented in OSS:

- `.ai/specs/SPEC-035-2026-02-22-mutation-guard-mechanism.md`

## Overview
The original document described mutation guard extensibility with record-lock examples. The implemented contract is generic and shared (`@open-mercato/shared`), so it belongs to OSS scope rather than Enterprise-only scope.

## Problem Statement
Keeping a generic platform mechanism in Enterprise specs incorrectly suggests the behavior is proprietary and record-lock-specific.

## Proposed Solution
Move canonical documentation to OSS and keep this file as a historical pointer.

## Architecture
Canonical architecture is described in:
- `.ai/specs/SPEC-035-2026-02-22-mutation-guard-mechanism.md`

Enterprise-specific adapter behavior remains documented in:
- `.ai/specs/enterprise/SPEC-ENT-003-2026-01-23-record-locking-module.md`

## Data Models
No enterprise-only data model is defined by this moved spec.

## API Contracts
No enterprise-only API contract is defined by this moved spec.

## Risks & Impact Review

#### Documentation Scope Drift
- Scenario: Readers treat mutation guard as enterprise-only and skip OSS integration.
- Severity: Medium
- Affected area: Architecture understanding and future implementation planning
- Mitigation: Canonical OSS spec created; enterprise file retained only as pointer
- Residual risk: Low

## Final Compliance Report - 2026-02-22

### AGENTS.md Files Reviewed
- `AGENTS.md`
- `.ai/specs/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
| --- | --- | --- | --- |
| `.ai/specs/AGENTS.md` | Maintain implementation-accurate scope boundaries | Compliant | Generic mechanism moved to OSS |
| `AGENTS.md` | Keep documentation aligned with architecture reality | Compliant | Enterprise file now pointer-only |

### Internal Consistency Check

| Check | Status | Notes |
| --- | --- | --- |
| Scope matches implementation ownership | Pass | Canonical spec now in OSS |
| Enterprise/OSS separation is explicit | Pass | Direct links provided |

### Non-Compliant Items
- None.

### Verdict
Fully compliant.

## Changelog
### 2026-02-22
- Re-scoped mutation guard extensibility documentation to OSS spec `SPEC-035`.
- Kept this enterprise spec as a historical pointer.
