# SPEC-060: Customer 360 Degree Overview

| Field | Value |
|-------|-------|
| **Status** | Draft |
| **Author** | Agent |
| **Created** | 2026-03-08 |
| **Related** | SPEC-046 (Detail Pages v2 / CrudForm Rewrite), SPEC-058 (Full-Scale CRM Deals Pipeline), SPEC-059 (Unified Deal Timeline), SPEC-046b (Interactions Unification) |

## TLDR

**Key Points:**
- Transform the company detail page from a basic data editor into a comprehensive customer intelligence hub showing company profile, organizational structure (branches), contacts with decision roles, purchase history, active offers, relationship timeline, and a KPI dashboard strip
- CustomerBranch entity already exists as a first-class entity with full CRUD support; this spec adds the 360-view UX layer, metrics API, purchase history integration, and CRM alert system on top
- Generic 360-view layout: provides structure (dashboard KPIs, branches tab, purchase history, alerts) while tenants configure their own custom fields via the admin UI. No hardcoded industry-specific fields
- Health score algorithm based on weighted composite of activity recency, deal health, order frequency, and interaction count
- New injection spot `customers.company.detail:dashboard` for third-party KPI widgets
- Sales integration via response enrichers and query engine (no direct ORM imports across modules)

**Scope:**
- Phase 1: Branch entity CRUD (API routes, commands, events, ACL, i18n)
- Phase 2: Customer dashboard KPI strip with health score
- Phase 3: Company 360 page layout with restructured tabs
- Phase 4: Purchase history and sales module integration
- Phase 5: CRM alerts system
- Phase 6: Search and analytics updates

**Concerns:**
- Health score computation may be expensive for companies with high activity volume; caching mitigates this
- Sales module integration requires response enrichers and careful tenant-scoping; no direct ORM relationships
- Alert thresholds must be tenant-configurable to avoid false positives across different business models

## Context

A partner with 2x Bitrix24 CRM deployment experience in the medical equipment sector proposed this feature. The current company detail page is a functional data editor but lacks the intelligence layer that sales teams need to understand customer health, organizational structure, and purchase patterns at a glance.

Market leaders (Salesforce Account View, HubSpot Company Insights, Bitrix24 Company Profile) all provide consolidated customer intelligence dashboards. This spec brings Open Mercato to feature parity by layering a 360-degree view on top of the existing CrudForm-based detail page (SPEC-046).

### Spec Intersections

| Spec | Relationship |
|------|-------------|
| SPEC-046 (Detail Pages v2) | Foundation: company detail page already uses CrudForm with Zone 1 (form) + Zone 2 (tabs). This spec extends Zone 2 with new tabs and adds a KPI strip above Zone 1 |
| SPEC-058 (Full-Scale CRM Deals Pipeline) | Data source: deal pipeline data, stage history, win/loss metrics feed the KPI strip and health score |
| SPEC-059 (Unified Deal Timeline) | UX pattern: the timeline drawer pattern (right-side slide-in) can be reused for relationship timeline. The deal timeline normalizer/aggregator patterns inform the company-level timeline |
| SPEC-046b (Interactions Unification) | Data source: unified activities/interactions feed the "activity recency" health score component |

## Overview

The Customer 360 Overview transforms the company detail page into a customer intelligence hub by adding five capabilities:

1. **Branch management**: Full CRUD for organizational branches (headquarters, regional offices, warehouses) with address linkage
2. **KPI dashboard strip**: Real-time metrics bar showing health score, total revenue, active deals, last interaction, and open activities
3. **Enhanced page layout**: Restructured company detail page with CRM alerts banner, KPI strip, and new tabs (Overview, Branches, Purchase History)
4. **Purchase history**: Sales order history aggregated from the sales module via response enrichers
5. **CRM alerts**: Proactive alert system surfacing stalled deals, overdue activities, declining purchase trends, and inactivity warnings

## Problem Statement

### Current State

1. **No organizational structure**: Companies exist as flat entities. Real-world B2B customers have branches, regional offices, and warehouses, each with their own contacts, budgets, and purchasing patterns. There is no way to model this hierarchy.

2. **No customer health visibility**: The company detail page shows raw data fields but no synthesized intelligence. Users cannot answer "Is this customer healthy?" without manually checking deals, activities, and orders across multiple tabs.

3. **No purchase history**: Sales orders linked to a company are only visible from the sales module. There is no company-centric view of purchasing patterns, top products, or revenue trends.

4. **No proactive alerts**: Users discover problems reactively by checking individual deals or activities. The system does not surface "this customer hasn't been contacted in 30 days" or "their quarterly order volume is declining."

5. **No KPI context**: The company header shows name, email, and status, but no quantitative business metrics. Users must navigate to separate dashboards for revenue and deal statistics.

### Goal

