import { expect, test } from '@playwright/test'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { deleteWorkflowDefinitionIfExists } from '@open-mercato/core/helpers/integration/workflowsFixtures'
import { uniqueSuffix } from './helpers/explainApi'
import { DEAL_PROCESS_KEY } from './helpers/xrayApi'
import {
  DEAL_ACTOR_FEATURES,
  XRAY_ANALYTICS_BASE,
  cleanupXrayAnalyticsFixture,
  createXrayAnalyticsFixture,
  createXrayOrganization,
  createXrayRole,
  createXrayUser,
  seedDealProcess,
  xrayCall,
} from './helpers/xrayAnalyticsApi'

export const integrationMeta = {
  description: 'Variant → workflow draft needs the workflows module (draft validation and creation)',
  dependsOnModules: ['workflows'],
}

type VariantsBody = { n: number; items: Array<{ variantHash: string; activityKeys: string[]; cases: number }> }

type DraftActivity = { activityType: string; config: { commandId: string; input: Record<string, unknown> } }

type DraftCommand = { commandId: string; requiredFeatures: string[]; enabled?: boolean }

type DraftBody = {
  ok: boolean
  persisted: boolean
  payload: {
    workflowId: string
    enabled: boolean
    lifecycle: string
    definition: { steps: Array<{ stepId: string; stepType: string; activities?: DraftActivity[] }>; transitions: Array<{ fromStepId: string; toStepId: string }> }
  }
  activityStepMap: Record<string, string>
  skippedActivities: string[]
  commands: DraftCommand[]
  workflowIdAvailable: boolean
}

/**
 * TC-INS-X05: Process X-Ray variant → disabled workflow draft
 * Covers:
 *   - GET  /api/insights/xray/{processKey}/variants
 *   - POST /api/insights/xray/{processKey}/variants/{hash}/workflow-draft
 *   - POST /api/workflows/definitions, GET /api/workflows/definitions/{id}
 *
 * Six deals of three actors walk `open → qa_review → win` in an organization created for the
 * test. The visible variant becomes a validated, disabled draft (`enabled: false`,
 * `lifecycle: draft`, UPDATE_ENTITY activities of `customers.deals.update` only) that persists
 * nothing; creating it through the workflows API as the user yields a disabled definition. A
 * suppressed or unknown variant, a command that is not workflow-safe and an invalid hash are
 * refused.
 */
