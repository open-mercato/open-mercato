import type { EntityManager } from '@mikro-orm/core'
import { getMarketTemplate, type MarketTemplateCode } from '@open-mercato/shared/lib/display/templates'
import type { DisplayProfile } from '@open-mercato/shared/lib/display/profile'
import { MarketDisplayProfile } from '../data/entities'

export type MarketScope = {
  tenantId: string
  organizationId: string
}

/** The stored column values a template implies. Shared by the seed and the CRUD write path. */
export function templateToRowValues(profile: DisplayProfile): Omit<
  MarketDisplayProfile,
  'id' | 'organizationId' | 'tenantId' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'isActive'
> {
  return {
    code: profile.code,
    name: profile.name,
    languageTag: profile.languageTag ?? 'en',
    currencyCode: profile.currencyCode,
    currencyDisplay: profile.currencyDisplay,
    decimalSeparator: profile.decimalSeparator,
    thousandsSeparator: profile.thousandsSeparator,
    negativeStyle: profile.negativeStyle,
    dateFormat: profile.dateFormat ?? 'dd.MM.yyyy',
    dateTimeFormat: profile.dateTimeFormat ?? 'dd.MM.yyyy HH:mm',
    timeFormat: profile.timeFormat ?? 'HH:mm',
    hourCycle: profile.hourCycle ?? 'h23',
    firstDayOfWeek: profile.firstDayOfWeek,
    timeZone: profile.timeZone ?? 'UTC',
    addressLayout: profile.addressLayout,
    defaultCountryCode: profile.defaultCountryCode ?? 'PL',
    subdivisionRequired: profile.subdivisionRequired,
    postalCodePattern: profile.postalCodePattern,
    postalCodeLabelKey: profile.postalCodeLabelKey,
    subdivisionLabelKey: profile.subdivisionLabelKey,
    addressLine2LabelKey: profile.addressLine2LabelKey,
    phoneNationalPattern: profile.phoneNationalPattern,
    phoneDefaultDialCode: profile.phoneDefaultDialCode,
    measurementSystem: profile.measurementSystem,
    defaultWeightUnit: profile.defaultWeightUnit,
    defaultLengthUnit: profile.defaultLengthUnit,
    lengthDisplay: profile.lengthDisplay,
    paperSize: profile.paperSize,
    pricePresentation: profile.pricePresentation,
    taxLineLabelKey: profile.taxLineLabelKey,
    taxNoteKey: profile.taxNoteKey,
  }
}

/**
 * Write the organization's profile row from a seed template, idempotently.
 *
 * Called when a market is actually picked - at onboarding, or from the settings page. Never called
 * as a blanket upgrade backfill: an organization with no row renders exactly as it did before the
 * market module existed, which is the promise assumption A5 makes.
 */
export async function ensureMarketDisplayProfile(
  em: EntityManager,
  scope: MarketScope,
  code: MarketTemplateCode | string,
): Promise<MarketDisplayProfile | null> {
  const template = getMarketTemplate(code)
  if (!template) return null

  const existing = await em.findOne(MarketDisplayProfile, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })
  if (existing) {
    // Re-running onboarding must not silently overwrite a market the admin has since tuned.
    if (existing.deletedAt) {
      Object.assign(existing, templateToRowValues(template), { deletedAt: null, isActive: true })
      await em.flush()
    }
    return existing
  }

  const now = new Date()
  const created = em.create(MarketDisplayProfile, {
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...templateToRowValues(template),
  })
  await em.flush()
  return created
}