Provide a single-page customer intelligence view where:
- Sales reps can assess customer health in under 5 seconds (KPI strip)
- Account managers can see organizational structure and key contacts per branch
- Sales managers can identify at-risk customers via proactive alerts
- All users can review purchase history without leaving the company page
- Third-party modules can inject custom KPI widgets into the dashboard

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| CustomerBranch as first-class entity | Branches have their own lifecycle (CRUD), addresses, contacts, and budgets. A simple JSON array would prevent querying, indexing, and RBAC |
| Generic 360 view layout | Provides structure (dashboard, branches, purchase history, alerts) without hardcoded industry-specific fields. Tenants configure via custom fields admin UI |
| Health score as weighted composite | Activity recency (30%), deal pipeline health (25%), order frequency (25%), interaction count (20%) cover the four pillars of customer engagement. Weights are server-side constants, configurable in a future settings UI |
| New injection spot for KPI widgets | `customers.company.detail:dashboard` lets third-party modules (e.g., loyalty, support tickets) inject KPI cards without modifying core code |
| Sales integration via response enrichers | No direct ORM imports between customers and sales modules. Purchase history and revenue metrics are fetched via response enrichers and dedicated API endpoints that query the sales module's data through the query engine |
| Metrics endpoint with caching | The metrics computation queries multiple tables. A 5-minute cache (tag-based invalidation on company/deal/order events) keeps response times under 200ms |
| Alerts as computed, not stored | Alert rules are evaluated at request time against live data. No `customer_alerts` table. This avoids stale alert state and complex synchronization |

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Branch as custom entity (EAV) | Custom entities lack typed fields, dedicated indexes, and command-pattern undo support. Branch management is core CRM functionality |
| Separate analytics dashboard page | Fragments the user experience. The 360 view's value is showing everything on one page. A separate page would not reduce the number of tabs users check |
| Pre-computed health score (stored column) | Adds schema complexity and synchronization burden. Real-time computation with caching is simpler and always consistent |
| Client-side metrics aggregation | Multiple parallel API calls from the browser; complex client-side logic; worse mobile performance. Server-side aggregation is more efficient |

## Proposed Solution

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Company 360 Detail Page                                      │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ CRM Alerts Banner (Phase 5)                              │ │
│  │ [!] No activity in 30 days  [!] 2 stalled deals          │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ KPI Dashboard Strip (Phase 2)                            │ │
│  │ ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ │ │
│  │ │ Health  │ │ Revenue  │ │ Active   │ │ Last         │ │ │
│  │ │ Score   │ │ (12mo)   │ │ Deals    │ │ Interaction  │ │ │
│  │ │ 78/100  │ │ $124,500 │ │ 3        │ │ 5 days ago   │ │ │
│  │ └─────────┘ └──────────┘ └──────────┘ └──────────────┘ │ │
│  │ InjectionSpot: customers.company.detail:dashboard        │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Zone 1: CrudForm (existing from SPEC-046)                │ │
│  │   Company fields, custom fields, addresses               │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Zone 2: Enhanced Tab Navigation (Phase 3)                │ │
│  │ [Overview] [Contacts] [Branches] [Deals] [Purchase Hx]  │ │
│  │ [Activities] [Notes] [Tasks] [+ injected tabs]           │ │
│  │                                                            │ │
│  │  InjectionSpot: detail:customers.company:tabs             │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow

```
1. Page loads → GET /api/customers/companies/{id}?include=todos&include=people
2. Parallel: GET /api/customers/companies/{id}/metrics (Phase 2)
3. Parallel: GET /api/customers/branches?companyEntityId={id} (Phase 1)
4. CRM alerts computed client-side from metrics + activity data (Phase 5)
5. Purchase history lazy-loaded on tab click: GET /api/customers/companies/{id}/purchase-history (Phase 4)
6. KPI strip renders from metrics response
7. Alerts banner renders from computed alert rules
```

### Component Structure

```
packages/core/src/modules/customers/
├── api/
│   ├── branches/
│   │   └── route.ts                     # Branch CRUD (Phase 1)
│   ├── companies/
│   │   └── [id]/
│   │       ├── metrics/
│   │       │   └── route.ts             # GET metrics endpoint (Phase 2)
│   │       └── purchase-history/
│   │           └── route.ts             # GET purchase history (Phase 4)
├── commands/
│   └── branches.ts                      # Branch create/update/delete commands (Phase 1)
├── lib/
│   ├── metrics/
│   │   ├── types.ts                     # CompanyMetrics, HealthScore types
│   │   ├── calculator.ts               # Health score computation
│   │   └── aggregator.ts               # Metrics aggregation from multiple sources
│   └── alerts/
│       ├── types.ts                     # AlertRule, CrmAlert types
│       └── evaluator.ts                # Alert rule evaluation
├── components/
│   └── detail/
│       ├── CompanyDashboardStrip.tsx    # KPI cards row (Phase 2)
│       ├── CompanyAlertsBanner.tsx      # Alert banner (Phase 5)
│       ├── BranchesSection.tsx          # Branches tab content (Phase 3)
│       ├── PurchaseHistorySection.tsx   # Purchase history tab (Phase 4)
│       └── CompanyOverviewTab.tsx       # Overview tab with summary (Phase 3)
```

## Data Models

### CustomerBranch (existing entity)

The `CustomerBranch` entity already exists in `data/entities.ts` (table: `customer_branches`). No schema changes needed.

| Column | Type | Nullable | Description |
|--------|------|----------|-------------|
| `id` | uuid | no | PK |
| `organization_id` | uuid | no | Tenant scope |
| `tenant_id` | uuid | no | Tenant scope |
| `company_entity_id` | uuid | no | FK to `customer_entities.id` |
| `name` | text | no | Branch display name |
| `branch_type` | text | yes | `headquarters` / `branch` / `warehouse` / `office` |
| `specialization` | text | yes | Free-text specialization description |
| `budget` | numeric(14,2) | yes | Annual budget |
| `headcount` | integer | yes | Number of employees |
| `responsible_person_id` | uuid | yes | FK to `customer_entities.id` (person kind) |
| `is_active` | boolean | no | Default true |
| `created_at` | timestamptz | no | Auto |
| `updated_at` | timestamptz | no | Auto |
| `deleted_at` | timestamptz | yes | Soft delete |

