# API Interceptors

**Purpose**: Hook into API routes to validate, transform, or enrich requests/responses without modifying the route.

**File**: `src/modules/<your-module>/api/interceptors.ts`

## Template

```typescript
import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'

const interceptors: ApiInterceptor[] = [
  {
    id: '<your-module>.validate-<action>',
    targetRoute: '<target-module>/<entities>',  // e.g., 'customers/people'
    methods: ['POST', 'PUT'],
    priority: 50,  // Lower = earlier execution
    timeoutMs: 5000,

    async before(request, context) {
      // Validate request
      const value = request.body?.someField
      if (!value) {
        return { ok: false, statusCode: 422, message: 'someField is required' }
      }
      // Optionally rewrite body or query
      return { ok: true, body: { ...request.body, normalizedField: String(value).trim() } }
    },

    async after(request, response, context) {
      // Optionally enrich response
      return {
        merge: {
          _<your-module>: { processedAt: Date.now() },
        },
      }
    },
  },
]

export { interceptors }
```

## Rules

- `before` hook: return `{ ok: false, message }` to reject — never throw errors
- `after` hook: use `merge` to add fields, `replace` to swap entire response body
- Prefer exact `targetRoute` over wildcards (`*`) — wildcards match too broadly
- For filtering: rewrite `query.ids` (comma-separated UUIDs) — never post-filter response arrays
- Set `features` for permission-gated interceptors
- Interceptors run BEFORE sync event subscribers and mutation guards in the pipeline
