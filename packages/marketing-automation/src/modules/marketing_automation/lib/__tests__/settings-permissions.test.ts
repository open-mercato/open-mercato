import { canImportSuppressionList, SUPPRESSION_IMPORT_FEATURE } from '../settings-permissions'
import { metadata as consentImportRouteMetadata } from '../../api/consent/import/route'

/**
 * The root cause this guards: the settings screen showed the suppression-import file picker to
 * anyone with `campaigns.manage`, but the endpoint it posts to (`api/consent/import/route.ts`)
 * requires `consent.manage` — a SEPARATE grant on purpose (see `acl.ts`), so a campaign author
 * without consent rights saw a working-looking control that always answered 403. This asserts the
 * gate and the API it guards can never drift apart silently again.
 */
describe('the suppression-import permission gate', () => {
  test('requires exactly the feature the consent-import API itself requires', () => {
    expect(consentImportRouteMetadata.POST.requireFeatures).toEqual([SUPPRESSION_IMPORT_FEATURE])
  })

  test('is false without the feature and true with it', () => {
    expect(canImportSuppressionList([])).toBe(false)
    expect(canImportSuppressionList(['marketing_automation.campaigns.manage'])).toBe(false)
    expect(canImportSuppressionList([SUPPRESSION_IMPORT_FEATURE])).toBe(true)
  })

  test('respects the wildcard a role grant can carry', () => {
    expect(canImportSuppressionList(['marketing_automation.*'])).toBe(true)
  })
})
