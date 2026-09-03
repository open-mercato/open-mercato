import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { WorkflowDefinitionData } from '@open-mercato/core/modules/workflows/data/entities'
import { AgentEvalAssertion, AgentEvalCase } from '../data/entities'
import { canonicalInputKey } from './eval/canonicalInputKey'
import { getAgentEntry } from './sdk/defineAgent'

const __esmDirname = path.dirname(fileURLToPath(import.meta.url))

const logger = createLogger('agent_orchestrator').child({ component: 'seeds' })

export type AgentOrchestratorSeedScope = { tenantId: string; organizationId: string }

/**
 * The demo agent the workflow invokes. Code-defined in `ai-agents.ts` (area 01),
 * discovered by the ai_assistant generator — NOT seeded as a DB row (a DB row
 * would shadow the code definition in the registry merge, same lesson as the
 * code-defined workflow definitions in `workflows/lib/seeds.ts`).
 */
const DEMO_AGENT_ID = 'deals.health_check'

const DEMO_WORKFLOW_FILE = 'deals-health-check-workflow.json'
const REFUND_TRIAGE_WORKFLOW_FILE = 'refund-triage-workflow.json'

/** Stable demo deals so a workflow/playground run always has data to act on. */
const DEMO_DEALS = [
  {
    title: '[Demo] Acme renewal — healthy',
    description: 'High-confidence demo deal: deals.health_check should auto-approve the next stage (confidence >= 0.8).',
    pipelineStage: 'Proposal',
    status: 'open',
  },
  {
    title: '[Demo] Globex expansion — at risk',
    description: 'Low-confidence demo deal: deals.health_check should park a proposal in My caseload for an operator.',
    pipelineStage: 'Qualified',
    status: 'open',
  },
] as const

const DEMO_HEALTHY_DEAL_TITLE = '[Demo] Acme renewal — healthy'

/**
 * Agent-specific demo assertions for `deals.health_check`. The tenant-wide `'*'`
 * defaults (`seedDefaultEvalAssertions`) already cover output-present + min-confidence;
 * these two add the checks specific to this agent's decision shape, so the demo
 * agent shows a meaningful gate/warn mix out of the box.
 */
const DEMO_DHC_ASSERTIONS: Array<{
  key: string
  scorerKey: string
  title: string
  description: string
  type: 'deterministic'
  severity: 'gate' | 'warn'
  config: Record<string, unknown>
}> = [
  {
    key: 'dh_proposes_stage',
    scorerKey: 'json_path_compare',
    title: 'Proposes a stage change',
    description: 'The proposal moves the deal to a stage.',
    type: 'deterministic',
    severity: 'gate',
    config: { path: 'proposal.options[0].actions[0].type', operator: 'eq', value: 'set_stage' },
  },
  {
    key: 'dh_rationale_present',
    scorerKey: 'json_path_compare',
    title: 'Rationale present',
    description: 'The proposal explains its reasoning.',
    type: 'deterministic',
    severity: 'warn',
    config: { path: 'proposal.rationale', operator: 'ne', value: '' },
  },
]

/** Strong golden output for the healthy demo deal (should auto-approve; confidence >= 0.8). */
const DEMO_HEALTHY_EXPECTED = {
  kind: 'proposal',
  proposal: {
    options: [
      {
        id: 'primary',
        label: DEMO_AGENT_ID,
        actions: [{ type: 'set_stage', payload: { stage: 'Negotiation' } }],
        confidence: 0.85,
      },
    ],
    rationale:
      'The deal is healthy: strong momentum, engaged stakeholders, and the current-stage exit criteria are met — advance to Negotiation.',
  },
}

type WorkflowSeedDefinition = {
  workflowId: string
  workflowName: string
  description?: string | null
  version?: number
  definition: WorkflowDefinitionData
  metadata?: Record<string, unknown> | null
  enabled?: boolean
}

