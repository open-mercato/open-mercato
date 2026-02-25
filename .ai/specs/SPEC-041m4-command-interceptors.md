# SPEC-041m4 — Command Interceptors

| Field | Value |
|-------|-------|
| **Parent** | [SPEC-041m — Mutation Lifecycle](./SPEC-041m-mutation-lifecycle.md) |
| **Status** | Draft |

## Goal

Commands (`CommandHandler` registered via `registerCommand`) provide audit logging, snapshot-based change tracking, and **undo/redo** for mutations. Currently they are closed: only the owning module can define a command's behavior. Third-party modules cannot modify how a customer save works, add cross-cutting validation before execute, inject extra side-effects after execute, or customize undo behavior.

**Command Interceptors** are the command-bus analog of API Interceptors (Phase E). They allow any module to hook before/after `execute()` and before/after `undo()` of any registered command — by command ID pattern.

---

## Design Principle: Symmetric with API Interceptors

| Concern | API Interceptors (Phase E) | Command Interceptors (Phase M) |
|---------|---------------------------|-------------------------------|
| Target | HTTP route pattern (`sales/orders`, `*`) | Command ID pattern (`customers.people.update`, `customers.*`, `*`) |
| Hooks | `before` / `after` | `beforeExecute` / `afterExecute` / `beforeUndo` / `afterUndo` |
| Can block? | Yes (`ok: false`) | Yes (`ok: false`) |
| Can modify input? | Yes (body re-validated through Zod) | Yes (`modifiedInput` merged — no re-validation since command owns its schema) |
| Can modify result? | Yes (`merge`/`replace`) | Yes (`modifiedResult` merged into result) |
| Auto-discovery | `api/interceptors.ts` | `commands/interceptors.ts` |
| Priority ordering | Lower = earlier | Lower = earlier |
| ACL gating | `features[]` | `features[]` |

---

## Command Interceptor Contract

```typescript
// packages/shared/src/lib/commands/command-interceptor.ts

interface CommandInterceptor {
  /** Unique interceptor ID (e.g., 'example.log-customer-saves', 'compliance.block-inactive-edits') */
  id: string

  /** Target command ID pattern. Supports:
   *  - Exact: 'customers.people.update'
   *  - Module wildcard: 'customers.*'
   *  - Global wildcard: '*'
   */
  targetCommand: string

  /** Execution priority (lower = earlier). Default: 50 */
  priority?: number

  /** ACL feature gating — interceptor only runs if user has these features */
  features?: string[]

  /** Hook before command execute(). Can block or modify input. */
  beforeExecute?(
    input: unknown,
    context: CommandInterceptorContext,
  ): Promise<CommandInterceptorBeforeResult | void>

  /** Hook after command execute(). Can augment result or trigger side-effects. */
  afterExecute?(
    input: unknown,
    result: unknown,
    context: CommandInterceptorContext,
  ): Promise<CommandInterceptorAfterResult | void>

  /** Hook before command undo(). Can block undo. */
  beforeUndo?(
    undoContext: CommandInterceptorUndoContext,
    context: CommandInterceptorContext,
  ): Promise<CommandInterceptorBeforeResult | void>

  /** Hook after command undo(). Trigger cleanup or side-effects. */
  afterUndo?(
    undoContext: CommandInterceptorUndoContext,
    context: CommandInterceptorContext,
  ): Promise<void>
}

interface CommandInterceptorContext {
  /** The resolved command ID being executed */
  commandId: string
  /** Current user auth context */
  auth: AuthContext | null
  /** Organization scope */
  organizationScope: OrganizationScope | null
  /** Selected organization ID */
  selectedOrganizationId: string | null
  /** DI container (read-only usage recommended) */
  container: AwilixContainer
  /** Metadata passthrough from beforeExecute to afterExecute (or beforeUndo to afterUndo) */
  metadata?: Record<string, unknown>
}

interface CommandInterceptorUndoContext {
  /** The original input used when the command was executed */
  input: unknown
  /** The action log entry being undone */
  logEntry: ActionLog
  /** The undo token */
  undoToken: string
}

interface CommandInterceptorBeforeResult {
  /** If false, blocks the command. Default: true */
  ok?: boolean
  /** Error message when blocking */
  message?: string
  /** Modified input — shallow-merged into command input if ok:true */
  modifiedInput?: Record<string, unknown>
  /** Metadata passed to the corresponding after hook */
  metadata?: Record<string, unknown>
}

interface CommandInterceptorAfterResult {
  /** Modified result — shallow-merged into command result */
  modifiedResult?: Record<string, unknown>
  /** Metadata (for logging/debugging — not passed further) */
  metadata?: Record<string, unknown>
}
```

