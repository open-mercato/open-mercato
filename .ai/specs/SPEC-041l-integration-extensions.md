# SPEC-041l — Integration Extensions

| Field | Value |
|-------|-------|
| **Parent** | [SPEC-041 — UMES](./SPEC-041-2026-02-24-universal-module-extension-system.md) |
| **Phase** | L (PR 12) |
| **Branch** | `feat/umes-integration-extensions` |
| **Depends On** | Phase A (Foundation), Phase C (Events + DOM Bridge), Phase D (Response Enrichers), Phase G (CrudForm Fields) |
| **Status** | Draft |

## Goal

Add UMES extension primitives specifically needed by integration modules: multi-step wizard widgets, status badge injection, and a standardized external ID mapping pattern. These close the remaining gaps identified in the integration feasibility analysis across 20 platforms.

---

## Scope

### 1. Multi-Step Wizard Widget

Integration setup flows (OAuth authorization, data sync configuration, field mapping) often require sequential steps that cannot be expressed as a flat CrudForm. The `InjectionWizardWidget` provides a multi-step form pattern within the UMES framework.

#### Contract

```typescript
// packages/shared/src/modules/widgets/injection.ts (addition)

type InjectionWizardWidget = {
  metadata: { id: string; title?: string; features?: string[] }
  kind: 'wizard'
  steps: WizardStep[]
  onComplete?: (allStepData: Record<string, unknown>, context: InjectionContext) => Promise<void>
  eventHandlers?: WidgetInjectionEventHandlers<any, any>
}

interface WizardStep {
  id: string
  label: string                 // i18n key
  description?: string          // i18n key — shown below the step title
  fields?: InjectionFieldDefinition[]   // Reuse existing field types (including custom, dynamic options)
  customComponent?: React.LazyExoticComponent<React.ComponentType<WizardStepProps>>
  validate?: (data: Record<string, unknown>, context: InjectionContext) => Promise<WizardStepValidation>
}

interface WizardStepProps {
  data: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  context: InjectionContext
  stepIndex: number
  totalSteps: number
}

interface WizardStepValidation {
  ok: boolean
  message?: string
  fieldErrors?: Record<string, string>
}
```

#### `InjectionWizard` Component

```typescript
// packages/ui/src/backend/injection/InjectionWizard.tsx

interface InjectionWizardProps {
  widget: InjectionWizardWidget
  context: InjectionContext
  onClose?: () => void
}
```

Renders a step-by-step UI with:
- Step indicator (numbered stepper bar)
- Back / Next / Complete buttons
- Per-step validation before advancing
- Each step can use declarative `fields` (reuses `InjectedField`) or a full `customComponent`
- Step data accumulated across all steps, passed to `onComplete`
- `Escape` to cancel, no `Cmd+Enter` shortcut (multi-step, not single-submit)

#### Example: Integration Setup Wizard

