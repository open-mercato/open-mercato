import { UniqueConstraintViolationException } from '@mikro-orm/core'
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
  /** A BCP-47-ish language tag, or null to stop expressing one. */
  locale?: string | null
  source: string
}

/**
 * What a language tag may look like.
 *
 * Deliberately narrow: this value ends up in an audience comparison and in copy selection, and a free-text
 * field there invites `en-GB `, `EN`, and `english` to be three different languages.
 */
export const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/

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

  if (input.locale !== undefined) {
    // Normalised, then checked: a tag that is not one is dropped rather than stored, because a stored
    // `english` would silently match nothing for the rest of its life.
    const normalized = input.locale === null ? null : normalizeLocale(input.locale)
    row.locale = normalized
  }

  if (input.pauseDays !== undefined) {
    if (input.pauseDays === null || input.pauseDays <= 0) {
      row.pausedUntil = null
    } else {
      const days = Math.min(Math.round(input.pauseDays), MAX_PAUSE_DAYS)
      row.pausedUntil = new Date(now.getTime() + days * 86_400_000)
    }
  }

  try {
    await em.flush()
  } catch (error) {
    /**
     * Same race as the consent writer, from the portal: a customer double-submitting the preference centre.
     *
     * The unique index on (tenant, organization, subject) is the guard; losing it means the other write has
     * already stored a preference for this person, so answering with what we intended is honest — and answering
     * 500 to somebody who just set their preferences successfully is not.
     */
    if (!(error instanceof UniqueConstraintViolationException)) throw error
    em.clear()
  }
  return { maxPerWeek: row.maxPerWeek ?? null, pausedUntil: row.pausedUntil ?? null }
}

/** `en`, `en-GB` — or null for anything that is not a language tag. */
export function normalizeLocale(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const [language, region] = trimmed.replace('_', '-').split('-')
  const candidate = region ? `${language.toLowerCase()}-${region.toUpperCase()}` : language.toLowerCase()
  return LOCALE_PATTERN.test(candidate) ? candidate : null
}

export type PreferenceSummary = {
  maxPerWeek: number | null
  pausedUntil: string | null
  locale: string | null
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
    locale: row?.locale ?? null,
    source: row?.source ?? null,
  }
}

/**
 * The language the customer chose, for the subject document.
 *
 * Read separately from the send gate's preference because it answers a different question — the gate asks
 * "may I send this now", the document asks "what is true about this person" — and only one of them is on the
 * hot path of every send.
 */
export async function loadPreferredLocale(
  em: EntityManager,
  scope: PreferenceScope,
  subjectEntityId: string,
): Promise<string | null> {
  const row = await em.findOne(MarketingContactPreference, { ...scope, subjectEntityId })
  return row?.locale ?? null
}
