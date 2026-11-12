import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createPlaybookOrFail,
  createRule,
  deletePlaybookIfExists,
  listRules,
  readPlaybook,
  RULES_PATH,
  uniqueCode,
} from './helpers/reviewPlaybookFixtures'

export const integrationMeta = {
  dependsOnModules: ['documents'],
}

const ACTIVE_RULE_CAP = 200

test.describe('TC-DOC-PLAY-002: review rules CRUD', () => {
  test('keeps rule codes unique per playbook, bumps the version and enforces the active cap', async ({ request }) => {
    test.slow()
    let adminToken: string | null = null
    let playbookId: string | null = null
    let otherPlaybookId: string | null = null
    try {
      adminToken = await getAuthToken(request, 'admin')
      playbookId = await createPlaybookOrFail(request, adminToken, { code: uniqueCode('nda'), name: 'NDA rules' })
      otherPlaybookId = await createPlaybookOrFail(request, adminToken, { code: uniqueCode('msa'), name: 'Other rules' })
      const before = await readPlaybook(request, adminToken, playbookId)

      const missingPlaybook = await apiRequest(request, 'GET', RULES_PATH, { token: adminToken })
      expect(missingPlaybook.status(), 'listing rules without playbookId should be rejected').toBe(400)

      const first = await createRule(request, adminToken, playbookId, {
        code: 'NDA-3.1',
        title: 'Confidentiality term',
        position: 'Confidentiality lasts at most two years.',
        preferredWording: 'secret for two years',
        severity: 'blocking',
      })
      expect(first.response.status(), 'POST review rule should return 201').toBe(201)
      expect(first.body).toMatchObject({ playbookId, playbookVersion: 2 })

      const duplicate = await createRule(request, adminToken, playbookId, { code: 'NDA-3.1' })
      expect(duplicate.response.status(), 'duplicate rule code should be rejected').toBe(409)
      expect(duplicate.body?.code).toBe('documents.reviewPlaybooks.errors.ruleCodeTaken')

      const otherPlaybook = await createRule(request, adminToken, otherPlaybookId, { code: 'NDA-3.1' })
      expect(otherPlaybook.response.status(), 'same code in another playbook is allowed').toBe(201)

      const afterRule = await readPlaybook(request, adminToken, playbookId)
      expect(afterRule?.version).toBe(2)
      expect(afterRule?.updatedAt, 'rule changes keep the playbook lock token').toBe(before?.updatedAt)

      const rules = await listRules(request, adminToken, playbookId)
      expect(rules).toHaveLength(1)
      expect(rules[0]).toMatchObject({ code: 'NDA-3.1', severity: 'blocking', isActive: true })
      expect(typeof rules[0]?.updatedAt).toBe('string')

      for (let index = 1; index < ACTIVE_RULE_CAP; index += 1) {
        const rule = await createRule(request, adminToken, playbookId, { code: `CAP-${index}`, sortOrder: index })
        expect(rule.response.status(), `rule ${index} should be created`).toBe(201)
      }
      const overCap = await createRule(request, adminToken, playbookId, { code: 'CAP-over' })
      expect(overCap.response.status(), 'active rule cap should be enforced').toBe(422)
      expect(overCap.body?.code).toBe('documents.reviewPlaybooks.errors.ruleLimit')
      const inactive = await createRule(request, adminToken, playbookId, { code: 'CAP-draft', isActive: false })
      expect(inactive.response.status(), 'inactive rules do not count towards the cap').toBe(201)
    } finally {
      await deletePlaybookIfExists(request, adminToken, playbookId)
      await deletePlaybookIfExists(request, adminToken, otherPlaybookId)
    }
  })
})
