import { z } from 'zod'

/**
 * A `xero.*` cursor: versioned JSON that carries its Xero Organisation and keysets only, never a
 * secret or personal data (App Spec § 6.5, § 6.7).
 */
export const xeroCursorSchema = z.object({
  v: z.literal(1),
  xeroOrganisationId: z.string().min(1),
  modifiedSince: z.string().datetime().nullable(),
  lastFullAt: z.string().datetime().nullable(),
  fullPassStartedAt: z.string().datetime().nullable(),
  fullPassModifiedSince: z.string().datetime().nullable(),
  fullPassChunk: z.object({ from: z.string(), to: z.string() }).nullable().optional(),
  lastFullCalls: z.number().int().nonnegative().nullable(),
})

export type XeroCursor = z.infer<typeof xeroCursorSchema>

export function emptyXeroCursor(xeroOrganisationId: string): XeroCursor {
  return {
    v: 1,
    xeroOrganisationId,
    modifiedSince: null,
    lastFullAt: null,
    fullPassStartedAt: null,
    fullPassModifiedSince: null,
    lastFullCalls: null,
  }
}

/** An unparsable cursor, or one of another Organisation, counts as no cursor. */
export function parseXeroCursor(raw: string | null | undefined, xeroOrganisationId: string): XeroCursor | null {
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = xeroCursorSchema.safeParse(value)
  if (!parsed.success || parsed.data.xeroOrganisationId !== xeroOrganisationId) return null
  return parsed.data
}

export function serializeXeroCursor(cursor: XeroCursor): string {
  return JSON.stringify(xeroCursorSchema.parse(cursor))
}

export type XeroWalkPlan =
  | { kind: 'incremental'; cursor: XeroCursor; startAfter: Date }
  | { kind: 'full'; cursor: XeroCursor; startAfter: Date | null; resumed: boolean }

/**
 * Chooses the walk of a run (App Spec § 6.7): a pass in progress resumes from its keyset; a usable
 * cursor with a keyset walks incrementally; anything else — no cursor, another Organisation, an
 * explicit full sync — starts a full pass from the start of Xero's order.
 */
export function planXeroWalk(input: { cursor: XeroCursor | null; xeroOrganisationId: string; fullSync: boolean }): XeroWalkPlan {
  const cursor = input.fullSync ? null : input.cursor
  if (cursor?.fullPassStartedAt) {
    return {
      kind: 'full',
      cursor,
      startAfter: cursor.fullPassModifiedSince ? new Date(cursor.fullPassModifiedSince) : null,
      resumed: true,
    }
  }
  if (cursor?.modifiedSince) return { kind: 'incremental', cursor, startAfter: new Date(cursor.modifiedSince) }
  return {
    kind: 'full',
    cursor: { ...(cursor ?? emptyXeroCursor(input.xeroOrganisationId)), fullPassStartedAt: null, fullPassModifiedSince: null },
    startAfter: null,
    resumed: false,
  }
}

/** The cursor to commit after a page whose last record has `lastUpdatedAt`. */
export function advanceXeroCursor(plan: XeroWalkPlan, cursor: XeroCursor, input: { lastUpdatedAt: Date; passStartedAt: Date | null }): XeroCursor {
  if (plan.kind === 'incremental') return { ...cursor, modifiedSince: input.lastUpdatedAt.toISOString() }
  return {
    ...cursor,
    fullPassStartedAt: cursor.fullPassStartedAt ?? (input.passStartedAt ?? input.lastUpdatedAt).toISOString(),
    fullPassModifiedSince: input.lastUpdatedAt.toISOString(),
  }
}

/** The cursor a drained full pass commits: `lastFullAt` = `modifiedSince` = the pass start, pass fields cleared. */
export function completeXeroFullPass(cursor: XeroCursor, input: { passStartedAt: Date; calls: number }): XeroCursor {
  const startedAt = cursor.fullPassStartedAt ?? input.passStartedAt.toISOString()
  return {
    ...cursor,
    modifiedSince: startedAt,
    lastFullAt: startedAt,
    fullPassStartedAt: null,
    fullPassModifiedSince: null,
    fullPassChunk: null,
    lastFullCalls: input.calls,
  }
}
