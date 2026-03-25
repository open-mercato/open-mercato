---
title: Search organization scoping
date: 2026-02-24
status: implemented
owners: search
---

## TLDR

Scope the vector index listing and global/hybrid search APIs to the current organization selection derived from `resolveOrganizationScopeForRequest`. When no organizations are allowed, return empty results instead of querying. UI surfaces a small hint that results are scoped.

## Overview

The `search` module exposes:

- Vector index listing (`/api/search/index`) for inspecting indexed entries.
- Search endpoints used by the backend search page and global search dialog.

These endpoints must respect the current organization selection (cookie/request-derived organization scope) to prevent confusing results and to align with the rest of the app’s organization scoping model.

## Problem Statement

The vector search index page and global search popup were not respecting the current organization scope and could behave as tenant-wide search, ignoring the user’s active organization context.

## Proposed Solution

- Resolve organization scope for the request using `resolveOrganizationScopeForRequest({ container, auth, request })`.
- Apply the resolved scope:
  - If `scope.filterIds` is an empty array, short-circuit with an empty response payload.
  - If `scope.selectedId` is a non-empty string, pass it as `organizationId` into search/vector operations.
  - If `scope.selectedId` is `null`, treat the request as unscoped (tenant-wide) for strategies/drivers that only accept a single `organizationId`.
- Update the pgvector driver to apply strict `organization_id = $org` filtering when `organizationId` is provided (no implicit “include `organization_id IS NULL`” fallback).
- Add a small UI hint (“Scoped to current organization”) in the backend search page and global search dialog.

## Architecture

**Organization scope resolution**

- Source of truth: `@open-mercato/core/modules/directory/utils/organizationScope`
- Entry point used by search routes: `resolveOrganizationScopeForRequest`

**Enforcement points**

- API routes:
  - `/api/search/index`
  - `/api/search/search`
  - `/api/search/search/global`
- Vector driver:
  - `packages/search/src/vector/drivers/pgvector/index.ts`

## Data Models

No schema changes. This change relies on existing `organization_id` fields already present in vector/index storage.

## API Contracts

### `/api/search/index` (GET)

- Inputs: `limit`, `offset`, optional `entity_id`
- Behavior:
  - If `scope.filterIds` is an empty array: return `{ entries: [], limit, offset }`
  - Else if `scope.selectedId` is a string: list entries scoped to that `organizationId`

### `/api/search/search` (GET)

- Inputs: `q`, `limit`, optional strategy/entity filters
- Behavior:
  - If `scope.filterIds` is an empty array: return `{ results: [], strategiesUsed: [], timing: 0, query, limit }`
  - Else pass `organizationId = scope.selectedId ?? undefined` into search

### `/api/search/search/global` (GET)

- Inputs: `q`, `limit`, optional strategy/entity filters
- Behavior:
  - If `scope.filterIds` is an empty array: return `{ results: [], strategiesUsed: [], strategiesEnabled: strategies, timing: 0, query, limit }`
  - Else pass `organizationId = scope.selectedId ?? undefined` into search

## Testing

**Unit**

- Jest route tests validate that routes pass the resolved organization scope into the underlying services/strategies.

**Integration (recommended)**

- Backend: verify search dialog results change with organization selection cookie.
- Backend: verify `/backend/search` table results change with organization selection cookie.
- Backend: verify `/backend/search/index` only lists entries for the selected organization.

## Risks & Impact Review

- **Risk: Cross-organization results for unscoped requests**
  - Severity: medium
  - Area: search endpoints when `scope.selectedId` is `null`
  - Mitigation: `resolveOrganizationScopeForRequest` typically resolves a concrete `selectedId` for non-superadmin contexts; short-circuit on empty `filterIds`.
  - Residual risk: if callers intentionally use an unscoped selection, results are tenant-wide by design until multi-org filtering is supported by the strategy/driver contract.

- **Risk: Behavior change for records with `organization_id IS NULL`**
  - Severity: low to medium (depends on usage of “global”/org-less records)
  - Area: pgvector filtering
  - Mitigation: treat org-less records as unscoped and only returned when no org filter is applied.

## Final Compliance Report

- Organization scope resolved server-side from request + auth context.
- No cross-tenant access added; tenant isolation remains required via `tenantId`.
- No new migrations or data model changes.
- Automated coverage added at the route level; integration coverage listed as recommended follow-up.

## Changelog

- 2026-02-24: Scope vector index listing and search routes to the resolved organization selection; tighten pgvector org filtering; add UI scope hint and route tests.

