# Event Subscribers

**Purpose**: React to domain events emitted by other modules (e.g., after entity creation).

**File**: `src/modules/<your-module>/subscribers/<subscriber-name>.ts`

## Template

```typescript
export const metadata = {
  event: 'customers.person.created',  // module.entity.action (past tense)
  persistent: true,  // true = survives server restart (uses queue)
  id: '<your-module>:on-customer-created',
}

export default async function handler(payload: Record<string, unknown>, ctx: unknown) {
  const { resourceId, organizationId, tenantId } = payload as {
    resourceId: string
    organizationId: string
    tenantId: string
  }

  // Perform side effects
  // Examples: create related records, send notifications, sync external systems
}
```

## Sync Subscribers (Before-Event)

For subscribers that need to run **before** a mutation completes and can block it:

```typescript
export const metadata = {
  event: 'customers.person.creating',  // .creating = before event (present tense)
  persistent: false,
  id: '<your-module>:validate-customer-create',
  sync: true,      // Run synchronously in request pipeline
  priority: 50,    // Lower = earlier
}

export default async function handler(payload: Record<string, unknown>) {
  const data = payload as { mutationPayload?: Record<string, unknown> }

  if (someConditionFails(data.mutationPayload)) {
    return { ok: false, status: 422, message: 'Cannot create: reason' }
  }

  // Optionally modify the mutation data
  return { ok: true, modifiedPayload: { ...data.mutationPayload, enrichedField: 'value' } }
}
```

## Event Naming Convention

| Event | Timing | Can Block? |
|-------|--------|-----------|
| `module.entity.creating` | Before create | Yes (sync only) |
| `module.entity.created` | After create | No |
| `module.entity.updating` | Before update | Yes (sync only) |
| `module.entity.updated` | After update | No |
| `module.entity.deleting` | Before delete | Yes (sync only) |
| `module.entity.deleted` | After delete | No |

## Rules

- After-events (`.created`, `.updated`, `.deleted`) cannot block — they are fire-and-forget
- Before-events (`.creating`, `.updating`, `.deleting`) require `sync: true` to block mutations
- Subscribers MUST be idempotent — events may be delivered more than once
- Use `persistent: true` for critical side effects that must survive restarts