### CustomerAddress.branchId (existing column)

The `branch_id` nullable UUID column already exists on `customer_addresses`. Addresses can be linked to branches.

### CompanyMetrics (API response type, not stored)

```typescript
type CompanyMetrics = {
  healthScore: {
    value: number           // 0-100
    trend: 'up' | 'down' | 'stable'
    components: {
      activityRecency: number    // 0-100, weight: 30%
      dealHealth: number         // 0-100, weight: 25%
      orderFrequency: number     // 0-100, weight: 25%
      interactionCount: number   // 0-100, weight: 20%
    }
  }
  revenue: {
    total12Months: string        // numeric string
    total3Months: string
    currency: string
    trend: 'up' | 'down' | 'stable'
  }
  deals: {
    activeCount: number
    wonCount12Months: number
    lostCount12Months: number
    totalValue: string           // numeric string, active deals
    weightedValue: string        // probability-weighted pipeline value
  }
  activities: {
    lastInteractionAt: string | null   // ISO-8601
    openCount: number
    overdueCount: number
  }
  branches: {
    totalCount: number
    activeCount: number
  }
  contacts: {
    totalCount: number
    withRolesCount: number
  }
}
```

### CrmAlert (computed type, not stored)

```typescript
type CrmAlertSeverity = 'warning' | 'critical'

type CrmAlert = {
  id: string                         // deterministic: rule + companyId
  ruleId: string                     // e.g., 'no-recent-activity'
  severity: CrmAlertSeverity
  message: string                    // i18n-resolved
  navigateTo?: string               // optional tab/route to navigate to
  data: Record<string, unknown>     // rule-specific context for the UI
}
```

## API Contracts

### POST /api/customers/branches (Create Branch)

**Request Body:**

```json
{
  "companyEntityId": "uuid",
  "name": "Regional Office - Warsaw",
  "branchType": "branch",
  "specialization": "Distribution",
  "budget": "500000.00",
  "headcount": 25,
  "responsiblePersonId": "uuid"
}
```

**Response:** `201 Created` with created branch object.

**Auth:** `requireAuth: true`, `requireFeatures: ['customers.companies.manage']`

### GET /api/customers/branches

**Query Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `companyEntityId` | uuid | Required. Filter by parent company |
| `includeInactive` | boolean | Default false |
| `page` | number | Pagination |
| `pageSize` | number | Default 25, max 100 |

**Response:** Paged list of `CustomerBranch` objects.

**Auth:** `requireAuth: true`, `requireFeatures: ['customers.companies.view']`

### PUT /api/customers/branches

**Request Body:** Full branch object with `id`.

**Response:** `200 OK` with updated branch.

**Auth:** `requireAuth: true`, `requireFeatures: ['customers.companies.manage']`

### DELETE /api/customers/branches

**Request Body:** `{ "id": "uuid" }`

**Response:** `200 OK`

**Auth:** `requireAuth: true`, `requireFeatures: ['customers.companies.manage']`

### GET /api/customers/companies/:id/metrics

Returns computed metrics for a company.

**Response:**

```json
{
  "healthScore": {
    "value": 78,
    "trend": "up",
    "components": {
      "activityRecency": 85,
      "dealHealth": 72,
      "orderFrequency": 80,
      "interactionCount": 70
    }
  },
  "revenue": {
    "total12Months": "124500.00",
    "total3Months": "32000.00",
    "currency": "USD",
    "trend": "stable"
  },
  "deals": {
    "activeCount": 3,
    "wonCount12Months": 5,
    "lostCount12Months": 1,
    "totalValue": "45000.00",
    "weightedValue": "27500.00"
  },
  "activities": {
    "lastInteractionAt": "2026-03-03T14:30:00Z",
    "openCount": 2,
    "overdueCount": 0
  },
  "branches": {
    "totalCount": 4,
    "activeCount": 3
  },
  "contacts": {
    "totalCount": 12,
    "withRolesCount": 5
  }
}
```

**Auth:** `requireAuth: true`, `requireFeatures: ['customers.companies.view']`

**Caching:** 5-minute TTL, invalidated by tags: `company:{id}`, `deals:company:{id}`, `orders:company:{id}`, `activities:company:{id}`

**OpenAPI:** Exported as `openApi` from the route file.

### GET /api/customers/companies/:id/purchase-history

Returns paginated purchase history for a company, sourced from the sales module.

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `pageSize` | number | 25 | Items per page (max 100) |
| `dateFrom` | string (ISO-8601) | - | Filter: orders after this date |
| `dateTo` | string (ISO-8601) | - | Filter: orders before this date |
| `sortField` | string | `createdAt` | Sort column |
| `sortDir` | string | `desc` | Sort direction |

**Response:**

```json
{
  "items": [
    {
      "orderId": "uuid",
      "orderNumber": "ORD-2026-0042",
      "status": "completed",
      "totalAmount": "12500.00",
      "currency": "USD",
      "createdAt": "2026-02-15T10:00:00Z",
      "completedAt": "2026-02-20T16:00:00Z",
      "lineCount": 3
    }
  ],
  "summary": {
    "totalOrders": 18,
    "totalRevenue": "124500.00",
    "averageOrderValue": "6916.67",
    "currency": "USD",
    "firstOrderAt": "2025-06-10T08:00:00Z",
    "lastOrderAt": "2026-02-20T16:00:00Z"
  },
  "topProducts": [
    {
      "productId": "uuid",
      "productName": "Widget Pro X",
      "totalQuantity": 150,
      "totalRevenue": "45000.00"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 25,
    "totalItems": 18,
    "totalPages": 1
  }
}
```