test.describe('TC-INS-X05: X-Ray variant workflow draft', () => {
  test('turns a visible variant into a disabled draft that the workflows API accepts', async ({ request }) => {
    test.slow()
    const fixture = createXrayAnalyticsFixture()
    let definitionId: string | null = null
    try {
      const organizationId = await createXrayOrganization(request, fixture, 'INS-X05')
      const adminToken = fixture.adminToken as string
      const actorRole = await createXrayRole(request, fixture, { label: 'INS-X05 actor', features: DEAL_ACTOR_FEATURES, organizations: [organizationId] })
      const actorTokens: string[] = []
      for (let index = 0; index < 3; index += 1) {
        actorTokens.push((await createXrayUser(request, fixture, { label: `INS-X05 actor ${index}`, organizationId, roleId: actorRole })).token)
      }
      await seedDealProcess(request, fixture, { organizationId, actorTokens, dealsPerActor: 2, label: 'INS-X05' })

      const variantsPath = `${XRAY_ANALYTICS_BASE}/${DEAL_PROCESS_KEY}/variants?window=30d`
      const variants = await xrayCall<VariantsBody>(request, adminToken, 'GET', variantsPath, { selectedOrgId: organizationId })
      expect(variants.status, `GET variants: ${variants.text}`).toBe(200)
      const variant = variants.body?.items.find((item) => item.activityKeys.includes('status:win'))
      expect(variant, 'the shared path of the six deals is a visible variant').toBeTruthy()
      expect(variant?.cases).toBe(6)
      expect(variant?.activityKeys.filter((key) => key === 'created' || key.startsWith('status:'))).toEqual(['created', 'status:open', 'status:qa_review', 'status:win'])

      const workflowId = `xray.qa.x05.${uniqueSuffix()}`.replace(/_/g, '-')
      const draftPath = `${XRAY_ANALYTICS_BASE}/${DEAL_PROCESS_KEY}/variants/${variant?.variantHash}/workflow-draft`
      const draft = await xrayCall<DraftBody>(request, adminToken, 'POST', draftPath, {
        selectedOrgId: organizationId,
        data: { commandId: 'customers.deals.update', window: '30d', workflowId },
      })
      expect(draft.status, `POST workflow-draft: ${draft.text}`).toBe(200)
      const body = draft.body as DraftBody
      expect(body).toEqual(expect.objectContaining({ ok: true, persisted: false, workflowIdAvailable: true }))
      expect(body.skippedActivities).toContain('created')
      expect(body.skippedActivities.filter((key) => key.startsWith('status:')), 'every status change is expressible').toEqual([])
      expect(body.payload).toEqual(expect.objectContaining({ workflowId, enabled: false, lifecycle: 'draft' }))
      const activities = body.payload.definition.steps.flatMap((step) => step.activities ?? [])
      expect(new Set(activities.map((activity) => activity.activityType))).toEqual(new Set(['UPDATE_ENTITY']))
      expect(activities.map((activity) => activity.config.input.status).filter((status) => status !== undefined)).toEqual(['open', 'qa_review', 'win'])
      expect(activities.every((activity) => activity.config.commandId === 'customers.deals.update' && activity.config.input.id === '{{context.recordId}}')).toBe(true)
      const stepIds = body.payload.definition.steps.map((step) => step.stepId)
      const statusSteps = ['status:open', 'status:qa_review', 'status:win'].map((key) => body.activityStepMap[key])
      expect(statusSteps.every((stepId) => typeof stepId === 'string' && stepIds.includes(stepId))).toBe(true)
      expect(statusSteps.map((stepId) => stepIds.indexOf(stepId))).toEqual([...statusSteps.map((stepId) => stepIds.indexOf(stepId))].sort((left, right) => left - right))
      expect(body.commands).toEqual([{ commandId: 'customers.deals.update', requiredFeatures: ['customers.deals.manage'], enabled: false }])
      const persisted = await withClient(async (client) => (await client.query('select id from workflow_definitions where workflow_id = $1', [workflowId])).rows)
      expect(persisted, 'the draft route persists nothing').toEqual([])

      const created = await xrayCall<{ data?: { id?: string } }>(request, adminToken, 'POST', '/api/workflows/definitions', { selectedOrgId: organizationId, data: body.payload })
      expect(created.status, `POST /api/workflows/definitions: ${created.text}`).toBe(201)
      definitionId = created.body?.data?.id ?? null
      expect(definitionId).toBeTruthy()
      const stored = await xrayCall<{ data?: { enabled?: boolean; workflowId?: string; definition?: { steps?: unknown[] } } }>(
        request, adminToken, 'GET', `/api/workflows/definitions/${definitionId}`, { selectedOrgId: organizationId },
      )
      expect(stored.status, `GET the created definition: ${stored.text}`).toBe(200)
      expect(stored.body?.data).toEqual(expect.objectContaining({ workflowId, enabled: false }))
      expect(stored.body?.data?.definition?.steps).toHaveLength(activities.length + 2)

      const again = await xrayCall<DraftBody>(request, adminToken, 'POST', draftPath, {
        selectedOrgId: organizationId,
        data: { commandId: 'customers.deals.update', window: '30d', workflowId },
      })
      expect(again.body?.workflowIdAvailable, 'a taken workflow id is reported before the create call would 409').toBe(false)

      const unsafe = await xrayCall(request, adminToken, 'POST', draftPath, { selectedOrgId: organizationId, data: { commandId: 'auth.users.delete' } })
      expect(unsafe.status, `a command that is not workflow-safe: ${unsafe.text}`).toBe(422)
      const unsafeIssues = (unsafe.body as { code?: string; issues?: Array<{ code: string; path: string }> } | null)
      expect(unsafeIssues?.code).toBe('workflow_draft_invalid')
      expect(unsafeIssues?.issues?.length ?? 0, 'one issue per generated UPDATE_ENTITY activity').toBe(activities.length)
      expect(unsafeIssues?.issues?.every((issue) => issue.code === 'command_not_workflow_safe' && issue.path.endsWith('.config.commandId'))).toBe(true)
      const unknown = await xrayCall(request, adminToken, 'POST', `${XRAY_ANALYTICS_BASE}/${DEAL_PROCESS_KEY}/variants/${'0'.repeat(64)}/workflow-draft`, {
        selectedOrgId: organizationId,
        data: { commandId: 'customers.deals.update' },
      })
      expect(unknown).toEqual(expect.objectContaining({ status: 404, body: expect.objectContaining({ code: 'variant_not_found' }) }))
      expect((await xrayCall(request, adminToken, 'POST', `${XRAY_ANALYTICS_BASE}/${DEAL_PROCESS_KEY}/variants/not-a-hash/workflow-draft`, {
        selectedOrgId: organizationId,
        data: { commandId: 'customers.deals.update' },
      })).status).toBe(400)
    } finally {
      await deleteWorkflowDefinitionIfExists(request, fixture.adminToken, definitionId)
      if (definitionId) {
        await withClient(async (client) => {
          await client.query('delete from workflow_definitions where id = $1', [definitionId])
        }).catch(() => undefined)
      }
      await cleanupXrayAnalyticsFixture(request, fixture)
    }
  })
})
