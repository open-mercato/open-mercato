import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { requireCheckoutScope, type CheckoutScope } from '../lib/utils'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function resolveCommandScope(ctx: CommandRuntimeContext): CheckoutScope {
  return requireCheckoutScope({ auth: ctx.auth })
}

export function readCommandId(input: unknown, message: string): string {
  if (typeof input === 'string' && input.trim()) return input
  if (isRecord(input)) {
    if (typeof input.id === 'string' && input.id.trim()) return input.id
    if (isRecord(input.body) && typeof input.body.id === 'string' && input.body.id.trim()) return input.body.id
  }
  throw new CrudHttpError(400, { error: message })
}