**Auth:** `requireAuth: true`, `requireFeatures: ['customers.companies.view']`

**OpenAPI:** Exported as `openApi` from the route file.

**Error responses:** Standard 401/403/404. If sales module is not enabled, returns `{ items: [], summary: null, topProducts: [], pagination: { ... } }` with empty data rather than an error.

## Health Score Algorithm

The health score is a weighted composite of four components, each normalized to 0-100:

### Component 1: Activity Recency (30%)

Measures how recently the company had any interaction (activity, comment, deal update).

| Days Since Last Interaction | Score |
|----------------------------|-------|
| 0-7 days | 100 |
| 8-14 days | 80 |
| 15-30 days | 60 |
| 31-60 days | 30 |
| 61-90 days | 10 |
| 90+ days or never | 0 |

### Component 2: Deal Pipeline Health (25%)

Measures the quality of the active deal pipeline.

```
score = 0
if (activeDeals > 0) {
  avgProbability = sum(deal.probability) / activeDeals
  stalledRatio = stalledDeals / activeDeals   // stalled = no activity in 14+ days
  score = avgProbability * (1 - stalledRatio * 0.5)
}
// Bonus: recent wins boost the score
if (wonDealsLast90Days > 0) score = min(100, score + 15)
```

### Component 3: Order Frequency (25%)

Measures purchasing consistency over the trailing 12 months.

| Orders in Last 12 Months | Score |
|--------------------------|-------|
| 6+ orders | 100 |
| 4-5 orders | 80 |
| 2-3 orders | 60 |
| 1 order | 30 |
| 0 orders | 0 |

Note: if the sales module is not enabled, this component returns 50 (neutral) and its weight is redistributed to other components.

### Component 4: Interaction Count (20%)

Measures engagement depth over the trailing 90 days.

| Interactions in Last 90 Days | Score |
|-----------------------------|-------|
| 10+ interactions | 100 |
| 6-9 interactions | 80 |
| 3-5 interactions | 60 |
| 1-2 interactions | 30 |
| 0 interactions | 0 |

### Trend Calculation

Compare the current health score with the score from 30 days ago (using the same algorithm against historical data snapshots):
- Difference > +5: trend = `up`
- Difference < -5: trend = `down`
- Otherwise: trend = `stable`

If historical data is insufficient for comparison, trend defaults to `stable`.

## Internationalization (i18n)

New keys under `customers.360.*` and `customers.branches.*`:

### Branch Keys

| Key | Default (en) |
|-----|-------------|
| `customers.branches.title` | `Branches` |
| `customers.branches.create` | `Add Branch` |
| `customers.branches.edit` | `Edit Branch` |
| `customers.branches.delete` | `Delete Branch` |
| `customers.branches.deleteConfirm` | `Are you sure you want to delete this branch?` |
| `customers.branches.name` | `Branch Name` |
| `customers.branches.type` | `Type` |
| `customers.branches.type.headquarters` | `Headquarters` |
| `customers.branches.type.branch` | `Branch` |
| `customers.branches.type.warehouse` | `Warehouse` |
| `customers.branches.type.office` | `Office` |
| `customers.branches.specialization` | `Specialization` |
| `customers.branches.budget` | `Budget` |
| `customers.branches.headcount` | `Headcount` |
| `customers.branches.responsiblePerson` | `Responsible Person` |
| `customers.branches.addresses` | `Addresses` |
| `customers.branches.empty` | `No branches yet.` |

### Dashboard / Metrics Keys

| Key | Default (en) |
|-----|-------------|
| `customers.360.dashboard.healthScore` | `Health Score` |
| `customers.360.dashboard.revenue` | `Revenue (12mo)` |
| `customers.360.dashboard.revenue3mo` | `Revenue (3mo)` |
| `customers.360.dashboard.activeDeals` | `Active Deals` |
| `customers.360.dashboard.lastInteraction` | `Last Interaction` |
| `customers.360.dashboard.openActivities` | `Open Activities` |
| `customers.360.dashboard.overdueActivities` | `Overdue Activities` |
| `customers.360.dashboard.contacts` | `Contacts` |
| `customers.360.dashboard.branches` | `Branches` |
| `customers.360.dashboard.trend.up` | `Trending up` |
| `customers.360.dashboard.trend.down` | `Trending down` |
| `customers.360.dashboard.trend.stable` | `Stable` |
| `customers.360.dashboard.noData` | `Not enough data to compute metrics.` |

### Tab Keys

| Key | Default (en) |
|-----|-------------|
| `customers.360.tabs.overview` | `Overview` |
| `customers.360.tabs.branches` | `Branches` |
| `customers.360.tabs.purchaseHistory` | `Purchase History` |

### Alert Keys

| Key | Default (en) |
|-----|-------------|
| `customers.360.alerts.noRecentActivity` | `No activity in the last {days} days` |
| `customers.360.alerts.overdueReorder` | `Expected reorder is overdue by {days} days` |
| `customers.360.alerts.stalledDeals` | `{count} deals have had no activity in {days}+ days` |
| `customers.360.alerts.decliningPurchases` | `Purchase volume declined {percent}% compared to previous period` |
| `customers.360.alerts.overdueActivities` | `{count} activities are overdue` |

