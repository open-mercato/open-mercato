import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import {
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
  deleteEntityIfExists,
} from '@open-mercato/core/helpers/integration/crmFixtures'
import {
  expectOperation,
  redoOk,
  skipIfUndoTestsDisabled,
  undoOk,
} from '@open-mercato/core/helpers/integration/undoHarness'

/**
 * TC-UNDO-008: deal undo/redo never restores a pipeline stage that was deleted in the meantime.
 *
 * Stage deletion only checks deals currently on the stage, and `customer_deals.pipeline_stage_id`
 * has no foreign key. Undo/redo restored the snapshot's stage id verbatim, leaving the deal on a
 * stage that no longer exists; every later save echoing that id then failed with
 * `Pipeline stage not found`.
 */

const DEALS = '/api/customers/deals'
const STAGES = '/api/customers/pipeline-stages'
const PIPELINES = '/api/customers/pipelines'

type DealRow = { pipeline_id: string | null; pipeline_stage_id: string | null }

async function dealRow(dealId: string): Promise<DealRow | null> {
  return withClient(async (client) => {
    const result = await client.query<DealRow>(
      'select pipeline_id, pipeline_stage_id from customer_deals where id = $1',
      [dealId],
    )
    return result.rows[0] ?? null
  })
}

async function dealTitle(request: APIRequestContext, token: string, dealId: string): Promise<unknown> {
  const response = await apiRequest(request, 'GET', `${DEALS}/${encodeURIComponent(dealId)}`, { token })
  const body = (await readJsonSafe(response)) as { deal?: { title?: unknown } } | null
  expect(response.ok(), `GET deal failed: status ${response.status()}`).toBeTruthy()
  return body?.deal?.title
}

async function stageTransitions(dealId: string, stageId: string): Promise<string[]> {
  return withClient(async (client) => {
    const result = await client.query<{ fingerprint: string }>(
      `select id || '@' || transitioned_at::text || '@' || coalesce(deleted_at::text, '-') as fingerprint
         from customer_deal_stage_transitions where deal_id = $1 and stage_id = $2 order by id`,
      [dealId, stageId],
    )
    return result.rows.map((row) => row.fingerprint)
  })
}

async function deleteStageOk(request: APIRequestContext, token: string, stageId: string): Promise<void> {
  const response = await apiRequest(request, 'DELETE', STAGES, { token, data: { id: stageId } })
  const body = await readJsonSafe(response)
  expect(response.ok(), `delete stage failed: status ${response.status()} body ${JSON.stringify(body)}`).toBeTruthy()
}