```typescript
// sync_medusa/widgets/injection/setup-wizard/widget.ts

export default {
  metadata: {
    id: 'sync_medusa.injection.setup-wizard',
    title: 'MedusaJS Setup',
    features: ['data_sync.configure'],
  },
  kind: 'wizard',
  steps: [
    {
      id: 'credentials',
      label: 'sync_medusa.wizard.credentials',
      fields: [
        { id: 'apiUrl', label: 'sync_medusa.field.apiUrl', type: 'text', group: 'credentials' },
        { id: 'apiKey', label: 'sync_medusa.field.apiKey', type: 'text', group: 'credentials' },
      ],
      validate: async (data) => {
        if (!data.apiUrl || !data.apiKey) return { ok: false, message: 'API URL and key required' }
        // Test connection
        const result = await testConnection(data.apiUrl as string, data.apiKey as string)
        return result.ok ? { ok: true } : { ok: false, message: result.error }
      },
    },
    {
      id: 'scope',
      label: 'sync_medusa.wizard.scope',
      fields: [
        { id: 'syncProducts', label: 'sync_medusa.field.syncProducts', type: 'boolean', group: 'scope' },
        { id: 'syncCustomers', label: 'sync_medusa.field.syncCustomers', type: 'boolean', group: 'scope' },
        { id: 'syncOrders', label: 'sync_medusa.field.syncOrders', type: 'boolean', group: 'scope' },
        { id: 'syncInventory', label: 'sync_medusa.field.syncInventory', type: 'boolean', group: 'scope' },
      ],
    },
    {
      id: 'mapping',
      label: 'sync_medusa.wizard.fieldMapping',
      customComponent: lazy(() => import('./FieldMappingStep')),
    },
    {
      id: 'schedule',
      label: 'sync_medusa.wizard.schedule',
      fields: [
        {
          id: 'syncInterval', label: 'sync_medusa.field.interval', type: 'select',
          options: [
            { value: '15m', label: 'Every 15 minutes' },
            { value: '1h', label: 'Every hour' },
            { value: '6h', label: 'Every 6 hours' },
            { value: '24h', label: 'Daily' },
          ],
          group: 'schedule',
        },
      ],
    },
  ],
  onComplete: async (data, context) => {
    await apiCallOrThrow('/api/data-sync/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        integrationId: 'sync_medusa',
        credentials: { apiUrl: data.apiUrl, apiKey: data.apiKey },
        scope: { products: data.syncProducts, customers: data.syncCustomers, orders: data.syncOrders, inventory: data.syncInventory },
        mapping: data.fieldMapping,
        schedule: data.syncInterval,
        organizationId: context.organizationId,
        tenantId: context.tenantId,
      }),
    })
  },
} satisfies InjectionWizardWidget
```

#### Injection Table Entry

```typescript
// sync_medusa/widgets/injection-table.ts
'integrations.detail:tabs': {
  widgetId: 'sync_medusa.injection.setup-wizard',
  kind: 'wizard',
  priority: 100,
},
```

---

### 2. Status Badge Injection

Integration modules need persistent health/status indicators visible across the application — not just on the integration detail page. The `InjectionStatusBadgeWidget` provides this.

#### Contract

Defined in SPEC-041a (Foundation), the contract is:

```typescript
type InjectionStatusBadgeWidget = {
  metadata: { id: string; features?: string[] }
  kind: 'status-badge'
  badge: {
    label: string
    statusLoader: (context: StatusBadgeContext) => Promise<StatusBadgeResult>
    href?: string
    pollInterval?: number  // seconds, default: 60
  }
}
```

#### Injection Spots

Three new spots (defined in SPEC-041a):
- `global:sidebar:status-badges` — sidebar footer, always visible
- `global:header:status-indicators` — top bar, compact badges
- `detail:<entityId>:status-badges` — detail page header

#### `StatusBadgeRenderer` Component

```typescript
// packages/ui/src/backend/injection/StatusBadgeRenderer.tsx

function StatusBadgeRenderer({ widget }: { widget: InjectionStatusBadgeWidget }) {
  const [result, setResult] = useState<StatusBadgeResult>({ status: 'unknown' })

  useEffect(() => {
    const load = () => widget.badge.statusLoader(context).then(setResult).catch(() => setResult({ status: 'unknown' }))
    load()
    const interval = setInterval(load, (widget.badge.pollInterval ?? 60) * 1000)
    return () => clearInterval(interval)
  }, [widget.badge.pollInterval])

  return (
    <a href={widget.badge.href}>
      <StatusDot status={result.status} />
      <span>{t(widget.badge.label)}</span>
      {result.count != null && <Badge>{result.count}</Badge>}
      {result.tooltip && <Tooltip>{result.tooltip}</Tooltip>}
    </a>
  )
}
```

Visual rendering:
- `healthy` → green dot
- `warning` → yellow dot
- `error` → red dot
- `unknown` → gray dot

#### Example: Integration Health Badge