### Purchase History Keys

| Key | Default (en) |
|-----|-------------|
| `customers.360.purchaseHistory.title` | `Purchase History` |
| `customers.360.purchaseHistory.totalOrders` | `Total Orders` |
| `customers.360.purchaseHistory.totalRevenue` | `Total Revenue` |
| `customers.360.purchaseHistory.avgOrderValue` | `Avg. Order Value` |
| `customers.360.purchaseHistory.topProducts` | `Top Products` |
| `customers.360.purchaseHistory.orderNumber` | `Order #` |
| `customers.360.purchaseHistory.status` | `Status` |
| `customers.360.purchaseHistory.amount` | `Amount` |
| `customers.360.purchaseHistory.date` | `Date` |
| `customers.360.purchaseHistory.empty` | `No purchase history found.` |
| `customers.360.purchaseHistory.noSalesModule` | `Sales module is not enabled.` |

## UI/UX

### KPI Dashboard Strip

A horizontal row of metric cards rendered above the CrudForm (Zone 1). Each card shows:
- Metric label (i18n)
- Primary value (large text)
- Trend indicator (up/down/stable arrow icon with color)
- Optional secondary value (e.g., weighted pipeline value below active deals count)

Layout: responsive grid, 4-6 cards per row on desktop, 2 per row on mobile. Cards use consistent height and padding.

Health score card uses a color-coded circular gauge:
- 80-100: green
- 60-79: yellow/amber
- 40-59: orange
- 0-39: red

### CRM Alerts Banner

Positioned above the KPI strip. Renders only when alerts exist. Uses a horizontal dismissible banner with:
- Alert icon (warning triangle for `warning`, red circle for `critical`)
- Alert message text
- Optional "View" link that navigates to the relevant tab (e.g., "View Deals" navigates to the Deals tab)
- Dismiss button (dismissal persisted in session storage per company, not server-side)

Multiple alerts stack vertically with a compact layout. Maximum 3 visible, with "Show N more" expansion.

### Branches Tab

A table/card layout within Zone 2 showing:
- Branch name, type badge, specialization
- Headcount and budget
- Responsible person (linked to person detail)
- Address count
- Active/inactive status toggle
- Row actions: Edit, Delete

"Add Branch" button opens a dialog form (CrudForm in dialog mode with `Cmd/Ctrl+Enter` submit, `Escape` cancel).

### Purchase History Tab

Three sections:
1. **Summary Cards**: Total orders, total revenue, average order value, first/last order date
2. **Top Products**: Horizontal card list of top 5 products by revenue
3. **Order History Table**: Paginated DataTable with columns: Order #, Status, Amount, Date, Line Count. Row click navigates to order detail page.

### Enhanced Contacts Tab

Existing contacts tab enhanced with:
- Decision role badge per contact (e.g., "Decision Maker", "Technical Contact", "Budget Holder")
- Branch assignment indicator
- Sort by role/branch

Decision roles are stored in `CustomerDealPersonLink.participantRole` (already exists) and extended to `CustomerPersonProfile` with a new nullable `contactRole` field for company-level roles (distinct from deal-specific roles).

### Tab Navigation Order

```
[Overview] [Contacts] [Branches] [Deals] [Purchase History] [Activities] [Notes] [Tasks] [+ injected]
```

## Events

New events for branch CRUD:

```typescript
// Added to customers events.ts
{ id: 'customers.branch.created', label: 'Branch Created', entity: 'branch', category: 'crud' },
{ id: 'customers.branch.updated', label: 'Branch Updated', entity: 'branch', category: 'crud' },
{ id: 'customers.branch.deleted', label: 'Branch Deleted', entity: 'branch', category: 'crud' },
```

Event naming follows existing convention: `module.entity.action` (singular entity, past tense action, dots as separators).

## ACL Features

New features for branch management:

```typescript
// Added to customers acl.ts
{ id: 'customers.branches.view', title: 'View branches', module: 'customers' },
{ id: 'customers.branches.manage', title: 'Manage branches', module: 'customers' },
```

Default role features in `setup.ts`:

```typescript
defaultRoleFeatures: {
  admin: ['customers.branches.view', 'customers.branches.manage'],
  employee: ['customers.branches.view'],
}
```

## Injection Spots

### New Spots

| Spot ID | Location | Purpose |
|---------|----------|---------|
| `customers.company.detail:dashboard` | KPI dashboard strip area | Third-party KPI widget injection (e.g., loyalty tier, support ticket count) |
| `customers.company.detail:alerts` | Alerts banner area | Third-party alert injection |

### Existing Spots (preserved)

All existing injection spots from SPEC-046 are preserved:
- `crud-form:customers.company:*` (CrudForm field injection)
- `detail:customers.company:header` / `:tabs` / `:footer` (page-level injection)
- `detail:customers.company:status-badges`

## Phases

### Phase 1: Branch Entity + CRUD

**Scope:** Full CRUD for `CustomerBranch` entity.

**Files to create:**

| File | Purpose |
|------|---------|
| `api/branches/route.ts` | CRUD route using `makeCrudRoute` with `indexer: { entityType: 'customers:customer_branch' }` |
| `commands/branches.ts` | Create, update, delete commands with undo support |
| `data/validators.ts` (modify) | Add `branchCreateSchema`, `branchUpdateSchema` |

**Files to modify:**

