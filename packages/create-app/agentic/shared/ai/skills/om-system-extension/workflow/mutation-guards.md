# Mutation Guards

**Purpose**: Block or validate mutations at the entity level before database persistence. Runs after interceptors and before ORM flush.

**File**: `src/modules/<your-module>/data/guards.ts`

## Template

```typescript
import type { MutationGuard, MutationGuardInput, MutationGuardResult } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

const guard: MutationGuard = {
  id: '<your-module>.<guard-name>',
  targetEntity: '<target-module>.<entity>',  // or '*' for all entities
  operations: ['create', 'update'],  // create | update | delete
  priority: 50,  // Lower = earlier execution

  async validate(input: MutationGuardInput): Promise<MutationGuardResult> {
    // input.resourceId is null for create operations
    // input.mutationPayload contains the data being saved

    if (someConditionFails) {
      return {
        ok: false,
        status: 422,
        message: 'Validation failed: reason',
      }
    }

    // Optionally transform payload
    return {
      ok: true,
      modifiedPayload: { ...input.mutationPayload, normalizedField: 'value' },
      shouldRunAfterSuccess: true,
      metadata: { originalValue: input.mutationPayload?.field },
    }
  },

  async afterSuccess(input) {
    // Runs after successful mutation — for cleanup, cache invalidation, logging
    // input.metadata contains what you passed from validate()
  },
}

export const guards = [guard]
```

## Rules

- `resourceId` is `null` for create operations — handle this case
- Return a new object for `modifiedPayload` — never mutate `input.mutationPayload` in place
- Guards with `targetEntity: '*'` run on EVERY entity mutation — use sparingly
- `afterSuccess` only runs when `shouldRunAfterSuccess: true` in the validate result
- Guard errors should return structured `{ ok: false, message }` — never throw
