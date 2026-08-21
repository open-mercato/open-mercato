import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createBusinessRuleFixture,
  createRuleSetFixture,
  deleteBusinessRuleIfExists,
  deleteRuleSetIfExists,
} from '@open-mercato/core/helpers/integration/businessRulesFixtures'
import {
  assertScalarFieldsPersisted,
  skipIfCrudFormExtensionTestsDisabled,
  type CrudRecord,
} from '@open-mercato/core/helpers/integration/crudFormPersistence'

/**
 * TC-BR-CRUDFORM-002: Rule set CrudForm persists scalars + member rules (#2466, #2560).
 *
 * The rule-set edit page is a Tier B CrudForm: its `onSubmit` saves only the set scalars
 * (`PUT /api/business_rules/sets`), while the embedded `RuleSetMembers` component manages the
 * `members[]` collection through a **separate sub-resource** — add (`POST .../{id}/members`),
 * update sequence/enabled (`PUT .../{id}/members`), remove (`DELETE .../{id}/members?memberId=`).
 * Because members are interleaved with the scalar save, the shared `runCrudFormRoundTrip` (which
 * only POST/PUT/DELETEs the collection) does not fit, so this spec drives the same
 * create → read-back → assert → update → read-back → assert cycle inline, reusing the harness gate
 * and `assertScalarFieldsPersisted`.
 *
 * Verified contract:
 * - Sets: POST → 201 `{ id }`; PUT (collection, body carries `id`) → 200; DELETE `?id=` → 200.
 * - Detail GET `/api/business_rules/sets/{id}` returns the camelCase scalars plus `members[]`
 *   (each `{ id, ruleId, ruleName, ruleType, sequence, enabled }`), ordered by `sequence` asc.
 *   The list GET omits members, so read-back uses the detail GET.
 * - Members: POST → 201 `{ id }` (the member id); PUT/DELETE → 200. A rule may join a set once
 *   (unique `(ruleSet, rule)`); removal is a hard delete.
 * - Self-contained: creates three member rules + the set via the API, deletes all in `finally`.
 *
 * Gated by `OM_INTEGRATION_CRUDFORM_EXTENSION_TESTS_DISABLED` (default off → runs).
 */
const SETS_PATH = '/api/business_rules/sets'

type RuleSetMember = {
  id: string
  ruleId: string
  ruleName: string
  ruleType: string
  sequence: number
  enabled: boolean
}

type RuleSetDetail = CrudRecord & { members: RuleSetMember[] }

function buildMemberRule(stamp: number, suffix: string): CrudRecord {
  return {
    ruleId: `QA_BR_SET_MEM_${suffix}_${stamp}`,
    ruleName: `QA CRUDFORM Member ${suffix} ${stamp}`,
    ruleType: 'GUARD',
    entityType: `QaCrudFormSetEntity${stamp}`,
    eventType: 'beforeSave',
    conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
    enabled: true,
    priority: 100,
  }
}