| File | Change |
|------|--------|
| `events.ts` | Add branch CRUD events |
| `acl.ts` | Add branch view/manage features |
| `setup.ts` | Add branch features to `defaultRoleFeatures` |
| `ce.ts` | Add `customer_branch` custom entity declaration |
| `i18n/en.json` (+ other locales) | Add `customers.branches.*` keys |

**Commands:**

```typescript
// commands/branches.ts
createBranch: {
  execute: validate → create entity → flush → emitCrudSideEffects
  undo: soft-delete entity → flush → emitCrudUndoSideEffects
}

updateBranch: {
  execute: validate → update fields → withAtomicFlush → emitCrudSideEffects
  undo: restore previous values → withAtomicFlush → emitCrudUndoSideEffects
}

deleteBranch: {
  execute: soft-delete → flush → emitCrudSideEffects
  undo: restore entity → flush → emitCrudUndoSideEffects
}
```

### Phase 2: Customer Dashboard KPI Strip

**Scope:** Metrics API endpoint and dashboard UI component.

**Files to create:**

| File | Purpose |
|------|---------|
| `lib/metrics/types.ts` | `CompanyMetrics`, `HealthScore` types |
| `lib/metrics/calculator.ts` | Health score computation (4 weighted components) |
| `lib/metrics/aggregator.ts` | Metrics aggregation: queries deals, activities, orders, branches, contacts |
| `api/companies/[id]/metrics/route.ts` | GET endpoint with caching |
| `components/detail/CompanyDashboardStrip.tsx` | KPI cards row component |

**Files to modify:**

| File | Change |
|------|--------|
| `backend/customers/companies-v2/[id]/page.tsx` | Add `CompanyDashboardStrip` above CrudForm |
| `i18n/en.json` (+ locales) | Add `customers.360.dashboard.*` keys |

**Caching strategy:**
- Cache key: `company-metrics:{companyId}`
- TTL: 5 minutes
- Tags: `company:{id}`, `deals:company:{id}`, `activities:company:{id}`
- Invalidation: event subscribers on `customers.deal.*`, `customers.activity.*`, `customers.company.updated`

### Phase 3: Company 360 Page Layout

**Scope:** Restructured company detail page with enhanced header, KPI strip, and new tab navigation.

**Files to create:**

| File | Purpose |
|------|---------|
| `components/detail/CompanyOverviewTab.tsx` | Overview tab: key info summary, recent activity, quick stats |
| `components/detail/BranchesSection.tsx` | Branches tab: branch list with CRUD dialog |

**Files to modify:**

| File | Change |
|------|--------|
| `backend/customers/companies-v2/[id]/page.tsx` | Add new tabs (Overview, Branches), reorder tab navigation, add alerts banner slot |
| `i18n/en.json` (+ locales) | Add `customers.360.tabs.*` keys |

**Tab implementation:**
- Each tab remains independently loaded (no CrudForm dirty state interference)
- Overview tab aggregates key data from other tabs into a summary view
- Branches tab uses `BranchesSection` with inline DataTable + dialog-based CRUD form
- Existing tabs (Contacts, Deals, Activities, Notes, Tasks) preserved with identical behavior

### Phase 4: Purchase History & Sales Integration

**Scope:** Purchase history API endpoint and UI, sales module response enricher.

**Files to create:**

| File | Purpose |
|------|---------|
| `api/companies/[id]/purchase-history/route.ts` | GET endpoint querying sales orders by company |
| `components/detail/PurchaseHistorySection.tsx` | Purchase history tab with summary cards, top products, order table |

**Sales integration approach:**

The purchase history endpoint queries sales order data through the query engine and entity index. It does NOT directly import sales module ORM entities. Instead:

1. Query the `query_index` for sales orders where `companyEntityId` matches
2. Use `findWithDecryption` for order details
3. Aggregate top products from order line items via SQL queries scoped by `organizationId` and `tenantId`

If the sales module is not enabled (no sales entities registered), the endpoint returns empty results with `summary: null`.

**Files to modify:**

| File | Change |
|------|--------|
| `backend/customers/companies-v2/[id]/page.tsx` | Add Purchase History tab |
| `i18n/en.json` (+ locales) | Add `customers.360.purchaseHistory.*` keys |

### Phase 5: CRM Alerts System

**Scope:** Alert rule evaluation and banner UI.

**Alert rules:**

| Rule ID | Severity | Condition | Default Threshold |
|---------|----------|-----------|-------------------|
| `no-recent-activity` | warning | No activity logged in N days | 30 days |
| `overdue-reorder` | warning | Expected reorder date passed (based on average order frequency) | Auto-calculated |
| `stalled-deals` | warning | Active deals with no activity in N days | 14 days |
| `declining-purchases` | critical | Purchase volume decreased >N% vs. previous period | 30% decline |
| `overdue-activities` | critical | N+ activities past due date | 1+ overdue |

**Files to create:**

| File | Purpose |
|------|---------|
| `lib/alerts/types.ts` | `CrmAlert`, `AlertRule`, `CrmAlertSeverity` types |
| `lib/alerts/evaluator.ts` | Alert rule evaluation against metrics data |
| `components/detail/CompanyAlertsBanner.tsx` | Alert banner component |

**Files to modify:**

| File | Change |
|------|--------|
| `backend/customers/companies-v2/[id]/page.tsx` | Add `CompanyAlertsBanner` above KPI strip |
| `i18n/en.json` (+ locales) | Add `customers.360.alerts.*` keys |