---

## Command Pattern Matching

```typescript
function matchesCommandPattern(pattern: string, commandId: string): boolean {
  if (pattern === '*') return true
  if (pattern === commandId) return true
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2)
    return commandId.startsWith(prefix + '.')
  }
  return false
}
```

Examples:
- `'customers.people.update'` — exact match for person update command
- `'customers.*'` — matches all customer commands (people, companies, deals, etc.)
- `'sales.*'` — matches all sales commands
- `'*'` — matches every command (useful for cross-cutting concerns like audit logging)

---

## Command Interceptor Runner

```typescript
// packages/shared/src/lib/commands/command-interceptor-runner.ts

/** Run beforeExecute interceptors in priority order. Stops on first rejection. */
async function runCommandInterceptorsBefore(
  interceptors: CommandInterceptor[],
  commandId: string,
  input: unknown,
  context: CommandInterceptorContext,
  userFeatures: string[],
): Promise<{
  ok: boolean
  error?: { message: string }
  modifiedInput?: Record<string, unknown>
  metadataByInterceptor: Map<string, Record<string, unknown>>
}> {
  const matching = interceptors
    .filter(i => matchesCommandPattern(i.targetCommand, commandId))
    .filter(i => !i.features?.length || i.features.every(f => userFeatures.includes(f)))
    .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50))

  let currentInput = input
  const metadataByInterceptor = new Map<string, Record<string, unknown>>()

  for (const interceptor of matching) {
    if (!interceptor.beforeExecute) continue
    const result = await interceptor.beforeExecute(currentInput, { ...context, commandId })

    if (result?.ok === false) {
      return {
        ok: false,
        error: { message: result.message ?? `Blocked by command interceptor: ${interceptor.id}` },
        metadataByInterceptor,
      }
    }

    if (result?.modifiedInput) {
      currentInput = typeof currentInput === 'object' && currentInput
        ? { ...currentInput as Record<string, unknown>, ...result.modifiedInput }
        : result.modifiedInput
    }

    if (result?.metadata) {
      metadataByInterceptor.set(interceptor.id, result.metadata)
    }
  }

  const inputChanged = currentInput !== input
  return {
    ok: true,
    modifiedInput: inputChanged ? currentInput as Record<string, unknown> : undefined,
    metadataByInterceptor,
  }
}

/** Run afterExecute interceptors. Cannot block — errors are logged and swallowed. */
async function runCommandInterceptorsAfter(
  interceptors: CommandInterceptor[],
  commandId: string,
  input: unknown,
  result: unknown,
  context: CommandInterceptorContext,
  userFeatures: string[],
  metadataByInterceptor: Map<string, Record<string, unknown>>,
): Promise<{ modifiedResult?: Record<string, unknown> }> {
  const matching = interceptors
    .filter(i => matchesCommandPattern(i.targetCommand, commandId))
    .filter(i => !i.features?.length || i.features.every(f => userFeatures.includes(f)))
    .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50))

  let currentResult = result

  for (const interceptor of matching) {
    if (!interceptor.afterExecute) continue
    try {
      const afterResult = await interceptor.afterExecute(
        input,
        currentResult,
        { ...context, commandId, metadata: metadataByInterceptor.get(interceptor.id) },
      )
      if (afterResult?.modifiedResult && typeof currentResult === 'object' && currentResult) {
        currentResult = { ...currentResult as Record<string, unknown>, ...afterResult.modifiedResult }
      }
    } catch (error) {
      console.error(`[command-interceptor] afterExecute failed: ${interceptor.id}`, error)
    }
  }

  const resultChanged = currentResult !== result
  return { modifiedResult: resultChanged ? currentResult as Record<string, unknown> : undefined }
}

/** Run beforeUndo interceptors. Stops on first rejection. */
async function runCommandInterceptorsBeforeUndo(
  interceptors: CommandInterceptor[],
  commandId: string,
  undoContext: CommandInterceptorUndoContext,
  context: CommandInterceptorContext,
  userFeatures: string[],
): Promise<{
  ok: boolean
  error?: { message: string }
  metadataByInterceptor: Map<string, Record<string, unknown>>
}> {
  const matching = interceptors
    .filter(i => matchesCommandPattern(i.targetCommand, commandId))
    .filter(i => !i.features?.length || i.features.every(f => userFeatures.includes(f)))
    .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50))

  const metadataByInterceptor = new Map<string, Record<string, unknown>>()

  for (const interceptor of matching) {
    if (!interceptor.beforeUndo) continue
    const result = await interceptor.beforeUndo(undoContext, { ...context, commandId })

    if (result?.ok === false) {
      return {
        ok: false,
        error: { message: result.message ?? `Undo blocked by command interceptor: ${interceptor.id}` },
        metadataByInterceptor,
      }
    }

    if (result?.metadata) {
      metadataByInterceptor.set(interceptor.id, result.metadata)
    }
  }

  return { ok: true, metadataByInterceptor }
}

/** Run afterUndo interceptors. Cannot block — errors are logged and swallowed. */
async function runCommandInterceptorsAfterUndo(
  interceptors: CommandInterceptor[],
  commandId: string,
  undoContext: CommandInterceptorUndoContext,
  context: CommandInterceptorContext,
  userFeatures: string[],
  metadataByInterceptor: Map<string, Record<string, unknown>>,
): Promise<void> {
  const matching = interceptors
    .filter(i => matchesCommandPattern(i.targetCommand, commandId))
    .filter(i => !i.features?.length || i.features.every(f => userFeatures.includes(f)))
    .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50))

  for (const interceptor of matching) {
    if (!interceptor.afterUndo) continue
    try {
      await interceptor.afterUndo(
        undoContext,
        { ...context, commandId, metadata: metadataByInterceptor.get(interceptor.id) },
      )
    } catch (error) {
      console.error(`[command-interceptor] afterUndo failed: ${interceptor.id}`, error)
    }
  }
}
```

