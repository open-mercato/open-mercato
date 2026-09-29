import type { EntityManager } from '@mikro-orm/postgresql'
import { MarketingContactPreference } from '../data/entities.js'
import { MAX_PAUSE_DAYS } from './engine/gates.js'
import type { ContactPreference } from './engine/gates.js'

/**
 * The recipient's own contact preferences: reading them for the send gate, and writing them from the portal.
 *
 * The point of this table is the middle ground. Consent is yes or no, and a person who only wanted fewer
 * emails has historically had to choose "no" — so a preference centre that offers "less often" and "pause"
 * is the cheapest unsubscribe prevention there is.
 */

export type PreferenceScope = { tenantId: string; organizationId: string }

/** The largest cap worth storing: above this it is not a limit anybody meant. */
export const MAX_PER_WEEK = 14

export async function loadContactPreference(
  em: EntityManager,
  scope: PreferenceScope,
  subjectEntityId: string,
): Promise<ContactPreference | null> {
  const row = await em.findOne(MarketingContactPreference, { ...scope, subjectEntityId })
  if (!row) return null
  return {
    maxPerWeek: row.maxPerWeek ?? null,
    pausedUntil: row.pausedUntil ?? null,
  }
}

export type PreferenceInput = {
  /** Null clears their cap; undefined leaves it as it was. */
  maxPerWeek?: number | null
  /** Days from now, or null to un-pause. Expressed as a duration because that is what a person chooses. */
  pauseDays?: number | null
  source: string
}

/**
 * Writes a preference, clamped.
 *
 * Clamped rather than rejected: this is called from a customer-facing form, and refusing a number somebody
 * typed with a validation error is a worse outcome than honouring the nearest sane one — while a pause beyond
 * a year is an unsubscribe with extra steps, and storing it as one would be dishonest.
 */
export async function saveContactPreference(
  em: EntityManager,
  scope: PreferenceScope,
  subjectEntityId: string,
  input: PreferenceInput,
  now: Date,
): Promise<ContactPreference> {
  let row = await em.findOne(MarketingContactPreference, { ...scope, subjectEntityId })
  if (!row) {
    row = em.create(MarketingContactPreference, { ...scope, subjectEntityId, source: input.source })
    em.persist(row)
  }
  row.source = input.source

  if (input.maxPerWeek !== undefined) {
    row.maxPerWeek = input.maxPerWeek === null
      ? null
      : Math.max(1, Math.min(Math.round(input.maxPerWeek), MAX_PER_WEEK))
  }

  if (input.pauseDays !== undefined) {
    if (input.pauseDays === null || input.pauseDays <= 0) {
      row.pausedUntil = null
    } else {
      const days = Math.min(Math.round(input.pauseDays), MAX_PAUSE_DAYS)
      row.pausedUntil = new Date(now.getTime() + days * 86_400_000)
    }
  }

  await em.flush()
  return { maxPerWeek: row.maxPerWeek ?? null, pausedUntil: row.pausedUntil ?? null }
}

export type PreferenceSummary = {
  maxPerWeek: number | null
  pausedUntil: string | null
  source: string | null
}

/** What the profile and the portal both show. */
export async function loadPreferenceSummary(
  em: EntityManager,
  scope: PreferenceScope,
  subjectEntityId: string,
): Promise<PreferenceSummary> {
  const row = await em.findOne(MarketingContactPreference, { ...scope, subjectEntityId })
  return {
    maxPerWeek: row?.maxPerWeek ?? null,
    pausedUntil: row?.pausedUntil ? row.pausedUntil.toISOString() : null,
    source: row?.source ?? null,
  }
}