**Implementation notes:**
- Alerts are computed client-side from the metrics API response (no separate alerts endpoint)
- Alert dismissal stored in `sessionStorage` keyed by `company:{id}:dismissed-alerts`
- Alert evaluation runs in a `useMemo` hook dependent on the metrics query result

### Phase 6: Search & Analytics Updates

**Scope:** Index `CustomerBranch` in search, add branch-related analytics.

**Files to modify:**

| File | Change |
|------|--------|
| `search.ts` | Add `CustomerBranch` to search configuration with `fieldPolicy` for `name`, `specialization`, `branchType` |
| `analytics.ts` | Add branch count and distribution analytics |

**Search configuration:**

```typescript
// Added to search.ts
{
  entityType: 'customers:customer_branch',
  entity: CustomerBranch,
  fieldPolicy: {
    name: { weight: 10, searchable: true },
    specialization: { weight: 5, searchable: true },
    branchType: { weight: 3, searchable: true },
  },
  formatResult: (branch) => ({
    title: branch.name,
    subtitle: branch.branchType ?? 'Branch',
    icon: 'Building2',
  }),
}
```

## Migration & Backward Compatibility

### No Breaking Changes

All changes in this spec are additive:

| Change | Type | Impact |
|--------|------|--------|
| Branch CRUD API routes | New endpoints | No existing routes modified |
| Metrics API endpoint | New endpoint | No existing routes modified |
| Purchase history endpoint | New endpoint | No existing routes modified |
| New events (`customers.branch.*`) | Additive | No existing events renamed or removed |
| New ACL features (`customers.branches.*`) | Additive | No existing features renamed or removed |
| New injection spots | Additive | No existing spots renamed or removed |
| New i18n keys | Additive | No existing keys renamed or removed |
| Enhanced tab navigation | Additive tabs | Existing tabs preserved with identical behavior |
| KPI strip and alerts banner | New UI sections | Rendered above existing CrudForm; no existing layout disturbed |

### Backward Compatibility Contract Compliance

| Surface | Status | Notes |
|---------|--------|-------|
| Auto-discovery file conventions | Compliant | New files follow existing conventions |
| Type definitions | Compliant | New types only; no existing types modified |
| Function signatures | Compliant | No existing functions modified |
| Import paths | Compliant | No existing imports moved |
| Event IDs | Compliant | New events only; format matches existing pattern |
| Widget injection spot IDs | Compliant | New spots only; existing spots preserved |
| API route URLs | Compliant | New routes only; existing routes untouched |
| Database schema | Compliant | `CustomerBranch` entity and `CustomerAddress.branchId` already exist; no new migrations |
| ACL feature IDs | Compliant | New features only |

## Integration Test Coverage

### TC-CRM-360-001: Branch CRUD

```
Setup: createCompanyFixture via API

Create branch:
  POST /api/customers/branches
  Body: { companyEntityId, name: "HQ", branchType: "headquarters" }
  Verify: 201, branch returned with correct fields

List branches:
  GET /api/customers/branches?companyEntityId={id}
  Verify: array contains created branch

Update branch:
  PUT /api/customers/branches
  Body: { id: branchId, name: "Main HQ", headcount: 50 }
  Verify: 200, updated fields returned

Delete branch:
  DELETE /api/customers/branches
  Body: { id: branchId }
  Verify: 200
  GET /api/customers/branches?companyEntityId={id}
  Verify: branch no longer in list

Cleanup: deleteEntityIfExists
```

### TC-CRM-360-002: Metrics Endpoint

```
Setup: createCompanyFixture, createDealFixture (linked to company), createActivityFixture

GET /api/customers/companies/{id}/metrics
Verify:
  - healthScore.value is number 0-100
  - deals.activeCount >= 1
  - activities.lastInteractionAt is valid ISO-8601 or null
  - contacts.totalCount >= 0
  - branches.totalCount >= 0

Cleanup: delete fixtures
```

### TC-CRM-360-003: Purchase History Endpoint

```
Setup: createCompanyFixture, createOrderFixture (linked to company, if sales module enabled)

GET /api/customers/companies/{id}/purchase-history
Verify:
  - items is array
  - pagination.totalItems >= 0
  - If sales module enabled and order exists: items.length >= 1, summary.totalOrders >= 1

Cleanup: delete fixtures
```

### TC-CRM-360-004: Company Detail Page Tabs

```
Setup: createCompanyFixture, createBranchFixture, login

Navigate: /backend/customers/companies-v2/{id}

Verify KPI strip renders:
  - Health Score card visible
  - Revenue card visible

Verify tabs:
  - Overview tab: renders summary content
  - Branches tab: shows created branch
  - Contacts tab: renders (existing)
  - Deals tab: renders (existing)
  - Purchase History tab: renders table or empty state

Cleanup: delete fixtures
```

## Risks & Impact Review

### Performance Risks

#### Metrics Aggregation Queries

- **Scenario**: Metrics endpoint queries deals, activities, orders, branches, contacts in parallel. For a company with thousands of interactions, this is expensive.
- **Severity**: Medium
- **Mitigation**: 5-minute cache with tag-based invalidation. All queries are indexed and tenant-scoped. `Promise.all` for parallel execution.
- **Residual risk**: First request after cache invalidation is slower. Acceptable for a 5-minute cache window.

#### Health Score Trend Computation

- **Scenario**: Trend calculation requires comparing current score with historical score, which means running the algorithm twice with different date ranges.
- **Severity**: Low
- **Mitigation**: Historical score uses a simplified calculation (fewer queries, broader date buckets). Trend defaults to `stable` if historical data is insufficient.
- **Residual risk**: Trend accuracy for new companies is limited. Acceptable.