---

## Auto-Discovery

```typescript
// In module's commands/interceptors.ts (new auto-discovered file)
import type { CommandInterceptor } from '@open-mercato/shared/lib/commands/command-interceptor'

export const interceptors: CommandInterceptor[] = [...]
```

`yarn generate` discovers `commands/interceptors.ts` and generates `command-interceptors.generated.ts` into `apps/mercato/.mercato/generated/`.

---

## CommandBus Modifications

The `CommandBus.execute()` and `CommandBus.undo()` methods are extended to run interceptors at the outermost layer:

```typescript
// Existing execute() flow — with interceptor hooks added:
async execute<TInput, TResult>(commandId, options): Promise<CommandExecuteResult<TResult>> {
  const handler = this.resolveHandler(commandId)

  // [NEW] Run beforeExecute interceptors
  const beforeResult = await runCommandInterceptorsBefore(
    globalCommandInterceptors, commandId, options.input, interceptorCtx, userFeatures,
  )
  if (!beforeResult.ok) {
    throw new CommandInterceptorError(beforeResult.error!.message)
  }
  if (beforeResult.modifiedInput) {
    options = { ...options, input: { ...options.input as object, ...beforeResult.modifiedInput } as TInput }
  }

  // Existing: prepare → execute → captureAfter → buildLog → persistLog → cache
  const snapshots = await this.prepareSnapshots(handler, options)
  const result = await handler.execute(options.input, options.ctx)
  // ... existing logic ...

  // [NEW] Run afterExecute interceptors
  const afterResult = await runCommandInterceptorsAfter(
    globalCommandInterceptors, commandId, options.input, result, interceptorCtx,
    userFeatures, beforeResult.metadataByInterceptor,
  )
  // afterResult.modifiedResult is merged into the result if present

  return { result: finalResult, logEntry }
}

// Existing undo() flow — with interceptor hooks added:
async undo(undoToken, ctx): Promise<void> {
  const log = await service.findByUndoToken(undoToken)
  const handler = this.resolveHandler(log.commandId)

  // [NEW] Run beforeUndo interceptors
  const undoCtx = { input: log.commandPayload, logEntry: log, undoToken }
  const beforeResult = await runCommandInterceptorsBeforeUndo(
    globalCommandInterceptors, log.commandId, undoCtx, interceptorCtx, userFeatures,
  )
  if (!beforeResult.ok) {
    throw new CommandInterceptorError(beforeResult.error!.message)
  }

  // Existing: handler.undo() → markUndone → cache invalidation
  await handler.undo({ input: log.commandPayload, ctx, logEntry: log })
  await service.markUndone(log.id)

  // [NEW] Run afterUndo interceptors
  await runCommandInterceptorsAfterUndo(
    globalCommandInterceptors, log.commandId, undoCtx, interceptorCtx,
    userFeatures, beforeResult.metadataByInterceptor,
  )

  await this.flushCrudSideEffects(ctx.container)
}
```

