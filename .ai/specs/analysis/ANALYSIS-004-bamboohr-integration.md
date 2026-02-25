# ANALYSIS-004 — BambooHR Integration Feasibility

| Field | Value |
|-------|-------|
| **Status** | Complete |
| **Author** | Claude (Opus 4.6) |
| **Created** | 2026-02-24 |
| **Related Specs** | SPEC-045 (Integration Marketplace), SPEC-045a (Foundation), SPEC-045b (Data Sync Hub) |
| **External Docs** | [BambooHR API Reference](https://documentation.bamboohr.com/reference), [Webhooks](https://documentation.bamboohr.com/docs/webhooks) |

---

## Executive Summary

BambooHR is a strong candidate for an Open Mercato data sync integration. Its REST API covers the core HR domains (employees, time off, time tracking, benefits, ATS, goals, training, files) with good delta-sync support. The integration maps cleanly to the **data sync hub** (`SPEC-045b`) as an **integration bundle** — one npm package (`@open-mercato/sync-bamboohr`) providing multiple `DataSyncAdapter` implementations.

**Overall feasibility: HIGH** — 70-80% of BambooHR's functionality is accessible via API and mappable to Open Mercato's integration framework. The remaining 20-30% (performance reviews, onboarding workflows, payroll processing) is UI-only in BambooHR and cannot be integrated.

---

## 1. Integration Architecture

### Recommended Pattern: Integration Bundle

Following the MedusaJS bundle pattern from SPEC-045a, BambooHR should be implemented as a **bundle** with multiple data sync adapters:

```
sync_bamboohr/
├── integration.ts              # Bundle + individual integrations
├── setup.ts                    # Register adapters
├── di.ts                       # Services
├── lib/
│   ├── shared.ts               # BambooHR API client, auth, rate limiting
│   ├── adapters/
│   │   ├── employees.ts        # DataSyncAdapter for employees
│   │   ├── time-off.ts         # DataSyncAdapter for time off
│   │   ├── time-tracking.ts    # DataSyncAdapter for timesheets
│   │   ├── benefits.ts         # DataSyncAdapter for benefits
│   │   ├── ats.ts              # DataSyncAdapter for applicant tracking
│   │   ├── goals.ts            # DataSyncAdapter for goals
│   │   ├── training.ts         # DataSyncAdapter for training records
│   │   └── files.ts            # DataSyncAdapter for documents
│   └── webhooks/
│       └── handler.ts          # Webhook event processor
├── workers/
│   └── webhook-processor.ts
└── i18n/
    ├── en.ts
    └── pl.ts
```

### Authentication Strategy

BambooHR now requires **OAuth 2.0** for all new applications (API keys deprecated for new apps since April 2025). This maps directly to the `oauth` credential field type from SPEC-045a:

```typescript
export const bundle: IntegrationBundle = {
  id: 'sync_bamboohr',
  title: 'BambooHR',
  description: 'Sync employees, time off, benefits, and more from BambooHR.',
  icon: 'bamboohr',
  package: '@open-mercato/sync-bamboohr',
  credentials: {
    fields: [
      { key: 'companyDomain', label: 'Company Subdomain', type: 'text', required: true,
        placeholder: 'yourcompany' },
      { key: 'clientId', label: 'OAuth Client ID', type: 'text', required: true },
      { key: 'clientSecret', label: 'OAuth Client Secret', type: 'secret', required: true },
      {
        key: 'oauthTokens',
        label: 'BambooHR Account',
        type: 'oauth',
        required: true,
        oauth: {
          provider: 'bamboohr',
          authorizationUrl: 'https://{companyDomain}.bamboohr.com/authorize.php',
          tokenUrl: 'https://{companyDomain}.bamboohr.com/token.php',
          scopes: ['employee', 'benefit', 'offline_access'],
          usePkce: true,
          refreshStrategy: 'background',
          refreshBeforeExpiryMinutes: 5,
        },
      },
    ],
  },
}
```

**Challenge**: The OAuth authorization URL is tenant-specific (`{companyDomain}.bamboohr.com`). The current `OAuthConfig.authorizationUrl` is a static string. This requires either:
- (A) Template variable substitution in OAuth URLs (minor framework extension)
- (B) A custom pre-connect step that builds the URL dynamically

**Recommendation**: Option A — add template variable support to `OAuthConfig`. This is a small, reusable enhancement that benefits any provider with tenant-specific OAuth URLs.

---

## 2. Data Domain Analysis

### 2.1 Employees — FULLY SUPPORTED

| Capability | BambooHR API | Feasibility |
|-----------|-------------|-------------|
| List all employees | `GET /employees` (new, Oct 2025) with cursor pagination | Full |
| Get employee detail | `GET /employees/{id}` with field selection | Full |
| Employee directory | `GET /employees/directory` | Full |
| Create employee | `POST /employees` | Full |
| Update employee | `POST /employees/{id}` | Full |
| Delta sync (changed employees) | `GET /employees/changed` | Full |
| Delta sync (changed tables) | `GET /employees/changed/tables` | Full |
| Custom fields | Supported via metadata API | Full |
| Tabular data (job history, compensation) | `GET/POST /employees/{id}/tables/{tableId}` | Full |
| Employee photos | `GET/POST /employees/{id}/photo` | Full |

**DataSyncAdapter mapping**:
- `direction`: `bidirectional`
- `supportedEntities`: `['hr.employee']`
- Delta cursor: Use `GET /employees/changed` with `since` parameter — returns only IDs that changed, then fetch full records
- Match strategy: `externalId` (BambooHR employee ID is immutable)

**Complexity**: LOW — BambooHR's delta endpoint is purpose-built for sync. Maps cleanly to `StreamImportInput.cursor`.

**Limitation**: The legacy `GET /employees/directory` returns ALL employees with no pagination. The newer `GET /employees` endpoint (Oct 2025) supports cursor-based pagination but requires OAuth scopes. For initial full sync, the adapter should use the new paginated endpoint.

### 2.2 Time Off — FULLY SUPPORTED

| Capability | BambooHR API | Feasibility |
|-----------|-------------|-------------|
| List time off requests | `GET /time_off/requests` with date range | Full |
| Create time off request | `PUT /time_off/requests` | Full |
| Approve/deny requests | `PUT /time_off/requests/{id}/status` | Full |
| Time off balances | `PUT /time_off/balance` | Full |
| Time off policies | `GET /time_off/policies` | Full |
| Who's out today | `GET /time_off/whos_out` | Full |
| Estimate future balance | `GET /time_off/estimate_balance` | Full |

**DataSyncAdapter mapping**:
- `direction`: `bidirectional`
- `supportedEntities`: `['hr.time_off_request', 'hr.time_off_policy']`
- Delta cursor: Filter by `start`/`end` date range on requests
- Match strategy: `externalId`

**Complexity**: LOW

### 2.3 Time Tracking — FULLY SUPPORTED

| Capability | BambooHR API | Feasibility |
|-----------|-------------|-------------|
| Get timesheets | `GET /timesheets` | Full |
| Clock in/out | `POST /timesheets/clock_in`, `clock_out` | Full |
| Hour entries | `POST /timesheets/hour_entries` | Full |
| Time tracking projects | `POST /timesheets/projects` | Full |
| Bulk operations | `POST /time_tracking/hours/bulk` | Full |

**DataSyncAdapter mapping**:
- `direction`: `bidirectional`
- `supportedEntities`: `['hr.timesheet', 'hr.time_tracking_project']`
- Delta cursor: Date-range filtering on timesheets

**Complexity**: LOW

### 2.4 Benefits — FULLY SUPPORTED (New API, Jan 2026)

| Capability | BambooHR API | Feasibility |
|-----------|-------------|-------------|
| Company benefit plans | `GET /benefits/company_benefits` | Full |
| Employee benefits | `GET /employees/{id}/benefits` | Full |
| Dependents | CRUD at `/employees/{id}/dependents` | Full |
| Benefit coverages | `GET /benefits/coverages` | Full |
| Deduction types | `GET /benefits/deduction_types` | Full |
| Member benefit events | `GET /benefits/member_benefit_events` | Full |

**DataSyncAdapter mapping**:
- `direction`: `import` (read-only sync to Open Mercato)
- `supportedEntities`: `['hr.benefit_plan', 'hr.employee_benefit', 'hr.dependent']`

**Complexity**: MEDIUM — New API (Jan 2026), requires `benefit` OAuth scope. May need to handle scope availability.

### 2.5 Applicant Tracking (ATS) — FULLY SUPPORTED

| Capability | BambooHR API | Feasibility |
|-----------|-------------|-------------|
| Job openings | `GET/POST /applicant_tracking/jobs` | Full |
| Candidates | `POST /applicant_tracking/candidates` | Full (create only) |
| Applications | `GET /applicant_tracking/applications` | Full |
| Application status | `POST .../applications/{id}/status` | Full |
| Comments | `POST .../applications/{id}/comments` | Full |
| Hiring leads | `GET /applicant_tracking/hiring_leads` | Full |
| Locations | `GET /applicant_tracking/locations` | Full |

**DataSyncAdapter mapping**:
- `direction`: `bidirectional`
- `supportedEntities`: `['hr.job_opening', 'hr.candidate', 'hr.job_application']`

**Complexity**: LOW-MEDIUM — No delta endpoint for ATS, so full sync required on each run. For high-volume recruiting this could be slow.

### 2.6 Goals — FULLY SUPPORTED

| Capability | BambooHR API | Feasibility |
|-----------|-------------|-------------|
| CRUD goals | Full REST API | Full |
| Goal progress | `PUT /goals/{id}/progress` | Full |
| Milestones | `PUT /goals/{id}/milestones/{id}` | Full |
| Comments | Full CRUD | Full |
| Sharing | `PUT /goals/{id}/shared_with` | Full |
| Aggregation | `GET /goals/aggregate` | Full |

**DataSyncAdapter mapping**:
- `direction`: `bidirectional`
- `supportedEntities`: `['hr.goal']`

**Complexity**: LOW

### 2.7 Training — FULLY SUPPORTED

| Capability | BambooHR API | Feasibility |
|-----------|-------------|-------------|
| Employee training records | Full CRUD | Full |
| Training types | Full CRUD | Full |
| Training categories | Full CRUD | Full |

**DataSyncAdapter mapping**:
- `direction`: `bidirectional`
- `supportedEntities`: `['hr.training_record', 'hr.training_type']`

**Complexity**: LOW

### 2.8 Files & Documents — FULLY SUPPORTED

| Capability | BambooHR API | Feasibility |
|-----------|-------------|-------------|
| Company files | Full CRUD + upload/download | Full |
| Employee files | Full CRUD + upload/download | Full |
| File categories | Create company/employee categories | Full |

**DataSyncAdapter mapping**:
- `direction`: `bidirectional`
- `supportedEntities`: `['hr.document']`
- Requires storage provider integration for file content

**Complexity**: MEDIUM — File sync requires handling binary content, storage integration, and potentially large file sizes.

### 2.9 Reports — PARTIALLY SUPPORTED

| Capability | BambooHR API | Feasibility |
|-----------|-------------|-------------|
| List company reports | `GET /reports/company` | Full |
| Get report by ID | `GET /reports/{id}` | Full |
| Custom reports | `POST /reports/custom` | Full |
| Multiple formats | CSV, PDF, XLS, XML, JSON | Full |

**Not a data sync adapter** — reports are better exposed as an on-demand export feature or as a widget in the integration detail page, not a scheduled sync.

**Complexity**: LOW (but architectural decision needed on where this fits)

### 2.10 Datasets API — FULLY SUPPORTED

| Capability | BambooHR API | Feasibility |
|-----------|-------------|-------------|
| List datasets | `GET /datasets` | Full |
| Get dataset fields | `GET /datasets/{id}/fields` | Full |
| Get dataset data | `POST /datasets/{id}/data` | Full |
| Field options | `POST /datasets/{id}/field_options` | Full |

This is a flexible alternative data access layer. Could be used as a fallback for entities not covered by specific endpoints.

**Complexity**: MEDIUM — Generic but powerful; could serve as a universal adapter for custom data needs.

---

## 3. What's MISSING or DIFFICULT

### 3.1 NOT Available via API (Cannot Integrate)

| Feature | Impact | Workaround |
|---------|--------|-----------|
| **Performance reviews / assessments** | HIGH — core HR feature, no API for review cycles, assessment forms, 360 feedback, peer reviews | None. Goals API covers goal tracking only. Admin must use BambooHR UI. |
| **Onboarding workflows** | HIGH — no API for onboarding checklists, pre-boarding packets, task completion tracking | None. Can only create employees and assign policies via API. |
| **Payroll processing** | MEDIUM — compensation data fields are available, but actual payroll runs, tax calculations, pay stubs are not exposed | Can sync compensation data (salary, pay rate) but not payroll execution. |
| **E-signatures** | MEDIUM — no API for e-signature documents or status | None. UI-only feature. |
| **Document templates** | LOW — no API for offer/letter templates | None. |
| **Org chart** | LOW — no direct endpoint | Can be constructed from `reportsTo` field on employee records. Feasible but requires client-side assembly. |
| **Employee satisfaction surveys / eNPS** | LOW — no API | None. |
| **Company announcements** | LOW — no API | None. |
| **Audit trail / activity log** | LOW — not exposed via API | Can rely on Open Mercato's `IntegrationLog` for integration-level audit. |

### 3.2 Difficult / Requires Extra Work

| Challenge | Difficulty | Description |
|-----------|-----------|-------------|
| **Dynamic OAuth URL** | MEDIUM | BambooHR OAuth URLs include the company subdomain (`{company}.bamboohr.com/authorize.php`). SPEC-045a's `OAuthConfig.authorizationUrl` is static. Requires template variable support or a dynamic URL builder. |
| **Unpublished rate limits** | MEDIUM | BambooHR does not document specific rate limits. Must implement conservative throttling with exponential backoff on 503 responses. The `rate-limiter.ts` from SPEC-045b should use a conservative default (e.g., 2 req/s) with adaptive adjustment. |
| **Employee directory — no pagination** | MEDIUM | Legacy `GET /employees/directory` returns all employees at once. For companies with 10K+ employees, this can be slow/memory-intensive. The newer `GET /employees` endpoint (Oct 2025) has pagination but requires OAuth. |
| **No delta sync for ATS** | MEDIUM | Applicant tracking endpoints lack a "changed since" mechanism. Full sync required each time. For high-volume recruiting (1000+ applications), this is inefficient. Consider polling frequency or using webhooks as a trigger. |
| **No delta sync for benefits, goals, training** | MEDIUM | These endpoints lack delta/changed mechanisms. Must do full sync or track changes locally via content hashing (`ImportItem.hash`). |
| **Custom table fields not in webhooks** | LOW-MEDIUM | Webhooks can monitor standard + custom employee-level fields, but NOT custom table fields (e.g., job history changes). Custom table changes require polling via `GET /employees/changed/tables`. |
| **Permission-scoped API access** | LOW-MEDIUM | OAuth tokens inherit the authorizing user's permission level. If the admin lacks access to certain fields (e.g., salary), the API cannot retrieve them. Must document this clearly in setup instructions. |
| **400-field limit per request** | LOW | `GET /employees/{id}` and custom reports are capped at 400 fields per request. For companies with extensive custom fields, multiple requests may be needed. |
| **Webhook private key — one-time display** | LOW | When creating permissioned webhooks via API, the private key for HMAC verification is only returned once at creation time. Must store it immediately in `IntegrationCredentials`. |

---

## 4. Webhook / Real-Time Integration

### 4.1 BambooHR Webhooks Map Well to SPEC-045

BambooHR's webhook system supports three event types relevant to data sync:

| Event | Use Case |
|-------|----------|
| `Created` | New employee added — trigger immediate import |
| `Updated` | Employee fields changed — trigger delta sync for affected employee |
| `Deleted` | Employee removed — trigger soft-delete or deactivation in Open Mercato |

### 4.2 Implementation Approach

```typescript
// sync_bamboohr/integration.ts — webhook integration within the bundle

{
  id: 'sync_bamboohr_webhooks',
  title: 'BambooHR — Webhooks',
  description: 'Receive real-time employee updates from BambooHR.',
  category: 'webhook',
  hub: 'webhook_endpoints',
  providerKey: 'bamboohr_webhooks',
  bundleId: 'sync_bamboohr',
  tags: ['webhooks', 'real-time', 'employees'],
  credentials: { fields: [] }, // Inherits from bundle
}
```

### 4.3 Webhook Security

- HTTPS required (matches Open Mercato's default)
- SHA-256 HMAC signature verification via `X-BambooHR-Signature` header
- Timestamp header (`X-BambooHR-Timestamp`) for replay protection
- Retry with exponential backoff (5 attempts over ~75 minutes)

### 4.4 Webhook Limitations

- Only monitors **employee** changes (no webhooks for time off, benefits, ATS, etc.)
- Cannot monitor custom table fields (job history, compensation history changes)
- Permissioned webhooks stop working if the creating user is deactivated
- **Recommendation**: Use webhooks as a **trigger** for immediate employee delta sync, but rely on **scheduled polling** for all other data domains.

---

## 5. Entity Mapping to Open Mercato

BambooHR is an HR system, and Open Mercato is primarily a commerce platform. The integration requires defining HR entities within Open Mercato's data model. Two approaches:

### Option A: Map to Existing Modules (Partial)

| BambooHR Entity | Open Mercato Module | Mapping |
|----------------|-------------------|---------|
| Employee | `customers.person` | Name, email, phone, address. Limited — missing HR-specific fields (department, job title, hire date). |
| Company | `customers.company` | Company name, address. |

**Verdict**: Poor fit. Commerce-oriented person/company entities lack HR semantics.

### Option B: Create HR Module Extension (Recommended)

Create HR-specific custom entities via the custom entities system (`ce.ts`):

| BambooHR Entity | Open Mercato Custom Entity | Key Fields |
|----------------|--------------------------|-----------|
| Employee | `hr.employee` | firstName, lastName, email, department, division, jobTitle, hireDate, employmentStatus, supervisor, location, workPhone, mobilePhone, homeEmail |
| Time Off Request | `hr.time_off_request` | employeeId, type, status, startDate, endDate, amount, notes, approvedBy |
| Time Off Policy | `hr.time_off_policy` | name, type, accrualRate |
| Timesheet Entry | `hr.timesheet` | employeeId, date, hoursWorked, projectId, clockIn, clockOut |
| Benefit Plan | `hr.benefit_plan` | name, type, provider, startDate, endDate |
| Employee Benefit | `hr.employee_benefit` | employeeId, planId, enrollmentDate, coverageLevel |
| Dependent | `hr.dependent` | employeeId, firstName, lastName, relationship, dateOfBirth |
| Job Opening | `hr.job_opening` | title, department, location, status, hiringLead |
| Candidate | `hr.candidate` | firstName, lastName, email, phone, source |
| Job Application | `hr.job_application` | candidateId, jobOpeningId, status, appliedDate |
| Goal | `hr.goal` | employeeId, title, description, status, percentComplete, dueDate |
| Training Record | `hr.training_record` | employeeId, trainingTypeId, completedDate, score |

This is a **significant amount of entity modeling** — it would likely be a separate HR module (`packages/core/src/modules/hr/`) rather than custom entities on an existing module.

---

## 6. Effort Estimation

### Phase 1: Core Employee Sync (MVP)

| Task | Effort |
|------|--------|
| Bundle scaffolding + OAuth setup | 2-3 days |
| Dynamic OAuth URL support (framework) | 1 day |
| BambooHR API client (shared.ts) | 2 days |
| Employee DataSyncAdapter (import + delta) | 3 days |
| Employee DataSyncAdapter (export/create) | 2 days |
| Webhook handler for employee changes | 2 days |
| HR employee entity/module | 3-4 days |
| Field mapping defaults | 1 day |
| Integration tests | 2-3 days |
| **Phase 1 Total** | **~18-21 days** |

### Phase 2: Extended HR Data

| Task | Effort |
|------|--------|
| Time off adapter (import + bidirectional) | 3 days |
| Time tracking adapter | 2 days |
| Benefits adapter (import) | 2 days |
| HR entities for time off, timesheets, benefits | 3-4 days |
| Integration tests | 2-3 days |
| **Phase 2 Total** | **~12-15 days** |

### Phase 3: ATS, Goals, Training, Files

| Task | Effort |
|------|--------|
| ATS adapter (jobs + candidates + applications) | 3-4 days |
| Goals adapter | 2 days |
| Training adapter | 2 days |
| Files adapter (with storage integration) | 3-4 days |
| HR entities for ATS, goals, training | 3-4 days |
| Integration tests | 3-4 days |
| **Phase 3 Total** | **~16-20 days** |

### Total Estimated Effort: ~46-56 days

---

## 7. Framework Gaps

The following enhancements to SPEC-045 are needed (or would significantly help) for BambooHR:

| Gap | Impact | Required For |
|-----|--------|-------------|
| **Dynamic OAuth URL templates** | MEDIUM | BambooHR's tenant-specific OAuth URLs. Useful for any provider with dynamic OAuth endpoints (Shopify, etc.) |
| **Adaptive rate limiter** | LOW | BambooHR doesn't publish rate limits. The existing `rate-limiter.ts` from SPEC-045b needs a "start conservative, adapt on 503" mode. |
| **Polling-based delta for non-delta APIs** | LOW | Some BambooHR endpoints lack delta support. A generic "hash-and-compare" utility in the data sync hub would help. Could be built into `sync-engine.ts`. |
| **HR module** | HIGH | Open Mercato has no HR data model. BambooHR integration needs somewhere to store employee/HR data. This is the biggest prerequisite. |

---

## 8. Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|------|----------|-----------|------------|
| BambooHR modifies/removes API endpoints without notice | HIGH | LOW | Pin to known working version. Monitor BambooHR changelog. Use API versioning from SPEC-045a. |
| Rate limiting causes sync failures | MEDIUM | MEDIUM | Conservative default rate (2 req/s), exponential backoff on 503, adaptive throttling. |
| OAuth scope changes break access | MEDIUM | LOW | Request minimum required scopes. Handle 403 gracefully with re-auth prompt. |
| Large dataset initial sync times out | MEDIUM | MEDIUM | Streaming + cursor persistence handles this. Set generous worker timeout for initial full sync. |
| Custom field schema drift | LOW | MEDIUM | Use metadata API to discover fields dynamically. Log warnings for unmapped fields. |
| Webhook delivery failures | LOW | LOW | BambooHR retries 5 times. Combine with scheduled polling as fallback. |

---

## 9. Comparison: BambooHR vs Other HR Systems

| Feature | BambooHR | Workday | ADP | Gusto |
|---------|----------|---------|-----|-------|
| REST API | Yes (v1) | Limited (SOAP/REST hybrid) | REST (varies by product) | REST |
| OAuth 2.0 | Yes (required since Apr 2025) | Yes | Yes | Yes |
| Employee CRUD | Full | Partial | Full | Full |
| Delta sync | Yes (changed endpoint) | Limited | Varies | No |
| Webhooks | Yes (employee only) | Yes (broader) | Limited | Limited |
| Payroll via API | No | Limited | Yes | Yes |
| Performance reviews | No (goals only) | Yes | No | No |
| Rate limits published | No | Yes | Yes | Yes |
| API stability | Good (few breaking changes) | Enterprise-grade | Variable | Good |

**BambooHR is one of the more API-friendly SMB HR platforms**, making it a solid first HR integration target.

---

## 10. Recommendations

1. **Build as a bundle** (`@open-mercato/sync-bamboohr`) with 6-8 data sync adapters + 1 webhook integration
2. **Prerequisite**: Create an HR module in Open Mercato (`packages/core/src/modules/hr/`) with basic employee, time off, and timesheet entities before starting the BambooHR adapter
3. **Start with employee sync** (Phase 1) — it's the highest-value, best-supported data domain with delta sync + webhooks
4. **Add dynamic OAuth URL support** to SPEC-045a as a minor enhancement (template variables in `OAuthConfig`)
5. **Accept the gaps**: Performance reviews, onboarding, and payroll are not API-accessible and should be documented as out of scope
6. **Use webhooks as triggers, not as the primary sync mechanism** — they only cover employee changes and are unreliable if the creating user is deactivated
7. **Implement conservative rate limiting** with adaptive backoff since BambooHR doesn't publish rate limits

---

## 11. Conclusion

BambooHR is a **well-suited integration target** for Open Mercato's integration marketplace. The API coverage is broad enough to deliver high value (employee data, time off, benefits, recruiting), the authentication model aligns with SPEC-045a's OAuth support, and the delta sync capabilities map directly to the data sync hub's cursor-based streaming model.

The main challenge is not the BambooHR API itself, but the **absence of an HR data model in Open Mercato**. Building the HR module is the largest prerequisite and would need to come first (or in parallel). The BambooHR integration then becomes a straightforward application of the data sync adapter pattern.

**Missing features** (performance reviews, onboarding, payroll) are BambooHR platform limitations, not Open Mercato limitations. They should be documented as unsupported and accepted as scope constraints.