### Data Integrity Risks

#### Sales Module Dependency

- **Scenario**: Purchase history endpoint depends on sales module being enabled. If disabled mid-session, cached data may be stale.
- **Severity**: Low
- **Mitigation**: Endpoint checks module availability at request time. Returns empty results if sales module is not enabled. Cache is tagged with module-specific keys.
- **Residual risk**: None significant.

#### Orphaned Branch References

- **Scenario**: A branch is deleted but addresses still reference it via `branchId`.
- **Severity**: Low
- **Mitigation**: Branch soft-delete preserves the record. The branch CRUD delete command clears `branchId` on linked addresses as part of the delete operation. UI shows "Unlinked" for addresses referencing deleted branches.
- **Residual risk**: None.

### Tenant & Data Isolation Risks

- All new endpoints filter by `organizationId` and `tenantId`
- Branch CRUD inherits tenant scoping from `makeCrudRoute`
- Metrics aggregation queries are scoped by tenant via existing helpers
- No shared caches or global state introduced (cache keys include tenant scope)

### Cascading Failures

- **Branch events**: New subscribers may be added by third-party modules. If a subscriber fails, it does not block the CRUD operation (persistent subscribers retry).
- **Metrics endpoint failure**: UI shows "Unable to load metrics" with a retry button. Does not block the rest of the page.
- **Purchase history failure**: Tab shows error state with retry. Does not affect other tabs.

### Risk Register

| Risk | Severity | Affected Area | Mitigation | Residual Risk |
|------|----------|---------------|------------|---------------|
| Metrics endpoint slow on first load | Medium | KPI dashboard | 5-minute cache, parallel queries, indexed tables | First-load latency after cache expiry |
| Sales module not enabled | Low | Purchase history | Graceful empty state, no error thrown | Feature appears empty until module enabled |
| Branch deletion orphans addresses | Low | Data integrity | Clear `branchId` on linked addresses during delete | None |
| Alert false positives | Low | CRM alerts | Thresholds based on industry best practices; future: tenant-configurable thresholds | Some tenants may see irrelevant alerts initially |
| Health score gaming | Low | KPI strip | Score is read-only, computed from real data. No user input affects score directly | None |

## Final Compliance Report

### AGENTS.md Files Reviewed

- `AGENTS.md` (root)
- `packages/core/AGENTS.md`
- `packages/core/src/modules/customers/AGENTS.md`
- `packages/ui/AGENTS.md`
- `packages/shared/AGENTS.md`
- `packages/cache/AGENTS.md`
- `packages/search/AGENTS.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|-------------|------|--------|-------|
| root AGENTS.md | No direct ORM relationships between modules | Compliant | Purchase history uses query engine, not direct sales ORM imports |
| root AGENTS.md | Filter by organization_id | Compliant | All queries scoped by `organizationId` and `tenantId` |
| root AGENTS.md | Validate all inputs with zod | Compliant | Branch create/update validated with zod schemas in `data/validators.ts` |
| root AGENTS.md | Use `findWithDecryption` instead of `em.find` | Compliant | All entity queries use decryption-aware helpers |
| root AGENTS.md | Use `apiCall`/`apiCallOrThrow` — never raw fetch | Compliant | Client components use `apiCall` via `useQuery` |
| root AGENTS.md | i18n: `useT()` client-side, no hardcoded strings | Compliant | All UI strings use `useT()` with namespaced keys |
| root AGENTS.md | Every dialog: Cmd/Ctrl+Enter submit, Escape cancel | Compliant | Branch create/edit dialog follows pattern |
| root AGENTS.md | pageSize at or below 100 | Compliant | All paginated endpoints cap at 100 |
| root AGENTS.md | Event IDs: module.entity.action | Compliant | `customers.branch.created/updated/deleted` |
| packages/core/AGENTS.md | API routes MUST export openApi | Compliant | All new routes export `openApi` |
| packages/core/AGENTS.md | CRUD routes use makeCrudRoute with indexer | Compliant | Branch route uses `indexer: { entityType: 'customers:customer_branch' }` |
| packages/core/AGENTS.md | Commands with undo support | Compliant | Branch commands implement execute + undo |
| packages/core/AGENTS.md | Use withAtomicFlush for multi-phase mutations | Compliant | Branch update command uses `withAtomicFlush` |
| packages/core/AGENTS.md | setup.ts declares defaultRoleFeatures | Compliant | Branch features added to setup.ts |
| customers AGENTS.md | MUST use findWithDecryption | Compliant | All entity queries use decryption helpers |

### Internal Consistency Check

| Check | Status | Notes |
|-------|--------|-------|
| Data models match API contracts | Pass | `CompanyMetrics` type matches metrics endpoint response |
| API contracts match UI/UX section | Pass | KPI strip renders fields from metrics response |
| Risks cover all write operations | Pass | Branch CRUD covers create/update/delete risks |
| Commands defined for all mutations | Pass | Branch create/update/delete commands specified |
| Events declared for all mutations | Pass | Branch CRUD events declared |
| ACL features cover all access paths | Pass | Branch view/manage features gated |
| Cache strategy covers read APIs | Pass | Metrics endpoint cached with tag-based invalidation |

### Non-Compliant Items

None.

### Verdict

**Fully compliant** — Approved for implementation.

## Changelog

| Date | Change |
|------|--------|
| 2026-03-08 | Initial spec created |