---

## Execute Pipeline with Command Interceptors

```
COMMAND EXECUTE:
  1. [Interceptor]  beforeExecute hooks (priority-sorted)           ← NEW
  2. [Command]      prepare() — capture before-snapshot              (existing)
  3. [Command]      execute() — run mutation                         (existing)
  4. [Command]      captureAfter() — capture after-snapshot          (existing)
  5. [Command]      buildLog() — audit metadata                      (existing)
  6. [Bus]          persistLog() — save ActionLog                    (existing)
  7. [Interceptor]  afterExecute hooks (priority-sorted)             ← NEW
  8. [Bus]          invalidateCrudCache()                             (existing)
  9. [Bus]          flushCrudSideEffects()                            (existing)

COMMAND UNDO:
  1. [Interceptor]  beforeUndo hooks (priority-sorted)               ← NEW
  2. [Command]      undo() — restore from snapshot                   (existing)
  3. [Bus]          markUndone() — mark ActionLog as undone           (existing)
  4. [Interceptor]  afterUndo hooks (priority-sorted)                ← NEW
  5. [Bus]          invalidateCrudCache()                             (existing)
  6. [Bus]          flushCrudSideEffects()                            (existing)
```

---

## Example: Extending Customer Person Save

A third-party module that adds a loyalty score to every customer person update and prevents undo of updates older than 24 hours:

```typescript
// packages/core/src/modules/example/commands/interceptors.ts
import type { CommandInterceptor } from '@open-mercato/shared/lib/commands/command-interceptor'

export const interceptors: CommandInterceptor[] = [
  // 1. Inject loyalty score on customer person updates
  {
    id: 'example.customer-loyalty-score',
    targetCommand: 'customers.people.update',
    priority: 50,
    features: ['example.view'],

    async beforeExecute(input, ctx) {
      const record = input as Record<string, unknown>
      const email = record.primaryEmail as string | undefined

      // Example: Auto-set lifecycle stage based on email domain
      if (email && email.endsWith('@vip-corp.com')) {
        return {
          ok: true,
          modifiedInput: {
            lifecycleStage: 'enterprise',
          },
          metadata: {
            originalLifecycleStage: record.lifecycleStage ?? null,
            appliedRule: 'vip-domain-upgrade',
          },
        }
      }

      return { ok: true }
    },

    async afterExecute(input, result, ctx) {
      if (ctx.metadata?.appliedRule) {
        console.log(
          `[example] Customer ${(result as Record<string, unknown>).entityId} ` +
          `upgraded by rule: ${ctx.metadata.appliedRule}`
        )
      }
    },
  },

  // 2. Block undo of customer updates older than 24 hours
  {
    id: 'example.customer-undo-time-limit',
    targetCommand: 'customers.people.update',
    priority: 10,

    async beforeUndo(undoCtx, ctx) {
      const log = undoCtx.logEntry
      const createdAt = new Date(log.createdAt)
      const hoursAgo = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60)

      if (hoursAgo > 24) {
        return {
          ok: false,
          message: `Cannot undo changes older than 24 hours. This change was made ${Math.floor(hoursAgo)} hours ago.`,
        }
      }

      return { ok: true }
    },

    async afterUndo(undoCtx, ctx) {
      console.log(`[example] Customer undo completed for ${undoCtx.logEntry.resourceId}`)
    },
  },

  // 3. Cross-cutting: Audit all customer command executions
  {
    id: 'example.customer-command-audit',
    targetCommand: 'customers.*',
    priority: 1,  // Runs first

    async beforeExecute(input, ctx) {
      return {
        ok: true,
        metadata: { startedAt: Date.now() },
      }
    },

    async afterExecute(input, result, ctx) {
      const duration = Date.now() - ((ctx.metadata?.startedAt as number) ?? Date.now())
      console.log(`[example] Command ${ctx.commandId} completed in ${duration}ms`)
    },
  },
]
```

