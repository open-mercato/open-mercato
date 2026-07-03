# Step 5 — i18n and tests

## 5.1 i18n

```typescript
// i18n/en.ts
export default {
  '<module_id>': {
    title: '<Provider>',
    description: '<one-line description>',
    credentials: {
      apiKey: 'API Key',
      webhookSecret: 'Webhook Signing Secret',
    },
    status: {
      connected: 'Connected',
      disconnected: 'Disconnected',
    },
    errors: {
      invalidCredentials: 'Invalid credentials',
      connectionFailed: 'Connection to <Provider> failed',
    },
  },
}
```

**MUST**: Never hard-code user-facing strings. Use `useT()` client-side and
`resolveTranslations()` server-side. Prefix purely internal `throw new Error(...)` messages with
`[internal]`.

## 5.2 Unit tests

Place under `src/modules/<module_id>/__tests__/`:

```typescript
// __tests__/status-map.test.ts
import { describe, it, expect } from 'vitest'
import { mapProviderStatus } from '../lib/status-map'

describe('status-map', () => {
  it('maps known statuses', () => {
    expect(mapProviderStatus('provider_paid')).toBe('captured')
  })
  it('returns unknown for unmapped statuses', () => {
    expect(mapProviderStatus('something_new')).toBe('unknown')
  })
})
```

**MUST test**:
- Status mapping (all provider statuses → unified statuses, plus the `'unknown'` fallback)
- Webhook signature verification (valid, invalid, expired)
- Client factory (missing credentials throw)
- Adapter methods (mock the SDK calls)

## 5.3 Integration tests

Place in a `__integration__/` directory following the `om-integration-tests` skill pattern.
Integration tests MUST be self-contained: create fixtures in setup, clean them up in teardown,
and never rely on seeded/demo data.

| Test Case | Description |
|-----------|-------------|
| Create session / rate / sync | Happy path for the primary adapter method |
| Webhook verification (valid) | Valid signature accepted |
| Webhook verification (invalid) | Invalid signature rejected |
| Health check (healthy) | Valid credentials return healthy |
| Health check (unhealthy) | Invalid credentials return unhealthy |
| Credential validation | Missing required fields rejected |
| Status mapping completeness | All known provider statuses mapped |

Proceed to `step-6-validation.md`.
