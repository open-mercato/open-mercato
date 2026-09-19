import { marketDisplayProfileCreateSchema } from '../data/validators'
import { templateToRowValues } from '../lib/seeds'
import { getMarketTemplate, US_DISPLAY_TEMPLATE, EU_DISPLAY_TEMPLATE } from '@open-mercato/shared/lib/display/templates'

/**
 * Mirrors `withTemplateDefaults` in `commands/display-profile.ts`.
 *
 * Kept in the test rather than exported from the command module so the command file stays a
 * command file; the behaviour it guards is the API contract that `code` is the only required field.
 */
function withTemplateDefaults(input: Record<string, unknown>): Record<string, unknown> {
  const template = getMarketTemplate(typeof input.code === 'string' ? input.code : null)
  if (!template) return input
  const merged: Record<string, unknown> = { ...templateToRowValues(template) }
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) merged[key] = value
  }
  return merged
}

describe('market display profile create payload', () => {
  it('accepts a one-field request, which is what picking a market posts', () => {
    const parsed = marketDisplayProfileCreateSchema.safeParse(withTemplateDefaults({ code: 'us' }))
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.name).toBe('United States')
    expect(parsed.data.dateFormat).toBe('MM/dd/yyyy')
    expect(parsed.data.paperSize).toBe('letter')
    expect(parsed.data.firstDayOfWeek).toBe(0)
    expect(parsed.data.pricePresentation).toBe('single_price_plus_tax')
  })

  it('seeds the EU template the same way', () => {
    const parsed = marketDisplayProfileCreateSchema.safeParse(withTemplateDefaults({ code: 'eu' }))
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.paperSize).toBe('a4')
    expect(parsed.data.firstDayOfWeek).toBe(1)
    expect(parsed.data.pricePresentation).toBe('dual_net_gross')
  })

  it('lets an explicit field win over the template', () => {
    const parsed = marketDisplayProfileCreateSchema.safeParse(
      withTemplateDefaults({ code: 'us', paperSize: 'legal', firstDayOfWeek: 1 }),
    )
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.data.paperSize).toBe('legal')
    expect(parsed.data.firstDayOfWeek).toBe(1)
    // Untouched fields still come from the template.
    expect(parsed.data.dateFormat).toBe('MM/dd/yyyy')
  })

  it('passes an unknown market through so validation names the missing fields', () => {
    const parsed = marketDisplayProfileCreateSchema.safeParse(withTemplateDefaults({ code: 'ca' }))
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    const missing = parsed.error.issues.map((issue) => issue.path.join('.'))
    expect(missing).toContain('name')
    expect(missing).toContain('dateFormat')
  })

  it('rejects a postal code pattern that is not anchored, and an unknown time zone', () => {
    const unanchored = marketDisplayProfileCreateSchema.safeParse(
      withTemplateDefaults({ code: 'us', postalCodePattern: '\\d{5}' }),
    )
    expect(unanchored.success).toBe(false)

    const badZone = marketDisplayProfileCreateSchema.safeParse(
      withTemplateDefaults({ code: 'us', timeZone: 'Mars/Olympus_Mons' }),
    )
    expect(badZone.success).toBe(false)
  })

  it('maps every template field onto a stored row value', () => {
    for (const template of [US_DISPLAY_TEMPLATE, EU_DISPLAY_TEMPLATE]) {
      const row = templateToRowValues(template)
      expect(row.code).toBe(template.code)
      expect(row.timeZone).toBe(template.timeZone)
      expect(row.taxLineLabelKey).toBe(template.taxLineLabelKey)
      // Nothing may arrive as `undefined`: the column set is NOT NULL for every required field.
      for (const [key, value] of Object.entries(row)) {
        expect([key, value]).not.toEqual([key, undefined])
      }
    }
  })
})