```typescript
// sync_medusa/widgets/injection/health-badge/widget.ts

export default {
  metadata: {
    id: 'sync_medusa.injection.health-badge',
    features: ['data_sync.view'],
  },
  kind: 'status-badge',
  badge: {
    label: 'sync_medusa.badge.syncHealth',
    href: '/backend/integrations/bundle/sync_medusa',
    pollInterval: 120,
    statusLoader: async (context) => {
      const res = await apiCallOrThrow('/api/integrations/sync_medusa/health', {
        headers: { 'x-organization-id': context.organizationId },
      })
      return {
        status: res.health.status,
        tooltip: res.health.message,
        count: res.health.errorCount > 0 ? res.health.errorCount : undefined,
      }
    },
  },
} satisfies InjectionStatusBadgeWidget
```

---

### 3. External ID Mapping Display Pattern

Every integration maps external IDs (Shopify customer ID, HubSpot contact ID, Stripe customer ID) to internal entity IDs. SPEC-045b defines `SyncExternalIdMapping` for storage. This section standardizes how external ID mappings are **displayed** in entity detail pages via UMES.

#### Standard Enricher Namespace

```typescript
// Enricher output namespace for external IDs
interface ExternalIdEnrichment {
  _integrations: {
    [integrationId: string]: {
      externalId: string
      externalUrl?: string     // Deep link to record in external system
      lastSyncedAt?: string    // ISO 8601
      syncStatus: 'synced' | 'pending' | 'error' | 'not_synced'
    }
  }
}
```

#### Built-In Enricher

The `integrations` core module provides a generic enricher that reads from `SyncExternalIdMapping` and attaches `_integrations` to any entity that has external mappings:

```typescript
// packages/core/src/modules/integrations/data/enrichers.ts

export const enrichers: ResponseEnricher[] = [
  {
    id: 'integrations.external-id-mapping',
    targetEntity: '*',  // Matches all entities — filtered at runtime
    features: ['integrations.view'],
    priority: 10,
    timeout: 500,
    critical: false,
    fallback: {},

    async enrichOne(record, ctx) {
      const mappings = await ctx.em.find('SyncExternalIdMapping', {
        internalEntityType: ctx.targetEntity,
        internalEntityId: record.id,
        organizationId: ctx.organizationId,
      })
      if (mappings.length === 0) return record

      const integrationData: Record<string, unknown> = {}
      for (const mapping of mappings) {
        const definition = getIntegration(mapping.integrationId)
        integrationData[mapping.integrationId] = {
          externalId: mapping.externalId,
          externalUrl: definition?.buildExternalUrl?.(mapping.externalId),
          lastSyncedAt: mapping.lastSyncedAt?.toISOString(),
          syncStatus: mapping.syncStatus,
        }
      }

      return { ...record, _integrations: integrationData }
    },

    async enrichMany(records, ctx) {
      const recordIds = records.map(r => r.id)
      const allMappings = await ctx.em.find('SyncExternalIdMapping', {
        internalEntityType: ctx.targetEntity,
        internalEntityId: { $in: recordIds },
        organizationId: ctx.organizationId,
      })

      const mappingsByRecord = new Map<string, any[]>()
      for (const mapping of allMappings) {
        const list = mappingsByRecord.get(mapping.internalEntityId) ?? []
        list.push(mapping)
        mappingsByRecord.set(mapping.internalEntityId, list)
      }

      return records.map(record => {
        const mappings = mappingsByRecord.get(record.id) ?? []
        if (mappings.length === 0) return record

        const integrationData: Record<string, unknown> = {}
        for (const mapping of mappings) {
          const definition = getIntegration(mapping.integrationId)
          integrationData[mapping.integrationId] = {
            externalId: mapping.externalId,
            externalUrl: definition?.buildExternalUrl?.(mapping.externalId),
            lastSyncedAt: mapping.lastSyncedAt?.toISOString(),
            syncStatus: mapping.syncStatus,
          }
        }

        return { ...record, _integrations: integrationData }
      })
    },
  },
]
```

#### `IntegrationDefinition` Extension

Add optional `buildExternalUrl` to integration definitions for deep links:

