import { expect, test } from '@playwright/test'
import {
  createPipelineFixture,
  createPipelineStageFixture,
  deleteEntityByBody,
  readJsonSafe,
} from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'

/**
 * TC-CRM-2453-PIPELINE-STAGE: Pipeline-stage update persists label/color (#2453 sibling)
 *
 * `updatePipelineStageCommand` mutates the stage `label` scalar and then — still
 * inside the same `withAtomicFlush` — calls `ensureDictionaryEntry`, whose
 * `em.findOne` is an interleaved read on the same EntityManager. Under MikroORM
 * v7 that read dropped the still-pending scalar changeset, so the PUT returned
 * 200 with `updated_at` bumped while the new `label` was never persisted. The
 * dictionary entry (which backs the stage's color/icon in the GET response) also
 * needs that read to run with the committed label. The fix flushes the scalar
 * mutation before `ensureDictionaryEntry` runs.
 *
 * The trigger that reproduces the bug: send a PUT that changes `label` AND
 * `color`, which is exactly the condition (`label/color/icon` present) under
 * which the command runs `ensureDictionaryEntry`'s interleaved findOne. We then
 * re-fetch via GET and assert both the renamed label and the color round-trip —
 * not just that the status was 200.
 */
const STAGES_PATH = '/api/customers/pipeline-stages'

type StageItem = {
  id: string
  label?: string | null
  color?: string | null
  icon?: string | null
}

async function fetchStage(
  request: import('@playwright/test').APIRequestContext,
  token: string,
  pipelineId: string,
  stageId: string,
): Promise<StageItem | undefined> {
  const response = await apiRequest(request, 'GET', `${STAGES_PATH}?pipelineId=${encodeURIComponent(pipelineId)}`, {
    token,
  })
  expect(response.ok(), `Failed to list pipeline stages: ${response.status()}`).toBeTruthy()
  const body = (await readJsonSafe(response)) as { items?: StageItem[] }
  return (body.items ?? []).find((item) => item.id === stageId)
}

test('TC-CRM-2453-PIPELINE-STAGE: updating a stage label+color persists the changed columns', async ({
  request,
}) => {
  const token = await getAuthToken(request, 'admin')
  let pipelineId: string | null = null
  let stageId: string | null = null

  try {
    const stamp = Date.now()
    pipelineId = await createPipelineFixture(request, token, { name: `TC2453 Pipeline ${stamp}` })
    stageId = await createPipelineStageFixture(request, token, {
      pipelineId,
      label: `TC2453 Original ${stamp}`,
      order: 0,
    })

    const edits = {
      label: `TC2453 Renamed ${stamp}`,
      color: '#123abc',
    }

    // PUT changes the label scalar AND color — sending label/color is what forces
    // ensureDictionaryEntry to run its interleaved em.findOne, the read that
    // previously dropped the scalar changeset.
    const putResponse = await apiRequest(request, 'PUT', STAGES_PATH, {
      token,
      data: {
        id: stageId,
        ...edits,
      },
    })
    expect(putResponse.status(), 'pipeline-stage PUT should succeed').toBe(200)
    const putBody = (await readJsonSafe(putResponse)) as { ok?: boolean }
    expect(putBody.ok, 'pipeline-stage PUT body should report ok').toBe(true)

    const after = await fetchStage(request, token, pipelineId, stageId)
    expect(after, 'updated stage should still be returned').toBeTruthy()

    // The interleaved-read fix: the renamed label scalar must round-trip, and the
    // dictionary-backed color must reflect the committed value.
    expect(after?.label, 'label should persist').toBe(edits.label)
    expect(after?.color, 'color should persist').toBe(edits.color)
  } finally {
    await deleteEntityByBody(request, token, STAGES_PATH, stageId)
    await deleteEntityByBody(request, token, '/api/customers/pipelines', pipelineId)
  }
})
