import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  runCrudFormRoundTrip,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence'

/**
 * TC-BR-CRUDFORM-001: Business rule CrudForm persists scalars + JSON condition/actions (#2466, #2560).
 *
 * `business_rules` is a Tier B surface (hand-written routes, not `makeCrudRoute`). The rule form
 * is the rich JSON surface: scalars (ruleId, ruleName, description, ruleType, ruleCategory,
 * entityType, eventType, enabled, priority, version), two effective-date fields, the jsonb
 * `conditionExpression`, and the `successActions` / `failureActions` jsonb arrays. There are no
 * custom fields or dictionary refs on this module (`ce.ts` is empty), so this spec proves the
 * scalar + JSON round-trip on both create and update.
 *
 * Verified contract (differs from the makeCrud surfaces):
 * - POST `/api/business_rules/rules` → 201 `{ id }`; PUT (collection, body carries `id`) → 200
 *   `{ ok: true }`; DELETE `?id=` → 200. Mirrors the create/edit CrudForm pages.
 * - Responses are **camelCase** (ruleName, ruleType, conditionExpression, …) — NOT snake_case.
 * - The list GET filters by `?id=` (single) and omits the jsonb fields, so read-back uses the
 *   detail GET `/api/business_rules/rules/{id}`, which returns the full record.
 * - PUT is a partial update (`em.assign`); the spec re-sends every editable field.
 * - Self-contained: the rule is created and deleted within the round-trip (cleanup `?id=`).
 *
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
const RULES_PATH = '/api/business_rules/rules'

async function readRuleDetail(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<CrudRecord | null> {
  const response = await apiRequest(request, 'GET', `${RULES_PATH}/${encodeURIComponent(id)}`, { token })
  expect(response.status(), `read-back rule detail failed: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<CrudRecord>(response)
  return body && body.id === id ? body : null
}

test.describe('TC-BR-CRUDFORM-001: Business rule CrudForm persists scalars + JSON condition/actions', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled()
  })

  test('round-trips scalars, conditionExpression, success/failure actions, and effective dates on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const ruleKey = `QA_BR_CF_${stamp}`
    const entityType = `QaCrudFormEntity${stamp}`

    await runCrudFormRoundTrip({
      request,
      token,
      collectionPath: RULES_PATH,
      readById: (id) => readRuleDetail(request, token, id),
      create: {
        payload: {
          ruleId: ruleKey,
          ruleName: `QA CRUDFORM Rule ${stamp}`,
          description: 'Original rule description',
          ruleType: 'VALIDATION',
          ruleCategory: 'qa-crudform',
          entityType,
          eventType: 'beforeSave',
          conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
          successActions: [{ type: 'LOG', config: { message: 'Original success', level: 'info' } }],
          failureActions: [{ type: 'BLOCK_TRANSITION' }],
          enabled: true,
          priority: 250,
          version: 2,
          effectiveFrom: '2026-01-01T00:00:00.000Z',
          effectiveTo: '2026-12-31T00:00:00.000Z',
        },
      },
      expectAfterCreate: {
        scalars: {
          ruleId: ruleKey,
          ruleName: `QA CRUDFORM Rule ${stamp}`,
          description: 'Original rule description',
          ruleType: 'VALIDATION',
          ruleCategory: 'qa-crudform',
          entityType,
          eventType: 'beforeSave',
          conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
          successActions: [{ type: 'LOG', config: { message: 'Original success', level: 'info' } }],
          failureActions: [{ type: 'BLOCK_TRANSITION' }],
          enabled: true,
          priority: 250,
          version: 2,
          effectiveFrom: '2026-01-01T00:00:00.000Z',
          effectiveTo: '2026-12-31T00:00:00.000Z',
        },
      },
      update: {
        payload: (id) => ({
          id,
          ruleName: `QA CRUDFORM Rule ${stamp} EDITED`,
          description: 'Updated rule description',
          ruleType: 'GUARD',
          ruleCategory: 'qa-crudform-edited',
          entityType,
          eventType: 'afterSave',
          conditionExpression: { field: 'state', operator: '!=', value: 'ARCHIVED' },
          successActions: [{ type: 'SHOW_INFO', config: { message: 'Updated success' } }],
          failureActions: [{ type: 'SHOW_ERROR', config: { message: 'Updated failure' } }],
          enabled: false,
          priority: 500,
          version: 3,
          effectiveFrom: '2026-02-01T00:00:00.000Z',
          effectiveTo: '2026-11-30T00:00:00.000Z',
        }),
      },
      expectAfterUpdate: {
        scalars: {
          ruleId: ruleKey,
          ruleName: `QA CRUDFORM Rule ${stamp} EDITED`,
          description: 'Updated rule description',
          ruleType: 'GUARD',
          ruleCategory: 'qa-crudform-edited',
          entityType,
          eventType: 'afterSave',
          conditionExpression: { field: 'state', operator: '!=', value: 'ARCHIVED' },
          successActions: [{ type: 'SHOW_INFO', config: { message: 'Updated success' } }],
          failureActions: [{ type: 'SHOW_ERROR', config: { message: 'Updated failure' } }],
          enabled: false,
          priority: 500,
          version: 3,
          effectiveFrom: '2026-02-01T00:00:00.000Z',
          effectiveTo: '2026-11-30T00:00:00.000Z',
        },
      },
    })
  })
})