---

## Relationship to Other Extension Layers

```
┌─────────────────────────────────────────────────────┐
│  Command Interceptor (beforeExecute)                 │  Cross-module, command-level
│  ┌─────────────────────────────────────────────────┐ │
│  │  Command Handler (prepare + execute)             │ │  Module-owned, entity-level
│  │  ┌─────────────────────────────────────────────┐ │ │
│  │  │  (Internal: CRUD factory pipeline if route)  │ │ │  See parent spec for full pipeline
│  │  └─────────────────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────┘ │
│  Command Interceptor (afterExecute)                  │
└─────────────────────────────────────────────────────┘
```

| I want to... | Mechanism | Why not the other? |
|-------------|-----------|-------------------|
| Modify input before a specific command runs | Command Interceptor `beforeExecute` | API interceptors target HTTP routes, not commands; sync subscribers target entity events, not command IDs |
| Block a specific command from executing | Command Interceptor `beforeExecute` | More precise than API interceptors (command-level vs route-level) |
| Block undo of a specific command | Command Interceptor `beforeUndo` | **Only mechanism** that can intercept undo |
| Add side-effects after command undo | Command Interceptor `afterUndo` | **Only mechanism** for post-undo hooks |
| React to entity creation/update (regardless of whether it came from a command or direct CRUD route) | Sync subscriber / API interceptor | Command interceptors only fire for `commandBus.execute()`, not direct CRUD |
| Validate at HTTP route level | API Interceptor `before` | Route-level concern, not command-level |
| Add cross-cutting policy (locks, limits) | Mutation Guard | Runs inside CRUD factory, covers both command and direct CRUD paths |

---

## Error Handling

When a `beforeExecute` interceptor returns `ok: false`, the `CommandBus` throws a `CommandInterceptorError`:

```typescript
// packages/shared/src/lib/commands/errors.ts

export class CommandInterceptorError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommandInterceptorError'
  }
}
```