async function readRuleSetDetail(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<RuleSetDetail> {
  const response = await apiRequest(request, 'GET', `${SETS_PATH}/${encodeURIComponent(id)}`, { token })
  expect(response.status(), `read-back rule set detail failed: ${response.status()}`).toBe(200)
  const body = await readJsonSafe<RuleSetDetail>(response)
  expect(body, `rule set ${id} should be readable`).toBeTruthy()
  return body as RuleSetDetail
}

async function addMember(
  request: APIRequestContext,
  token: string,
  setId: string,
  ruleId: string,
  sequence: number,
): Promise<string> {
  const response = await apiRequest(request, 'POST', `${SETS_PATH}/${setId}/members`, {
    token,
    data: { ruleId, sequence, enabled: true },
  })
  expect(response.status(), `add member ${ruleId} should be 201`).toBe(201)
  return expectId((await readJsonSafe<{ id?: string }>(response))?.id, 'member create should return an id')
}

function memberByRuleId(detail: RuleSetDetail, ruleId: string): RuleSetMember | undefined {
  return detail.members.find((member) => member.ruleId === ruleId)
}

test.describe('TC-BR-CRUDFORM-002: Rule set CrudForm persists scalars + members on create and update', () => {
  test.beforeAll(() => {
    skipIfCrudFormExtensionTestsDisabled()
  })

  test('round-trips set scalars and member rules (add/update/remove) on create and update', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const setKey = `QA_BR_SET_${stamp}`
    let setRecordId: string | null = null
    let ruleAId: string | null = null
    let ruleBId: string | null = null
    let ruleCId: string | null = null

    try {
      ruleAId = await createBusinessRuleFixture(request, token, buildMemberRule(stamp, 'A'))
      ruleBId = await createBusinessRuleFixture(request, token, buildMemberRule(stamp, 'B'))
      ruleCId = await createBusinessRuleFixture(request, token, buildMemberRule(stamp, 'C'))

      // CREATE — set scalars, then members added through the sub-resource (mirrors the form).
      setRecordId = await createRuleSetFixture(request, token, {
        setId: setKey,
        setName: `QA CRUDFORM Rule Set ${stamp}`,
        description: 'Original set description',
        enabled: true,
      })
      const memberAId = await addMember(request, token, setRecordId, ruleAId, 0)
      await addMember(request, token, setRecordId, ruleBId, 1)

      // READ-BACK after create — scalars + members[] both persisted.
      const afterCreate = await readRuleSetDetail(request, token, setRecordId)
      assertScalarFieldsPersisted(
        afterCreate,
        {
          setId: setKey,
          setName: `QA CRUDFORM Rule Set ${stamp}`,
          description: 'Original set description',
          enabled: true,
        },
        'after-create',
      )
      expect(afterCreate.members.map((member) => member.ruleId).sort()).toEqual([ruleAId, ruleBId].sort())
      const createdMemberA = memberByRuleId(afterCreate, ruleAId)
      expect(createdMemberA?.sequence, 'member A sequence should persist').toBe(0)
      expect(createdMemberA?.enabled, 'member A enabled should persist').toBe(true)
      expect(createdMemberA?.ruleName, 'member A rule name should resolve').toBe(`QA CRUDFORM Member A ${stamp}`)
      expect(memberByRuleId(afterCreate, ruleBId)?.sequence, 'member B sequence should persist').toBe(1)

      // UPDATE — set scalars, then mutate members: add C, reorder/disable A, remove B.
      const updateResponse = await apiRequest(request, 'PUT', SETS_PATH, {
        token,
        data: {
          id: setRecordId,
          setName: `QA CRUDFORM Rule Set ${stamp} EDITED`,
          description: 'Updated set description',
          enabled: false,
        },
      })
      expect(updateResponse.status(), 'rule set update should be 200').toBe(200)

      await addMember(request, token, setRecordId, ruleCId, 2)
      const memberAUpdate = await apiRequest(request, 'PUT', `${SETS_PATH}/${setRecordId}/members`, {
        token,
        data: { memberId: memberAId, sequence: 5, enabled: false },
      })
      expect(memberAUpdate.status(), 'member A update should be 200').toBe(200)
      const memberBRemoval = await apiRequest(
        request,
        'DELETE',
        `${SETS_PATH}/${setRecordId}/members?memberId=${encodeURIComponent(
          memberByRuleId(afterCreate, ruleBId)!.id,
        )}`,
        { token },
      )
      expect(memberBRemoval.status(), 'member B removal should be 200').toBe(200)

      // READ-BACK after update — scalars + mutated members[] both persisted.
      const afterUpdate = await readRuleSetDetail(request, token, setRecordId)
      assertScalarFieldsPersisted(
        afterUpdate,
        {
          setId: setKey,
          setName: `QA CRUDFORM Rule Set ${stamp} EDITED`,
          description: 'Updated set description',
          enabled: false,
        },
        'after-update',
      )
      expect(afterUpdate.members.map((member) => member.ruleId).sort()).toEqual([ruleAId, ruleCId].sort())
      expect(memberByRuleId(afterUpdate, ruleBId), 'removed member B should be gone').toBeUndefined()
      const updatedMemberA = memberByRuleId(afterUpdate, ruleAId)
      expect(updatedMemberA?.sequence, 'member A reordered sequence should persist').toBe(5)
      expect(updatedMemberA?.enabled, 'member A disabled flag should persist').toBe(false)
      expect(memberByRuleId(afterUpdate, ruleCId)?.sequence, 'member C sequence should persist').toBe(2)
      // Detail GET orders members by sequence asc → C (2) precedes A (5).
      expect(afterUpdate.members.map((member) => member.ruleId)).toEqual([ruleCId, ruleAId])
    } finally {
      await deleteRuleSetIfExists(request, token, setRecordId)
      await deleteBusinessRuleIfExists(request, token, ruleAId)
      await deleteBusinessRuleIfExists(request, token, ruleBId)
      await deleteBusinessRuleIfExists(request, token, ruleCId)
    }
  })
})
