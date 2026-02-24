# Integration Feasibility Analysis — BambooHR

## Overview
- BambooHR is a SaaS HR management system
- REST API for HR data access
- Hub: `data_sync` (DataSyncAdapter)
- Bundle ID: `sync_bamboohr`
- Overall Feasibility: **Partial** — narrow scope (user provisioning only), limited API

## API Analysis
- REST API: `/api/gateway.php/{companyDomain}/v1/employees/directory`, `/employees/{id}`
- Auth: HTTP Basic (API key as username, `x` as password). No OAuth 2.0
- Pagination: **None** — employee directory returns ALL employees in one response
- Delta: `GET /employees/changed?since={datetime}` — returns changed IDs only, then individual fetch per ID
- Rate limits: ~50-100 API calls/minute (not publicly documented)
- Meta: `/meta/fields` (custom fields), `/meta/tables` (table definitions)

## Integration Scope — Primarily User Provisioning
BambooHR data is HR-specific with no direct e-commerce mapping. Viable scope:

### Primary Use Case: Employee → User Provisioning
| BambooHR Field | Open Mercato Entity | Notes |
|---------------|--------------------|----|
| firstName + lastName | User.firstName + lastName | Direct |
| workEmail | User.email | Primary identifier |
| department | Role assignment | Config-driven mapping |
| status (Active/Inactive) | User.isActive | Termination → deactivate |
| photoUrl | User.avatarUrl | If supported |

### What NOT to Sync
- Payroll/compensation — sensitive, no commerce use case
- Benefits — restricted, no relevance
- Performance reviews — no relevance
- Time-off — no consuming module exists

## Webhook Support
- Available on Essentials and Advantage plans
- Field-change events for watched fields only
- HMAC-SHA256 via `Bamboo-Signature` header
- Limited scope: watched field changes only

## Bundle Structure
```
sync_bamboohr/
├── integration.ts                      # Bundle + 3 integrations
├── lib/
│   ├── auth.ts                         # API key Basic auth
│   ├── rate-limiter.ts                 # ~50-100 req/min
│   ├── schema-introspector.ts          # meta/fields + meta/tables
│   ├── adapters/
│   │   ├── employees.ts                # DataSyncAdapter: Employee → User
│   │   ├── departments.ts              # DataSyncAdapter: departments
│   │   └── webhooks.ts                 # WebhookEndpointAdapter
│   └── shared.ts
├── widgets/injection/
│   └── department-role-mapping/
├── setup.ts
└── i18n/
```

## Feasibility Ratings
| Capability | Rating (1-5) | Notes |
|-----------|-------------|-------|
| Employee import (provisioning) | 3 / Moderate | Delta + individual fetches. Rate limit throttling |
| Org structure sync | 3 / Moderate | Department + manager accessible |
| Time-off sync | 2 / Difficult | No consuming module |
| Bidirectional sync | 1 / Infeasible | BambooHR is system of record |
| Real-time sync | 2 / Difficult | Webhooks limited; Essentials+ only |

## Key Challenges
1. **No bulk employee fetch**: Each changed employee = individual API call. Rate limit bottleneck
2. **No pagination**: Directory returns all at once
3. **Basic auth only**: No OAuth 2.0. API key inherits creator's permissions
4. **Account deactivation safety**: CRITICAL — only deactivate users created by sync (tracked in SyncExternalIdMapping). Never touch externally-created accounts
5. **Data privacy (GDPR/CCPA)**: Employee PII. Do not log names/emails in IntegrationLog
6. **Narrow scope**: Most HR data has no landing zone in commerce platform

## Gaps Summary
- No OAuth 2.0 (Basic auth only)
- No pagination
- Narrow viable scope limits ROI
- Deactivation safety logic critical
- Estimated effort: **2-3 weeks** (narrow scope)