function readExampleJson<T>(fileName: string): T {
  const candidates = [
    path.join(__esmDirname, '..', 'examples', fileName),
    path.join(process.cwd(), 'packages', 'core', 'src', 'modules', 'agent_orchestrator', 'examples', fileName),
    path.join(process.cwd(), 'src', 'modules', 'agent_orchestrator', 'examples', fileName),
  ]
  const filePath = candidates.find((candidate) => fs.existsSync(candidate))
  if (!filePath) {
    throw new Error(`[internal] Missing agent_orchestrator seed file: ${fileName}`)
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
}

function requireString(value: unknown, label: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value
  throw new Error(`[internal] Invalid ${label} in agent_orchestrator seed data.`)
}

/**
 * Verify-only: the demo agent is code-defined and must resolve in the registry.
 * Logs a skip (never throws) so seeding stays resilient when ai_agents discovery
 * has not run yet on a fresh checkout.
 */
function verifyDemoAgent(): void {
  if (!getAgentEntry(DEMO_AGENT_ID)) {
    logger.warn(
      'demo agent not found in the registry; run `yarn generate` so ai-agents.ts is discovered before triggering the demo workflow',
      { agentId: DEMO_AGENT_ID },
    )
  }
}

/**
 * Idempotent seed of an example workflow definition from a bundled JSON file
 * (find by workflowId in scope, create-if-absent). Mirrors `workflows/lib/seeds.ts`;
 * resolves the workflows entity lazily so agent_orchestrator does not hard-depend
 * on the optional peer.
 */
async function seedWorkflowDefinitionFile(
  em: EntityManager,
  scope: AgentOrchestratorSeedScope,
  fileName: string,
): Promise<boolean> {
  const entities = (await import(
    '@open-mercato/core/modules/workflows/data/entities'
  )) as typeof import('@open-mercato/core/modules/workflows/data/entities')

  const seed = readExampleJson<WorkflowSeedDefinition>(fileName)
  const workflowId = requireString(seed.workflowId, 'workflowId')

  const existing = await em.findOne(entities.WorkflowDefinition, {
    workflowId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (existing) return false

  const workflow = em.create(entities.WorkflowDefinition, {
    ...seed,
    workflowId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  em.persist(workflow)
  await em.flush()
  return true
}

function buildSeedCommandContext(
  container: AwilixContainer,
  scope: AgentOrchestratorSeedScope,
): CommandRuntimeContext {
  return {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    systemActor: true,
  }
}

/**
 * Create the demo deals through the customers Command path (never raw ORM into
 * another module). Idempotent by stable title within scope.
 */
async function seedDemoDeals(
  container: AwilixContainer,
  scope: AgentOrchestratorSeedScope,
): Promise<number> {
  const em = (container.resolve('em') as EntityManager).fork()
  const customers = (await import(
    '@open-mercato/core/modules/customers/data/entities'
  )) as typeof import('@open-mercato/core/modules/customers/data/entities')
  const commandBus = container.resolve('commandBus') as CommandBus

  let created = 0
  for (const deal of DEMO_DEALS) {
    const existing = await findOneWithDecryption(
      em,
      customers.CustomerDeal,
      { title: deal.title, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      undefined,
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
    if (existing) continue

    await commandBus.execute('customers.deals.create', {
      input: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        title: deal.title,
        description: deal.description,
        pipelineStage: deal.pipelineStage,
        status: deal.status,
      },
      ctx: buildSeedCommandContext(container, scope),
    })
    created += 1
  }
  return created
}

/**
 * Demo eval setup for `deals.health_check`: the agent-specific assertions plus an
 * APPROVED golden case tied to the healthy demo deal, so a fresh install shows a
 * meaningful evaluation (gate/warn verdicts + a golden-match diff) in the Playground.
 * Runs after `seedDemoDeals` so the deal exists; idempotent (assertion by
 * org+appliesTo+key, golden by agent+inputKey). The golden's `input` is built from
 * the deal's runtime uuid, so its `inputKey` matches real `{ dealId }` runs.
 */
async function seedDealsHealthCheckEval(
  container: AwilixContainer,
  scope: AgentOrchestratorSeedScope,
): Promise<void> {
  const em = (container.resolve('em') as EntityManager).fork()

  let assertionsCreated = false
  for (const assertion of DEMO_DHC_ASSERTIONS) {
    const existing = await em.findOne(AgentEvalAssertion, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      appliesTo: DEMO_AGENT_ID,
      key: assertion.key,
    })
    if (existing) continue
    em.persist(
      em.create(AgentEvalAssertion, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        key: assertion.key,
        scorerKey: assertion.scorerKey,
        title: assertion.title,
        description: assertion.description,
        appliesTo: DEMO_AGENT_ID,
        type: assertion.type,
        severity: assertion.severity,
        config: assertion.config,
        enabled: true,
        deletedAt: null,
      }),
    )
    assertionsCreated = true
  }
  if (assertionsCreated) await em.flush()

  const customers = (await import(
    '@open-mercato/core/modules/customers/data/entities'
  )) as typeof import('@open-mercato/core/modules/customers/data/entities')
  const deal = await findOneWithDecryption(
    em,
    customers.CustomerDeal,
    { title: DEMO_HEALTHY_DEAL_TITLE, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    undefined,
    { tenantId: scope.tenantId, organizationId: scope.organizationId },
  )
  if (!deal) return

  const input = { dealId: deal.id }
  const inputKey = canonicalInputKey(input)
  const existingCase = await em.findOne(AgentEvalCase, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    agentDefinitionId: DEMO_AGENT_ID,
    inputKey,
  })
  if (existingCase) return
  em.persist(
    em.create(AgentEvalCase, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      sourceType: 'golden_run',
      sourceId: randomUUID(),
      agentDefinitionId: DEMO_AGENT_ID,
      processType: null,
      input,
      inputKey,
      expected: DEMO_HEALTHY_EXPECTED,
      assertions: null,
      status: 'approved',
      approvedByUserId: null,
      deletedAt: null,
    }),
  )
  await em.flush()
}

/**
 * Gated demo seed (skipped with `--no-examples`). Lands the demo workflow
 * definition + demo deals + the demo agent's eval assertions & golden case;
 * verifies the code-defined demo agent resolves. All writes are tenant-scoped and
 * idempotent (re-running creates nothing new).
 */
export async function seedAgentOrchestratorExamples(
  em: EntityManager,
  container: AwilixContainer,
  scope: AgentOrchestratorSeedScope,
): Promise<void> {
  verifyDemoAgent()
  await seedWorkflowDefinitionFile(em, scope, DEMO_WORKFLOW_FILE)
  await seedWorkflowDefinitionFile(em, scope, REFUND_TRIAGE_WORKFLOW_FILE)
  await seedDemoDeals(container, scope)
  await seedDealsHealthCheckEval(container, scope)
}
