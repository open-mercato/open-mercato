import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  DEAL_RESOURCE_KIND,
  DEAL_UPDATE_COMMAND_ID,
  createDealTextFieldDefinition,
  createQaDeal,
  deleteDealFieldDefinitionIfExists,
  deleteQaDealIfExists,
  explainFieldOk,
  explainRecord,
  updateQaDeal,
  uniqueSuffix,
  type ExplainOverviewBody,
} from './helpers/explainApi'

export const integrationMeta = {
  dependsOnModules: ['entities'],
}

/**
 * TC-INS-014: Custom fields are explained through `cf:<key>`
 * Covers:
 *   - POST /api/entities/definitions (deal text field)
 *   - POST /api/customers/deals, PUT /api/customers/deals (customFields)
 *   - GET  /api/insights/explain?field=cf:<key> and the record overview
 *
 * A deal custom field changed through the API is explained like a declared field:
 * the chain carries the old and new custom value caused by the user, the overview
 * lists the field, and an undeclared non-custom field is rejected with 400.
 */
test.describe('TC-INS-014: explain a deal custom field', () => {
  test('explains cf:<key> with the custom value history', async ({ request }) => {
    let token: string | null = null
    let dealId: string | null = null
    let fieldKey: string | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const suffix = uniqueSuffix()
      fieldKey = `qa_ins014_${suffix}`
      await createDealTextFieldDefinition(request, token, fieldKey)
      dealId = await createQaDeal(request, token, {
        title: `QA INS-014 ${suffix}`,
        status: 'open',
        customFields: { [fieldKey]: 'alpha' },
      })
      await updateQaDeal(request, token, dealId, { customFields: { [fieldKey]: 'beta' } })

      const field = `cf:${fieldKey}`
      const body = await explainFieldOk(request, token, { resourceKind: DEAL_RESOURCE_KIND, resourceId: dealId, field })
      expect(body.field).toBe(field)
      expect(body.current).toEqual(expect.objectContaining({ value: 'beta', valueKind: 'custom_field' }))
      expect(body.verdict).toBe('explained')
      expect(body.confidence).toBe('proven')

      const newest = body.chain[0]
      expect(newest.commandId).toBe(DEAL_UPDATE_COMMAND_ID)
      expect(newest.from?.value).toBe('alpha')
      expect(newest.to?.value).toBe('beta')
      expect(newest.cause.kind).toBe('user')
      expect(newest.confidence).toBe('proven')

      const overview = await explainRecord<ExplainOverviewBody>(request, token, {
        resourceKind: DEAL_RESOURCE_KIND,
        resourceId: dealId,
      })
      expect(overview.status, `overview should return 200: ${overview.text}`).toBe(200)
      const overviewField = overview.body?.fields.find((candidate) => candidate.field === field)
      expect(overviewField, 'the overview lists the custom field').toEqual(expect.objectContaining({
        valueKind: 'custom_field',
        verdict: 'explained',
      }))

      const unknownField = await explainRecord(request, token, {
        resourceKind: DEAL_RESOURCE_KIND,
        resourceId: dealId,
        field: `qa_not_declared_${suffix}`,
      })
      expect(unknownField.status, 'an undeclared field is rejected').toBe(400)
      expect(unknownField.body).toEqual({ error: 'unknown_field' })
    } finally {
      await deleteQaDealIfExists(request, token, dealId)
      await deleteDealFieldDefinitionIfExists(request, token, fieldKey)
    }
  })
})