async function createDealOk(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<{ dealId: string; logId: string; undoToken: string }> {
  const response = await apiRequest(request, 'POST', DEALS, { token, data })
  const body = (await readJsonSafe(response)) as { id?: string; dealId?: string } | null
  expect(response.ok(), `create deal failed: status ${response.status()} body ${JSON.stringify(body)}`).toBeTruthy()
  const operation = expectOperation(response, 'customers.deals.create')
  const dealId = operation.resourceId ?? body?.dealId ?? body?.id ?? null
  expect(dealId, 'create should yield a deal id').toBeTruthy()
  return { dealId: dealId as string, logId: operation.logId, undoToken: operation.undoToken }
}

async function setupPipeline(request: APIRequestContext, token: string, stamp: number) {
  const pipelineId = await createPipelineFixture(request, token, { name: `TC-UNDO-008 Pipeline ${stamp}` })
  const doomedStageId = await createPipelineStageFixture(request, token, {
    pipelineId,
    label: `TC-UNDO-008 Doomed ${stamp}`,
    order: 0,
  })
  const keptStageId = await createPipelineStageFixture(request, token, {
    pipelineId,
    label: `TC-UNDO-008 Kept ${stamp}`,
    order: 1,
  })
  return { pipelineId, doomedStageId, keptStageId }
}

async function cleanup(
  request: APIRequestContext,
  token: string,
  ids: { dealId: string | null; stageIds: string[]; pipelineId: string | null },
): Promise<void> {
  await deleteEntityIfExists(request, token, DEALS, ids.dealId)
  for (const stageId of ids.stageIds) await deleteEntityByBody(request, token, STAGES, stageId)
  await deleteEntityByBody(request, token, PIPELINES, ids.pipelineId)
}

test.describe('TC-UNDO-008 deal undo/redo with a deleted pipeline stage', () => {
  test.beforeEach(() => {
    skipIfUndoTestsDisabled()
  })

  test('update undo clears the stage instead of restoring the deleted one, and the deal stays editable', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const ids = { dealId: null as string | null, stageIds: [] as string[], pipelineId: null as string | null }
    try {
      const { pipelineId, doomedStageId, keptStageId } = await setupPipeline(request, token, stamp)
      ids.pipelineId = pipelineId
      ids.stageIds.push(doomedStageId, keptStageId)

      const created = await createDealOk(request, token, {
        title: `TC-UNDO-008 Update ${stamp}`,
        pipelineId,
        pipelineStageId: doomedStageId,
      })
      ids.dealId = created.dealId

      const moveRes = await apiRequest(request, 'PUT', DEALS, {
        token,
        data: { id: created.dealId, pipelineStageId: keptStageId },
      })
      expect(moveRes.ok(), `move deal failed: status ${moveRes.status()}`).toBeTruthy()
      const moveOp = expectOperation(moveRes, 'customers.deals.update')

      await deleteStageOk(request, token, doomedStageId)
      ids.stageIds = [keptStageId]
      const doomedTransitionsBeforeUndo = await stageTransitions(created.dealId, doomedStageId)

      await undoOk(request, token, moveOp.undoToken, 'undo deal stage move after stage deletion')

      const restored = await dealRow(created.dealId)
      expect(restored?.pipeline_stage_id, 'undo must not restore the deleted stage id').toBeNull()
      expect(restored?.pipeline_id, 'undo keeps the deal in its pipeline').toBe(pipelineId)
      expect(
        await stageTransitions(created.dealId, doomedStageId),
        'undo must not record a new transition into the deleted stage',
      ).toEqual(doomedTransitionsBeforeUndo)

      const pipelineOnlyRes = await apiRequest(request, 'PUT', DEALS, {
        token,
        data: { id: created.dealId, pipelineId },
      })
      const pipelineOnlyBody = await readJsonSafe(pipelineOnlyRes)
      expect(
        pipelineOnlyRes.ok(),
        `saving the restored deal's pipeline failed: status ${pipelineOnlyRes.status()} body ${JSON.stringify(pipelineOnlyBody)}`,
      ).toBeTruthy()

      const saveRes = await apiRequest(request, 'PUT', DEALS, {
        token,
        data: {
          id: created.dealId,
          title: `TC-UNDO-008 Update ${stamp} edited`,
          pipelineId: restored?.pipeline_id ?? null,
          ...(restored?.pipeline_stage_id ? { pipelineStageId: restored.pipeline_stage_id } : {}),
        },
      })
      const saveBody = await readJsonSafe(saveRes)
      expect(saveRes.ok(), `saving the restored deal failed: status ${saveRes.status()} body ${JSON.stringify(saveBody)}`).toBeTruthy()
      expect(await dealTitle(request, token, created.dealId)).toBe(`TC-UNDO-008 Update ${stamp} edited`)
    } finally {
      await cleanup(request, token, ids)
    }
  })

  test('delete undo restores the deal without the deleted stage', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const ids = { dealId: null as string | null, stageIds: [] as string[], pipelineId: null as string | null }
    try {
      const { pipelineId, doomedStageId, keptStageId } = await setupPipeline(request, token, stamp)
      ids.pipelineId = pipelineId
      ids.stageIds.push(doomedStageId, keptStageId)

      const created = await createDealOk(request, token, {
        title: `TC-UNDO-008 Delete ${stamp}`,
        pipelineId,
        pipelineStageId: doomedStageId,
      })
      ids.dealId = created.dealId

      const deleteRes = await apiRequest(request, 'DELETE', `${DEALS}?id=${encodeURIComponent(created.dealId)}`, { token })
      expect(deleteRes.ok(), `delete deal failed: status ${deleteRes.status()}`).toBeTruthy()
      const deleteOp = expectOperation(deleteRes, 'customers.deals.delete')

      await deleteStageOk(request, token, doomedStageId)
      ids.stageIds = [keptStageId]

      await undoOk(request, token, deleteOp.undoToken, 'undo deal delete after stage deletion')

      const restored = await dealRow(created.dealId)
      expect(restored, 'undo re-creates the deal').not.toBeNull()
      expect(restored?.pipeline_stage_id, 'undo must not restore the deleted stage id').toBeNull()
      expect(restored?.pipeline_id).toBe(pipelineId)
    } finally {
      await cleanup(request, token, ids)
    }
  })

  test('create redo re-creates the deal without the deleted stage', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const ids = { dealId: null as string | null, stageIds: [] as string[], pipelineId: null as string | null }
    try {
      const { pipelineId, doomedStageId, keptStageId } = await setupPipeline(request, token, stamp)
      ids.pipelineId = pipelineId
      ids.stageIds.push(doomedStageId, keptStageId)

      const created = await createDealOk(request, token, {
        title: `TC-UNDO-008 Redo ${stamp}`,
        pipelineId,
        pipelineStageId: doomedStageId,
      })
      ids.dealId = created.dealId

      await undoOk(request, token, created.undoToken, 'undo deal create')
      expect(await dealRow(created.dealId), 'undo create removes the deal').toBeNull()

      await deleteStageOk(request, token, doomedStageId)
      ids.stageIds = [keptStageId]

      await redoOk(request, token, created.logId, 'redo deal create after stage deletion')

      const restored = await dealRow(created.dealId)
      expect(restored, 'redo re-creates the deal').not.toBeNull()
      expect(restored?.pipeline_stage_id, 'redo must not restore the deleted stage id').toBeNull()
      expect(restored?.pipeline_id).toBe(pipelineId)
    } finally {
      await cleanup(request, token, ids)
    }
  })
})