```typescript
interface IntegrationDefinition {
  // ... existing fields ...

  /** Build a URL to the record in the external system. Used in detail page badges. */
  buildExternalUrl?: (externalId: string) => string
}
```

Examples:
```typescript
// gateway_stripe/integration.ts
buildExternalUrl: (id) => `https://dashboard.stripe.com/customers/${id}`

// sync_shopify/integration.ts
buildExternalUrl: (id) => `https://${shopDomain}/admin/customers/${id}`
```

#### Detail Page Display — Injected Section

A built-in widget renders the `_integrations` data on any entity detail page:

```typescript
// integrations/widgets/injection/external-ids/widget.client.tsx
"use client"

export default function ExternalIdsWidget({ context, data }: WidgetProps) {
  const integrations = data?._integrations as Record<string, any> | undefined
  if (!integrations || Object.keys(integrations).length === 0) return null

  return (
    <Card title={t('integrations.externalIds.title')}>
      {Object.entries(integrations).map(([integrationId, mapping]) => (
        <div key={integrationId}>
          <IntegrationIcon id={integrationId} />
          <span>{getIntegrationTitle(integrationId)}</span>
          <code>{mapping.externalId}</code>
          {mapping.externalUrl && (
            <a href={mapping.externalUrl} target="_blank" rel="noopener">
              <ExternalLinkIcon />
            </a>
          )}
          <SyncStatusBadge status={mapping.syncStatus} lastSynced={mapping.lastSyncedAt} />
        </div>
      ))}
    </Card>
  )
}
```

This widget auto-appears on any entity detail page where `_integrations` is present — no per-integration configuration needed.

---

## Integration Tests

### TC-UMES-L01: Wizard widget renders all steps and advances correctly

**Type**: UI (Playwright)

**Steps**:
1. Navigate to integration detail page with wizard widget
2. Verify step 1 is shown with its fields
3. Fill in step 1 fields
4. Click "Next"
5. Verify step 2 is shown
6. Complete all steps and click "Complete"

**Expected**: Wizard progresses through all steps. `onComplete` is called with accumulated data from all steps.

### TC-UMES-L02: Wizard step validation prevents advancement on invalid data

**Type**: UI (Playwright)

**Steps**:
1. Navigate to wizard widget
2. Leave required fields empty on step 1
3. Click "Next"

**Expected**: Validation error shown. Cannot advance to step 2.

### TC-UMES-L03: Status badge renders in sidebar with correct status

**Type**: UI (Playwright)

**Steps**:
1. Navigate to any backend page
2. Look for status badge in sidebar footer area

**Expected**: Badge shows with correct status (healthy/warning/error), label, and optional count.

### TC-UMES-L04: Status badge polls and updates status

**Type**: UI (Playwright)

**Steps**:
1. Navigate to page with status badge
2. Change backend state (e.g., disconnect integration)
3. Wait for poll interval
4. Verify badge status updates

**Expected**: Badge status transitions from "healthy" to "error" after poll refresh.

### TC-UMES-L05: External ID mapping appears on entity detail page

**Type**: API+UI (Playwright)

**Steps**:
1. Create an entity (e.g., customer)
2. Create a `SyncExternalIdMapping` record linking entity to external ID
3. GET entity via API — verify `_integrations` namespace present
4. Navigate to entity detail page — verify external ID section renders

**Expected**: External IDs shown with integration name, external ID, deep link, and sync status.

### TC-UMES-L06: External ID enricher uses `enrichMany` for list endpoints

**Type**: API (Playwright)

**Steps**:
1. Create 5 entities with external ID mappings
2. GET list endpoint
3. Verify all 5 have `_integrations` data
4. Verify performance (enricher stage < 200ms)

**Expected**: All entities enriched with external ID data. Batch query used (N+1 prevention).

---

## Files Touched

| Action | File |
|--------|------|
| **NEW** | `packages/ui/src/backend/injection/InjectionWizard.tsx` |
| **NEW** | `packages/ui/src/backend/injection/StatusBadgeRenderer.tsx` |
| **NEW** | `packages/core/src/modules/integrations/data/enrichers.ts` |
| **NEW** | `packages/core/src/modules/integrations/widgets/injection/external-ids/widget.client.tsx` |
| **MODIFY** | `packages/shared/src/modules/widgets/injection.ts` (add wizard + status badge types) |
| **MODIFY** | `packages/shared/src/modules/integrations/types.ts` (add `buildExternalUrl`) |
| **MODIFY** | `packages/ui/src/backend/AppShell.tsx` (render sidebar status badges) |
| **MODIFY** | `packages/ui/src/backend/injection/InjectionSpot.tsx` (handle wizard + status-badge kinds) |
| **MODIFY** | `packages/core/src/modules/integrations/widgets/injection-table.ts` |

**Estimated scope**: Medium — new components + one enricher + injection table wiring

---

## Backward Compatibility

- Wizard widget is a new `kind` — existing widgets unchanged
- Status badge is a new `kind` — existing injection spots unchanged
- New injection spots (`global:sidebar:status-badges`, etc.) are additive
- External ID enricher targets `*` but only adds data when mappings exist — zero impact on entities without mappings
- `buildExternalUrl` is optional on `IntegrationDefinition` — existing integrations unaffected

---

## Implementation Status

| Section | Status | Date | Notes |
|---------|--------|------|-------|
| 1. Multi-Step Wizard Widget | Done | 2026-03-01 | `InjectionWizard.tsx` + `WizardInjectionSpot.tsx` |
| 2. Status Badge Injection | Done | 2026-03-01 | `StatusBadgeRenderer.tsx` + `StatusBadgeInjectionSpot.tsx` + AppShell wired |
| 3. External ID Mapping Display | Done | 2026-03-01 | Types, entity, enricher, widget, injection-table |
| Integration Tests | Not Started | — | Requires running app instance |

### Detailed Progress
- [x] `InjectionWizard.tsx` — Step indicator, Back/Next/Complete, per-step validation, field + custom component support
- [x] `StatusBadgeRenderer.tsx` — Status polling, color-coded dots, count badge, tooltip, deep link
- [x] `StatusBadgeInjectionSpot.tsx` — Loads data widgets, filters to status-badge kind, renders
- [x] `WizardInjectionSpot.tsx` — Loads data widgets, filters to wizard kind, renders
- [x] `AppShell.tsx` — Sidebar + header status badge spots use `StatusBadgeInjectionSpot`
- [x] `packages/shared/src/modules/integrations/types.ts` — `IntegrationDefinition`, registry, `buildExternalUrl`
- [x] `packages/core/src/modules/integrations/data/entities.ts` — `SyncExternalIdMapping` entity
- [x] `packages/core/src/modules/integrations/data/enrichers.ts` — External ID enricher (batch + single)
- [x] `packages/core/src/modules/integrations/widgets/injection/external-ids/widget.client.tsx` — ExternalIds widget
- [x] `packages/core/src/modules/integrations/widgets/injection-table.ts` — Wildcard detail sidebar mapping
- [x] `packages/core/src/modules/integrations/acl.ts` — `integrations.view`, `integrations.manage`
- [x] `packages/core/src/modules/integrations/setup.ts` — Default role features
- [x] `packages/core/src/modules/integrations/index.ts` — Module metadata
- [x] Build verification — all 14 packages build successfully

### Implementation Notes
- Types (`InjectionWizardWidget`, `InjectionStatusBadgeWidget`, etc.) were already defined in `injection.ts` from Phase A
- Spot IDs (`global:sidebar:status-badges`, `global:header:status-indicators`) were already defined in `spotIds.ts`
- Instead of modifying the generic `InjectionSpot.tsx`, created dedicated `StatusBadgeInjectionSpot` and `WizardInjectionSpot` components that use `useInjectionDataWidgets` to load and filter data widgets by kind — cleaner separation of concerns
- The `SyncExternalIdMapping` entity will need a migration generated via `yarn db:generate` when the module is enabled
