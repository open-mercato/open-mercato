import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'node:url'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { WorkflowDefinitionData } from '@open-mercato/core/modules/workflows/data/entities'
import { getAgentEntry } from './sdk/defineAgent'

const __esmDirname = path.dirname(fileURLToPath(import.meta.url))

export type AgentOrchestratorSeedScope = { tenantId: string; organizationId: string }

/**
 * The demo agent the workflow invokes. Code-defined in `ai-agents.ts` (area 01),
 * discovered by the ai_assistant generator — NOT seeded as a DB row (a DB row
 * would shadow the code definition in the registry merge, same lesson as the
 * code-defined workflow definitions in `workflows/lib/seeds.ts`).
 */
const DEMO_AGENT_ID = 'deals.health_check'

const DEMO_WORKFLOW_FILE = 'deals-health-check-workflow.json'

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
    console.warn(
      `[agent_orchestrator] demo agent "${DEMO_AGENT_ID}" not found in the registry; ` +
        'run `yarn generate` so ai-agents.ts is discovered before triggering the demo workflow.',
    )
  }
}

/**
 * Idempotent upsert of the demo workflow definition (find by workflowId in scope,
 * create-if-absent). Mirrors `workflows/lib/seeds.ts`; resolves the workflows
 * entity lazily so agent_orchestrator does not hard-depend on the optional peer.
 */
async function seedDealsHealthCheckWorkflow(
  em: EntityManager,
  scope: AgentOrchestratorSeedScope,
): Promise<boolean> {
  const entities = (await import(
    '@open-mercato/core/modules/workflows/data/entities'
  )) as typeof import('@open-mercato/core/modules/workflows/data/entities')

  const seed = readExampleJson<WorkflowSeedDefinition>(DEMO_WORKFLOW_FILE)
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
 * Gated demo seed (skipped with `--no-examples`). Lands the demo workflow
 * definition + demo deals; verifies the code-defined demo agent resolves.
 * All writes are tenant-scoped and idempotent (re-running creates nothing new).
 */
export async function seedAgentOrchestratorExamples(
  em: EntityManager,
  container: AwilixContainer,
  scope: AgentOrchestratorSeedScope,
): Promise<void> {
  verifyDemoAgent()
  await seedDealsHealthCheckWorkflow(em, scope)
  await seedDemoDeals(container, scope)
}
