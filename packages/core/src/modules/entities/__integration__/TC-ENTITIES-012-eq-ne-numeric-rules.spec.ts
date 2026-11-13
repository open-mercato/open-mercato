import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createCustomEntity,
  deleteCustomEntityIfExists,
  deleteRecordIfExists,
  saveFieldDefinitions,
  uniqueEntityId,
} from './helpers/entitiesApi'

const FIELD_KEYS = ['qty_eq', 'qty_ne'] as const

test.describe('TC-ENTITIES-012: eq/ne rules on integer custom fields compare numerically', () => {
  test('a number value is matched against the string param the field editor saves', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const entityId = uniqueEntityId('eq_ne_numeric')
    const recordIds: string[] = []
    try {
      const entity = await createCustomEntity(request, token, { entityId, label: 'QA eq/ne numeric rules' })
      expect(entity.status()).toBe(200)
      const fields = await saveFieldDefinitions(request, token, entityId, [
        {
          key: 'qty_eq',
          kind: 'integer',
          configJson: { label: 'Qty eq', validation: [{ rule: 'eq', param: '5', message: 'qty_eq must be 5' }] },
        },
        {
          key: 'qty_ne',
          kind: 'integer',
          configJson: { label: 'Qty ne', validation: [{ rule: 'ne', param: '5', message: 'qty_ne must not be 5' }] },
        },
      ])
      expect(fields.status()).toBe(200)

      const createRecord = (values: Record<string, number>) => {
        const recordId = randomUUID()
        recordIds.push(recordId)
        return apiRequest(request, 'POST', '/api/entities/records', { token, data: { entityId, recordId, values } })
      }

      const accepted = await createRecord({ qty_eq: 5, qty_ne: 6 })
      expect(accepted.status()).toBe(200)

      const eqViolation = await createRecord({ qty_eq: 4 })
      expect(eqViolation.status()).toBe(400)
      expect(await eqViolation.json()).toMatchObject({ fields: { cf_qty_eq: 'qty_eq must be 5' } })

      const neViolation = await createRecord({ qty_ne: 5 })
      expect(neViolation.status()).toBe(400)
      expect(await neViolation.json()).toMatchObject({ fields: { cf_qty_ne: 'qty_ne must not be 5' } })
    } finally {
      for (const recordId of recordIds) {
        await deleteRecordIfExists(request, token, entityId, recordId)
      }
      for (const key of FIELD_KEYS) {
        await apiRequest(request, 'DELETE', '/api/entities/definitions', { token, data: { entityId, key } }).catch(() => undefined)
      }
      await deleteCustomEntityIfExists(request, token, entityId)
    }
  })
})
