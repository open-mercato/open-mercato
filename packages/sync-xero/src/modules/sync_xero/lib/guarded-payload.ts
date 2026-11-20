import { z } from 'zod'
import type { RouteMutationGuardPassed } from '@open-mercato/shared/lib/crud/route-mutation-guard'

/**
 * The payload a passed mutation guard lets a Xero write persist: the guard's transformation merged
 * over the original payload and re-validated. A transformation that changes one of the fixed keys
 * (scope and resource identity) or fails the schema yields null, and the caller refuses the write.
 */
export function readGuardedPayload<Schema extends z.ZodType<Record<string, unknown>>>(input: {
  guard: RouteMutationGuardPassed
  payload: z.input<Schema> & Record<string, unknown>
  schema: Schema
  fixedKeys: ReadonlyArray<keyof z.input<Schema> & string>
}): z.output<Schema> | null {
  const merged: Record<string, unknown> = { ...input.payload, ...(input.guard.modifiedPayload ?? {}) }
  if (input.fixedKeys.some((key) => merged[key] !== input.payload[key])) return null
  const parsed = input.schema.safeParse(merged)
  return parsed.success ? parsed.data : null
}

/** The guard payload of a grant action (Connect, a test seam action): both keys are fixed. */
export const grantActionGuardPayloadSchema = z.object({ integrationId: z.string(), action: z.string() })
