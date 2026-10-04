/**
 * Prompt-to-draft API (spec section 9).
 *
 * The route is the trust boundary, so these assertions pin it: it PERSISTS
 * NOTHING on any path, it never resolves the definition as enabled or
 * published, refusals are structured 200s rather than stack traces, and a
 * missing AI provider is reported plainly instead of silently doing nothing.
 *
 * The model is stubbed at `lib/ai-draft-runner` — the ONE seam between this
 * module and the AI runtime — so no test path can reach a real provider.
 */

import { NextRequest } from 'next/server'
import { POST as generateDraft } from '../definitions/generate/route'

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

jest.mock('../../lib/ai-draft-runner', () => ({
  resolveWorkflowDraftRunner: jest.fn(),
}))

const VALID_GENERATION = {
  summary: 'Routes refunds over 500 through a manager approval.',
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    { stepId: 'approve', stepName: 'Approve refund', stepType: 'USER_TASK' },
    { stepId: 'end', stepName: 'End', stepType: 'END' },
  ],
  transitions: [
    { transitionId: 't_1', fromStepId: 'start', toStepId: 'approve', trigger: 'auto' },
    { transitionId: 't_2', fromStepId: 'approve', toStepId: 'end', trigger: 'auto' },
  ],
}

describe('POST /api/workflows/definitions/generate', () => {
  const tenantId = 'tenant-1'
  const organizationId = 'org-1'
  const userId = 'user-1'

  let emFactory: jest.Mock
  let userHasAllFeatures: jest.Mock

  const setRunner = (runner: unknown) => {
    const { resolveWorkflowDraftRunner } = require('../../lib/ai-draft-runner')
    resolveWorkflowDraftRunner.mockResolvedValue(runner)
  }

  beforeEach(() => {
    jest.clearAllMocks()
    userHasAllFeatures = jest.fn().mockResolvedValue(true)
    // Resolving an EntityManager at all would be the first symptom of this
    // route learning to write; nothing here should ask for one.
    emFactory = jest.fn(() => {
      throw new Error('the generate route must never touch the database')
    })

    const container = {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return emFactory()
        if (name === 'rbacService') {
          return {
            userHasAllFeatures,
            loadAcl: jest.fn().mockResolvedValue({ features: ['workflows.*'], isSuperAdmin: false }),
          }
        }
        return null
      }),
    }

    const { createRequestContainer } = require('@open-mercato/shared/lib/di/container')
    createRequestContainer.mockResolvedValue(container)

    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue({ sub: userId, tenantId, orgId: organizationId })

    const {
      resolveOrganizationScopeForRequest,
    } = require('@open-mercato/core/modules/directory/utils/organizationScope')
    resolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: organizationId })
  })

  const run = async (body: Record<string, unknown>) => {
    const request = new NextRequest('http://localhost/api/workflows/definitions/generate', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    const response = await generateDraft(request)
    return { response, data: await response.json() }
  }

  test('reports "unavailable" as a structured 200 when no AI runtime is present', async () => {
    setRunner(null)

    const { response, data } = await run({ prompt: 'Approve refunds over 500' })

    expect(response.status).toBe(200)
    expect(data).toEqual({ ok: false, reason: 'unavailable' })
    expect(data.definition).toBeUndefined()
    expect(emFactory).not.toHaveBeenCalled()
  })

  test('reports "unavailable" when the runtime answers a not-configured error code', async () => {
    setRunner(
      jest.fn().mockRejectedValue(
        Object.assign(new Error('No LLM provider is configured.'), {
          code: 'no_provider_configured',
        }),
      ),
    )

    const { response, data } = await run({ prompt: 'Approve refunds over 500' })

    expect(response.status).toBe(200)
    expect(data.ok).toBe(false)
    expect(data.reason).toBe('unavailable')
    // The provider's own wording is not surfaced for an unavailable feature —
    // the surface says "not configured", which is what an author can act on.
    expect(data.message).toBeUndefined()
  })

  test('reports "failed" with the reason when the model call errors', async () => {
    setRunner(jest.fn().mockRejectedValue(new Error('rate limited')))

    const { response, data } = await run({ prompt: 'Approve refunds over 500' })

    expect(response.status).toBe(200)
    expect(data.ok).toBe(false)
    expect(data.reason).toBe('failed')
    expect(data.message).toContain('rate limited')
    expect(data.definition).toBeUndefined()
  })

  test('refuses a response that is not a workflow instead of returning half of one', async () => {
    setRunner(jest.fn().mockResolvedValue({ summary: 'nothing useful' }))

    const { data } = await run({ prompt: 'Approve refunds over 500' })

    expect(data.ok).toBe(false)
    expect(data.reason).toBe('malformedResponse')
    expect(Array.isArray(data.messages)).toBe(true)
    expect(data.definition).toBeUndefined()
  })

  test('refuses a generation the definition schema rejects', async () => {
    setRunner(
      jest.fn().mockResolvedValue({
        ...VALID_GENERATION,
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'NOT_A_STEP_TYPE' },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
      }),
    )

    const { data } = await run({ prompt: 'Approve refunds over 500' })

    expect(data.ok).toBe(false)
    expect(data.reason).toBe('schemaError')
    expect(data.definition).toBeUndefined()
  })

  test('returns the draft with its Problems pass, and persists nothing', async () => {
    const runner = jest.fn().mockResolvedValue(VALID_GENERATION)
    setRunner(runner)

    const { response, data } = await run({ prompt: 'Approve refunds over 500' })

    expect(response.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.summary).toBe(VALID_GENERATION.summary)
    expect(data.definition.steps).toHaveLength(3)
    expect(Array.isArray(data.problems)).toBe(true)
    expect(typeof data.errorCount).toBe('number')
    expect(typeof data.warningCount).toBe('number')

    // Never auto-published: the response carries no id, no version, no enabled
    // flag, because no row was created for it to describe.
    expect(data.definitionId).toBeUndefined()
    expect(data.enabled).toBeUndefined()
    expect(data.published).toBeUndefined()
    expect(emFactory).not.toHaveBeenCalled()
  })

  test('hands the runner the real catalogs, not a hand-maintained list', async () => {
    const runner = jest.fn().mockResolvedValue(VALID_GENERATION)
    setRunner(runner)

    await run({ prompt: 'Approve refunds over 500' })

    const prompt = runner.mock.calls[0][0].prompt as string
    expect(prompt).toContain('Approve refunds over 500')
    // Registered by `lib/activity-registry-bootstrap`, which the route imports.
    expect(prompt).toContain('SEND_EMAIL')
    expect(prompt).toContain('USER_TASK')
    expect(runner.mock.calls[0][0].agentId).toBe('workflows.workflow_author')
  })

  test('scopes the run to the caller tenant and organization', async () => {
    const runner = jest.fn().mockResolvedValue(VALID_GENERATION)
    setRunner(runner)

    await run({ prompt: 'Approve refunds over 500' })

    expect(runner.mock.calls[0][0].authContext).toMatchObject({
      tenantId,
      organizationId,
      userId,
    })
  })

  test('refuses without the create feature, before any model is reached', async () => {
    const runner = jest.fn()
    setRunner(runner)
    userHasAllFeatures.mockResolvedValue(false)

    const { response } = await run({ prompt: 'Approve refunds over 500' })

    expect(response.status).toBe(403)
    expect(runner).not.toHaveBeenCalled()
  })

  test('refuses an empty prompt', async () => {
    const runner = jest.fn()
    setRunner(runner)

    const { response } = await run({ prompt: '   ' })

    expect(response.status).toBe(400)
    expect(runner).not.toHaveBeenCalled()
  })

  test('refuses without a tenant context', async () => {
    const runner = jest.fn()
    setRunner(runner)
    const { getAuthFromRequest } = require('@open-mercato/shared/lib/auth/server')
    getAuthFromRequest.mockResolvedValue({ sub: userId, tenantId: null, orgId: organizationId })

    const { response } = await run({ prompt: 'Approve refunds over 500' })

    expect(response.status).toBe(400)
    expect(runner).not.toHaveBeenCalled()
  })

  /**
   * The reported defect: the schema validator produced precise, per-path errors
   * (`transitions.0.activities.0.config.agentId: expected string, received
   * undefined`) and the surface handed them to the HUMAN as a dead end. The
   * model that could act on them never saw them. These pin the repair loop.
   */
  describe('validate-and-repair', () => {
    const INVALID_ACTIVITY = {
      ...VALID_GENERATION,
      transitions: [
        {
          transitionId: 't_1',
          fromStepId: 'start',
          toStepId: 'approve',
          trigger: 'auto',
          activities: [
            { activityId: 'a1', activityName: 'Email', activityType: 'SEND_EMAIL', config: {} },
          ],
        },
        { transitionId: 't_2', fromStepId: 'approve', toStepId: 'end', trigger: 'auto' },
      ],
    }

    test('feeds the validator errors back to the model instead of stopping at the human', async () => {
      const runner = jest
        .fn()
        .mockResolvedValueOnce(INVALID_ACTIVITY)
        .mockResolvedValueOnce(VALID_GENERATION)
      setRunner(runner)

      const { data } = await run({ prompt: 'Email the client after the agent runs' })

      expect(data.ok).toBe(true)
      expect(runner).toHaveBeenCalledTimes(2)

      // The second call must carry the failing paths verbatim — a prompt that
      // only says "try again" is the thing this replaces.
      const repairPrompt = runner.mock.calls[1][0].prompt as string
      expect(repairPrompt).toContain('SEND_EMAIL activity requires "to"')
      expect(repairPrompt).toContain('SEND_EMAIL activity requires "subject"')
      // ...and the draft being amended, so the model edits rather than reinvents.
      expect(repairPrompt).toContain('t_1')
    })

    test('gives up after the bounded number of attempts rather than looping', async () => {
      const runner = jest.fn().mockResolvedValue(INVALID_ACTIVITY)
      setRunner(runner)

      const { data } = await run({ prompt: 'Email the client after the agent runs' })

      expect(data.ok).toBe(false)
      expect(data.reason).toBe('schemaError')
      // One initial attempt plus WORKFLOW_DRAFT_MAX_REPAIR_ATTEMPTS repairs.
      expect(runner).toHaveBeenCalledTimes(3)
      expect(data.repairAttempts).toBe(2)
      // The author still gets the real errors — the loop adds a chance, it does
      // not swallow the outcome.
      expect(data.messages.join(' ')).toContain('SEND_EMAIL activity requires')
    })

    test('does not re-prompt when the first draft is already valid', async () => {
      const runner = jest.fn().mockResolvedValue(VALID_GENERATION)
      setRunner(runner)

      const { data } = await run({ prompt: 'Approve refunds over 500' })

      expect(data.ok).toBe(true)
      expect(runner).toHaveBeenCalledTimes(1)
      expect(data.repairAttempts).toBeUndefined()
    })

    test('stops immediately when the model call itself errors mid-repair', async () => {
      const runner = jest
        .fn()
        .mockResolvedValueOnce(INVALID_ACTIVITY)
        .mockRejectedValueOnce(new Error('rate limited'))
      setRunner(runner)

      const { data } = await run({ prompt: 'Email the client after the agent runs' })

      expect(data.ok).toBe(false)
      expect(data.reason).toBe('failed')
      expect(runner).toHaveBeenCalledTimes(2)
    })
  })
})