API routes and UI pages that invoke commands should handle this error and return an appropriate response (e.g., 422 with the interceptor's message). The existing `CrudHttpError` catch-and-map pattern in detail pages already handles thrown errors gracefully.

For `beforeUndo`, the error propagates to the undo caller — typically the action log undo API endpoint, which already returns the error message to the user.

---

## Full Customer Save Extension Example

This section demonstrates a complete, realistic third-party module (`loyalty`) that extends the customer person save command to:
1. Auto-compute a loyalty tier from a custom field score
2. Prevent downgrading VIP customers without a reason
3. Clean up tier cache on undo

```typescript
// packages/core/src/modules/loyalty/commands/interceptors.ts
import type { CommandInterceptor } from '@open-mercato/shared/lib/commands/command-interceptor'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'

function computeLoyaltyTier(score: number): string {
  if (score >= 90) return 'platinum'
  if (score >= 70) return 'gold'
  if (score >= 40) return 'silver'
  return 'bronze'
}

export const interceptors: CommandInterceptor[] = [
  {
    id: 'loyalty.auto-tier-on-person-save',
    targetCommand: 'customers.people.update',
    priority: 50,
    features: ['loyalty.manage'],

    async beforeExecute(input, ctx) {
      const record = input as Record<string, unknown>
      const loyaltyScore = record['cf:loyalty_score'] as number | undefined

      if (loyaltyScore !== undefined) {
        const newTier = computeLoyaltyTier(loyaltyScore)

        if (newTier !== 'platinum') {
          const em = ctx.container.resolve('em') as DataEngine
          const existing = await em.findOne('CustomerEntity', {
            id: record.id,
            deletedAt: null,
          })
          const existingTier = existing?.customValues?.['cf:loyalty_tier'] as string | undefined

          if (existingTier === 'platinum' && !record['cf:tier_change_reason']) {
            return {
              ok: false,
              message: 'Cannot downgrade a Platinum customer without providing a tier change reason (cf:tier_change_reason).',
            }
          }
        }

        return {
          ok: true,
          modifiedInput: {
            'cf:loyalty_tier': newTier,
          },
          metadata: {
            previousScore: loyaltyScore,
            computedTier: newTier,
          },
        }
      }

      return { ok: true }
    },

    async afterExecute(input, result, ctx) {
      if (ctx.metadata?.computedTier) {
        const cache = ctx.container.resolve('cacheService')
        const entityId = (result as Record<string, unknown>).entityId as string
        await cache.invalidate(`loyalty:tier:${entityId}`)
      }
    },

    async beforeUndo(undoCtx, ctx) {
      return {
        ok: true,
        metadata: { requiresCacheInvalidation: true },
      }
    },

    async afterUndo(undoCtx, ctx) {
      const resourceId = undoCtx.logEntry.resourceId
      if (resourceId) {
        const cache = ctx.container.resolve('cacheService')
        await cache.invalidate(`loyalty:tier:${resourceId}`)
      }
    },
  },
]
```

### How It Works End-to-End

**Update flow** (user sets loyalty_score to 95 on a person):

1. UI sends `PUT /api/customers/people/:id` with `{ ..., "cf:loyalty_score": 95 }`
2. The CRUD route invokes `commandBus.execute('customers.people.update', { input, ctx })`
3. **Command interceptor `beforeExecute`** runs:
   - Sees `cf:loyalty_score = 95`, computes tier = `'platinum'`
   - Returns `modifiedInput: { "cf:loyalty_tier": "platinum" }`
   - Input is now merged: `{ ..., "cf:loyalty_score": 95, "cf:loyalty_tier": "platinum" }`
4. Command handler `prepare()` captures before-snapshot (including old tier)
5. Command handler `execute()` saves the merged input (score + auto-computed tier)
6. Command handler `captureAfter()` captures after-snapshot
7. **Command interceptor `afterExecute`** runs: invalidates tier cache
8. ActionLog saved with undo token — snapshots contain both old and new tier values

**Undo flow** (user clicks Undo):

1. UI calls undo endpoint with the `undoToken`
2. `commandBus.undo(undoToken, ctx)` resolves the ActionLog
3. **Command interceptor `beforeUndo`** runs: allows undo, stores metadata
4. Command handler `undo()` restores before-snapshot (old score + old tier restored)
5. ActionLog marked as undone
6. **Command interceptor `afterUndo`** runs: re-invalidates tier cache

**Blocked downgrade flow** (user tries to lower a Platinum customer's score without reason):

1. UI sends update with `{ "cf:loyalty_score": 30 }` (no `cf:tier_change_reason`)
2. Command interceptor `beforeExecute` computes tier = `'bronze'`, detects existing = `'platinum'`
3. Returns `{ ok: false, message: 'Cannot downgrade...' }`
4. `CommandBus` throws `CommandInterceptorError`
5. API route returns 422 to client with the message

---

## Integration Tests

### TC-UMES-CI01: Command interceptor `beforeExecute` modifies input (auto-computed tier)

**Type**: API (Playwright)

**Steps**:
1. Create a person via API (baseline)
2. PUT `/api/customers/people/:id` with body including `"cf:loyalty_score": 95`
3. GET the updated person
4. Assert `cf:loyalty_tier` is `'platinum'` (auto-set by interceptor, not by the user)

**Expected**: The interceptor's `modifiedInput` is merged into the command input and persisted

### TC-UMES-CI02: Command interceptor `beforeExecute` blocks execution with 422

**Type**: API (Playwright)

**Steps**:
1. Create a person, set `cf:loyalty_score` to 95 (tier becomes `'platinum'`)
2. PUT to update `cf:loyalty_score` to 30 **without** `cf:tier_change_reason`
3. Assert response status is 422
4. Assert response body contains message about "Cannot downgrade a Platinum customer"
5. GET the person — assert `cf:loyalty_tier` is still `'platinum'` (update was blocked)

**Expected**: Interceptor blocks the downgrade; original data unchanged

### TC-UMES-CI03: Command interceptor `beforeExecute` allows when condition is met

**Type**: API (Playwright)

**Steps**:
1. Create a person, set `cf:loyalty_score` to 95 (tier = `'platinum'`)
2. PUT to update `cf:loyalty_score` to 30 **with** `cf:tier_change_reason: "Customer requested"`
3. Assert response status is 200
4. GET the person — assert `cf:loyalty_tier` is `'bronze'`

**Expected**: Interceptor allows the downgrade when reason is provided; tier recomputed

### TC-UMES-CI04: Command interceptor `afterExecute` receives metadata from `beforeExecute`

**Type**: API (Playwright)

**Steps**:
1. Create a person
2. PUT with `cf:loyalty_score: 75`
3. Verify the update succeeds (200)
4. (Indirect verification: check server logs for the `[example] Customer X upgraded by rule` message, or verify cache was invalidated by checking a subsequent GET is fresh)

**Expected**: `afterExecute` receives `metadata.computedTier` and `metadata.previousScore` from `beforeExecute`

### TC-UMES-CI05: Command interceptor `beforeUndo` blocks undo with message

**Type**: API (Playwright)

**Steps**:
1. Create and update a person (captures undo token)
2. Wait or simulate 25 hours passing (via test helper or adjustable time-limit interceptor)
3. Attempt undo via the undo token
4. Assert undo fails with message about "Cannot undo changes older than 24 hours"

**Expected**: `beforeUndo` interceptor blocks the undo; original update remains

**Testing notes**: For practical testing, use an interceptor with a configurable time limit (e.g., 0 seconds for the test) or mock time.

### TC-UMES-CI06: Command interceptor `afterUndo` runs cleanup after successful undo

**Type**: API (Playwright)

**Steps**:
1. Create a person, update `cf:loyalty_score` to 80 (captures undo token)
2. GET person — verify `cf:loyalty_tier` is `'gold'`
3. Undo the update via token
4. GET person — verify `cf:loyalty_score` and `cf:loyalty_tier` reverted to original values
5. (Indirect verification: `afterUndo` ran, cache invalidated — subsequent reads return fresh data)

**Expected**: Undo restores original values; `afterUndo` runs cleanup

### TC-UMES-CI07: Wildcard `customers.*` interceptor matches all customer commands

**Type**: API (Playwright)

**Steps**:
1. Register an interceptor with `targetCommand: 'customers.*'`
2. Execute `customers.people.update` — verify interceptor runs (e.g., via logged metadata)
3. Execute `customers.companies.update` — verify interceptor runs
4. Execute `example.todos.update` — verify interceptor does NOT run

**Expected**: Wildcard matches all customer module commands but not other modules

### TC-UMES-CI08: Multiple interceptors run in priority order, first rejection wins

**Type**: API (Playwright)

**Steps**:
1. Register interceptor A (priority 10) that allows
2. Register interceptor B (priority 20) that blocks
3. Register interceptor C (priority 30) that allows
4. Execute a command
5. Assert execution is blocked by interceptor B
6. Assert interceptor C's `beforeExecute` was never called

**Expected**: Priority ordering is respected; short-circuits on first `ok: false`

### TC-UMES-CI09: ACL-gated interceptor skipped when user lacks feature

**Type**: API (Playwright)

**Steps**:
1. Register interceptor with `features: ['loyalty.manage']`
2. Execute command as user WITHOUT `loyalty.manage` feature
3. Assert interceptor is skipped (command succeeds normally)
4. Execute command as user WITH `loyalty.manage` feature
5. Assert interceptor runs (modifies input or blocks)

**Expected**: Feature-gated interceptors respect ACL

### TC-UMES-CI10: Interceptor on create command (`customers.people.create`)

**Type**: API (Playwright)

**Steps**:
1. Register interceptor targeting `customers.people.create`
2. POST `/api/customers/people` to create a person with `cf:loyalty_score: 85`
3. GET the created person
4. Assert `cf:loyalty_tier` is `'gold'` (auto-set by interceptor)

**Expected**: Interceptors work on create commands, not just updates

---

## Backward Compatibility

- `CommandHandler` interface: **unchanged** — interceptors wrap the handler, not modify it
- `commandBus.execute()` callers: **unchanged** — interceptor errors throw `CommandInterceptorError` (subclass of `Error`), existing `try/catch` blocks handle it naturally
- `commandBus.undo()` callers: **unchanged** — same error propagation pattern
- New `commands/interceptors.ts`: purely additive — modules without it have zero change

---

## Files Touched

| Action | File |
|--------|------|
| **NEW** | `packages/shared/src/lib/commands/command-interceptor.ts` |
| **NEW** | `packages/shared/src/lib/commands/command-interceptor-runner.ts` |
| **NEW** | `packages/shared/src/lib/commands/errors.ts` |
| **NEW** | `packages/core/src/modules/example/commands/interceptors.ts` |
| **MODIFY** | `packages/shared/src/lib/commands/command-bus.ts` |
| **MODIFY** | Generator scripts (discover `commands/interceptors.ts`) |
| **MODIFY** | Bootstrap registration (register command interceptors) |
