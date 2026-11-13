import { AsyncLocalStorage } from 'node:async_hooks'
import { z } from 'zod'
import {
  resolveDatabaseExecutionContext,
  type DatabaseExecutionContext,
  type DatabaseInvocation,
} from '@open-mercato/shared/lib/db/runtime'

export type TenantBoundaryScope = Readonly<{
  context: DatabaseExecutionContext
  invocation: DatabaseInvocation
}>

type BoundaryState = { storage: AsyncLocalStorage<TenantBoundaryScope> }
const scopeKey = Symbol.for('@open-mercato/enterprise.tenantBoundaryScope.v1')
const tenantUuid = z.string().uuid()

function storage(): AsyncLocalStorage<TenantBoundaryScope> {
  const globals = globalThis as typeof globalThis & { [scopeKey]?: BoundaryState }
  globals[scopeKey] ??= { storage: new AsyncLocalStorage<TenantBoundaryScope>() }
  return globals[scopeKey].storage
}

function normalizeContext(context: DatabaseExecutionContext): DatabaseExecutionContext {
  if (context.kind === 'maintenance') {
    if (context.tenantId !== null || !context.operation.trim()) {
      throw new Error('[internal] Tenant boundary maintenance requires an explicit operation and no tenant')
    }
    return Object.freeze({ ...context })
  }
  if (context.kind === 'identity' && context.tenantId === null) return Object.freeze({ ...context })
  const parsed = tenantUuid.safeParse(context.tenantId)
  if (!parsed.success) throw new Error('[internal] Tenant boundary identity requires a UUID')
  return Object.freeze({ ...context, tenantId: parsed.data.toLowerCase() })
}

export function assertBoundaryInvocation(scope: TenantBoundaryScope | undefined): void {
  if (scope && !scope.invocation.isActive()) {
    throw new Error('[internal] Tenant boundary invocation has completed')
  }
}

export function currentTenantBoundaryScope(): TenantBoundaryScope | undefined {
  const scope = peekTenantBoundaryScope()
  assertBoundaryInvocation(scope)
  return scope
}

export function peekTenantBoundaryScope(): TenantBoundaryScope | undefined {
  return storage().getStore()
}

export function runWithTenantBoundary<Result>(context: DatabaseExecutionContext, callback: () => Result): Result {
  const normalized = normalizeContext(context)
  const current = currentTenantBoundaryScope()
  if (current) {
    if (current.context.kind === normalized.kind && current.context.tenantId === normalized.tenantId) {
      return callback()
    }
    if (!(current.context.kind === 'maintenance' && normalized.kind === 'tenant')) {
      throw new Error('[internal] Cannot change tenant boundary identity inside an active invocation')
    }
  }
  let active = true
  const invocation: DatabaseInvocation = Object.freeze({ token: Symbol('tenant-boundary-invocation'), isActive: () => active })
  const scope = Object.freeze({ context: normalized, invocation })
  return storage().run(scope, () => {
    try {
      const result = callback()
      if (result !== null && (typeof result === 'object' || typeof result === 'function') && 'then' in result && typeof result.then === 'function') {
        void Promise.resolve(result).then(() => { active = false }, () => { active = false })
      } else {
        active = false
      }
      return result
    } catch (error) {
      active = false
      throw error
    }
  })
}

export async function resolveTenantBoundaryScope(): Promise<TenantBoundaryScope | undefined> {
  const current = currentTenantBoundaryScope()
  if (current) return current
  const resolved = await resolveDatabaseExecutionContext()
  if (resolved.status === 'absent') return undefined
  const scope = Object.freeze({ context: normalizeContext(resolved.context), invocation: resolved.invocation })
  if (typeof scope.invocation.token !== 'symbol') throw new Error('[internal] Tenant boundary resolver supplied an invalid invocation')
  assertBoundaryInvocation(scope)
  return scope
}
