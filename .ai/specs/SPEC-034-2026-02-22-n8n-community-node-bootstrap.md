# SPEC-034 — n8n Community Node Bootstrap

**Date:** 2026-02-22
**Status:** In Progress
**Scope:** OSS

## TLDR
Create an initial `n8n-nodes-open-mercato` package in the monorepo with runnable scaffolding, API key credentials, a declarative REST node, and an OpenAPI download script so issue #576 has a working foundation.

## Overview
Open Mercato currently has no n8n community node package in-tree. This spec defines the bootstrap implementation required to ship an installable baseline package and unblock follow-up enhancements.

## Problem Statement
Without a package scaffold and n8n-compatible node definitions, users cannot integrate Open Mercato APIs in n8n through a maintained first-party community node.

## Proposed Solution
1. Add a new workspace package at `packages/n8n-community-node`.
2. Implement `OpenMercatoApi` credentials (base URL + API key bearer auth).
3. Implement a declarative REST node (`OpenMercato`) supporting method, path, query JSON, and body JSON.
4. Add `openapi:generate` script to pull `/api/docs/openapi` into package resources.
5. Validate build/lint/test scripts for the package.

## Architecture
- New package is standalone and does not couple to core runtime code.
- Runtime dependency contract is n8n credential + node metadata loaded by n8n.
- OpenAPI generation is a utility script for local packaging workflows.

## Data Models
No database entities or persistence changes.

## API Contracts
### Open Mercato API Consumption
- Script reads `GET /api/docs/openapi`.
- Node can call any Open Mercato API path configured by user input.

### n8n Surface
- Credential type: `openMercatoApi`
- Node type: `openMercato`

## Integration Coverage
- API path: `/api/docs/openapi` is covered by `openapi:generate` script.
- UI path: n8n credentials editor flow for `Open Mercato API` and n8n node config panel for `Open Mercato` (manual validation scope; no UI automation yet).

## Risks & Impact Review
- Incorrect n8n typing/runtime compatibility can break node loading in n8n.
- OpenAPI fetch can fail if target base URL is unavailable.
- Initial declarative node does not yet provide resource-specific UX; raw path usage is flexible but less guided.

## Final Compliance Report
- Follows workspace package conventions and naming.
- Includes compile-ready TypeScript package and scripts.
- Defers advanced operation/resource UX to follow-up iterations.

## Changelog
- 2026-02-22: Created spec and initial implementation scope for issue #576 bootstrap.
