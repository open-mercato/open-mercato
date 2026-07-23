/**
 * Regression test for #4333: triggers declared by code-defined workflows never
 * reached the runtime matcher.
 *
 * `loadTriggersForTenant` merged only two DB-backed sources (legacy
 * `workflow_event_triggers` rows and triggers embedded in `workflow_definitions`
 * JSONB). A code workflow lives purely in the in-memory registry until a user
 * customizes it, so `sales.order-approval` could never auto-start from
 * `sales.order.created` — no matter how correct its event pattern was.
 * Self-QA on PR #4385 confirmed this end-to-end (instance count stayed at 0).
 */

jest.mock('../workflow-executor', () => ({
  executeWorkflow: jest.fn(),
  startWorkflow: jest.fn(),
}))

const getAllCodeWorkflowsMock = jest.fn()
jest.mock('../code-registry', () => ({
  getAllCodeWorkflows: () => getAllCodeWorkflowsMock(),
}))

const GLOBAL_KEY = '__openMercatoWorkflowTriggerCache__'

function makeCodeWorkflow(overrides: Record<string, unknown> = {}) {
  return {
    workflowId: 'sales.order-approval',
    workflowName: 'Order approval',
    description: null,
    version: 1,
    enabled: true,
    metadata: null,
    moduleId: 'sales',
    definition: {
      steps: [],
      transitions: [],
      triggers: [
        {
          triggerId: 'on-order-created',
          name: 'On order created',
          eventPattern: 'sales.order.created',
          priority: 10,
        },
      ],
    },
    ...overrides,
  }
}

/** Minimal EntityManager stub: no legacy triggers, no definitions, no shadow rows. */
function makeEm(shadowWorkflowIds: string[] = []) {
  return {
    find: jest.fn(async (_entity: unknown, where: Record<string, unknown>) => {
      // loadCodeTriggers' shadow probe filters by workflowId: { $in: [...] }
      const workflowIdFilter = where?.workflowId as { $in?: string[] } | undefined
      if (workflowIdFilter?.$in) {
        return shadowWorkflowIds
          .filter((id) => workflowIdFilter.$in!.includes(id))
          .map((workflowId) => ({ workflowId }))
      }
      return []
    }),
    findOne: jest.fn(async () => null),
  }
}

describe('loadTriggersForTenant — code-defined workflow triggers (#4333)', () => {
  beforeEach(() => {
    delete (globalThis as never as Record<string, unknown>)[GLOBAL_KEY]
    getAllCodeWorkflowsMock.mockReset()
    jest.resetModules()
  })

  afterEach(() => {
    delete (globalThis as never as Record<string, unknown>)[GLOBAL_KEY]
  })

  it('exposes a code workflow trigger to the matcher', async () => {
    getAllCodeWorkflowsMock.mockReturnValue([makeCodeWorkflow()])
    const { loadTriggersForTenant } = await import('../event-trigger-service')

    const triggers = await loadTriggersForTenant(makeEm() as never, 'tenant-a', 'org-a')

    expect(triggers).toHaveLength(1)
    expect(triggers[0]).toMatchObject({
      triggerId: 'on-order-created',
      eventPattern: 'sales.order.created',
      workflowId: 'sales.order-approval',
      workflowVersion: 1,
      source: 'code',
      enabled: true,
      priority: 10,
    })
    // Deterministic virtual-definition UUID, so concurrency limits count the
    // instances these triggers actually start.
    expect(triggers[0].workflowDefinitionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('lets a customized DB definition shadow the code triggers', async () => {
    getAllCodeWorkflowsMock.mockReturnValue([makeCodeWorkflow()])
    const { loadTriggersForTenant } = await import('../event-trigger-service')

    const triggers = await loadTriggersForTenant(
      makeEm(['sales.order-approval']) as never,
      'tenant-a',
      'org-a',
    )

    expect(triggers).toHaveLength(0)
  })

  it('skips disabled workflows and disabled triggers', async () => {
    getAllCodeWorkflowsMock.mockReturnValue([
      makeCodeWorkflow({ enabled: false }),
      makeCodeWorkflow({
        workflowId: 'sales.other',
        definition: {
          steps: [],
          transitions: [],
          triggers: [
            {
              triggerId: 'off',
              name: 'Disabled trigger',
              eventPattern: 'sales.order.created',
              enabled: false,
            },
          ],
        },
      }),
    ])
    const { loadTriggersForTenant } = await import('../event-trigger-service')

    const triggers = await loadTriggersForTenant(makeEm() as never, 'tenant-a', 'org-a')

    expect(triggers).toHaveLength(0)
  })

  it('does not query the shadow probe when no code workflow declares triggers', async () => {
    getAllCodeWorkflowsMock.mockReturnValue([
      makeCodeWorkflow({ definition: { steps: [], transitions: [], triggers: [] } }),
    ])
    const { loadTriggersForTenant } = await import('../event-trigger-service')
    const em = makeEm()

    const triggers = await loadTriggersForTenant(em as never, 'tenant-a', 'org-a')

    expect(triggers).toHaveLength(0)
    const shadowProbes = em.find.mock.calls.filter(
      ([, where]) => (where as { workflowId?: unknown })?.workflowId,
    )
    expect(shadowProbes).toHaveLength(0)
  })
})
