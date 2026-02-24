# Integration Feasibility Analysis — OroCRM

## Overview
- OroCRM is a PHP/Symfony-based CRM (part of OroCommerce ecosystem)
- REST API with JSON:API-compliant responses
- Hub: `data_sync` (DataSyncAdapter)
- Bundle ID: `sync_orocrm`
- Overall Feasibility: **Good** — natural entity mapping, some auth/pagination challenges

## API Analysis
- REST API: `/api/contacts`, `/api/accounts`, `/api/opportunities`, `/api/tasks`, `/api/calls`
- Auth: OAuth 2.0 (recent) or WSSE (legacy). WSSE needs custom per-request digest (SHA1 of nonce + timestamp + password hash)
- Pagination: Page-number based (`page[number]` + `page[size]`). No cursor pagination
- Delta: `updatedAt` filter. `GET /api/contacts?filter[updatedAt][gt]=2024-01-01T00:00:00Z`
- Rate limits: Not documented; enterprise deployments typically unlimited
- JSON:API format: Relationships as separate `included` resources

## Data Model Mapping
| OroCRM Entity | Open Mercato Entity | Mapping Quality |
|--------------|--------------------|----|
| Contact | Person | Excellent — direct field mapping |
| Account | Company | Excellent — name, industry, website |
| Opportunity | Deal | Good — stage mapping needed |
| Task | Activity (type: task) | Good |
| Call | Activity (type: call) | Good |
| Email | Activity (type: email) | Good |
| Case | Not mapped | Would need custom entity |

## Webhook Support
- **OroCRM/OroCommerce CE: No webhook support**
- **OroCommerce EE 5.1+: Webhook support** via Admin Configuration
- CE fallback: polling via scheduled sync runs

## Feasibility Ratings
| Capability | Rating (1-5) | Notes |
|-----------|-------------|-------|
| Contact/Person sync | 5 / Excellent | Near-identical entity model |
| Account/Company sync | 5 / Excellent | Direct mapping |
| Opportunity/Deal sync | 4 / Good | Stage mapping config needed |
| Activity sync | 4 / Good | Multiple types map to Activity |
| Bidirectional sync | 4 / Good | Full CRUD API available |
| Real-time sync (EE) | 3 / Moderate | EE 5.1+ only |
| Real-time sync (CE) | 1 / Infeasible | No webhooks |

## Key Challenges
1. **WSSE legacy authentication**: Custom digest computation per request for older installations
2. **Page-number pagination**: Fragile for delta sync at page boundaries
3. **JSON:API format**: Relationships require parsing `included` array
4. **Opportunity stage mapping**: Installation-specific stages need one-time config
5. **Webhook EE-only**: Same limitation as Akeneo CE

## Gaps Summary
- WSSE auth adapter needed for legacy installations
- Page-number pagination requires reconciliation
- Webhook support EE-only
- Estimated effort: **4-5 weeks**
