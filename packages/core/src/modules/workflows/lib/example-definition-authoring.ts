import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { asValue, type AwilixContainer } from 'awilix'
import { z } from 'zod'
import type { OrganizationHierarchyService } from '@open-mercato/shared/lib/auth/principal-service'
import { readPgSqlState } from '@open-mercato/shared/lib/db/pg-errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WorkflowDefinition, type WorkflowDefinitionData } from '../data/entities'
import { createWorkflowDefinitionSchema, workflowDefinitionDataSchema } from '../data/validators'

const exampleScopeSchema = createWorkflowDefinitionSchema.pick({
  tenantId: true,
  organizationId: true,
})
const exampleFixtureSchema = createWorkflowDefinitionSchema.pick({
  workflowId: true,
  workflowName: true,
  description: true,
  metadata: true,
  enabled: true,
}).extend({
  version: z.literal(1).default(1),
  definition: z.custom<WorkflowDefinitionData>((value) => workflowDefinitionDataSchema.safeParse(value).success),
})

const exampleInputSchema = exampleScopeSchema.extend({ fixture: exampleFixtureSchema })

type ExampleScope = z.infer<typeof exampleScopeSchema>
type ExampleFixture = z.infer<typeof exampleFixtureSchema>

export type CreateExampleWorkflowDefinitionInput = ExampleScope & { fixture: unknown }
export type CreateExampleWorkflowDefinitionResult = 'created' | 'already_exists'

export interface WorkflowExampleAuthoring {
  createExampleDefinitionIfAbsent(
    em: EntityManager,
    input: CreateExampleWorkflowDefinitionInput,
  ): Promise<CreateExampleWorkflowDefinitionResult>
}

const WORKFLOW_VERSION_CONSTRAINT = 'workflow_definitions_workflow_id_version_tenant_id_unique'

function isWorkflowVersionConflict(error: unknown): boolean {
  return readPgSqlState(error) === '23505'
    && error instanceof Error
    && (('constraint' in error && error.constraint === WORKFLOW_VERSION_CONSTRAINT)
      || error.message.includes(`duplicate key value violates unique constraint "${WORKFLOW_VERSION_CONSTRAINT}"`))
}

async function validateSetupOrganization(container: AwilixContainer, em: EntityManager, scope: ExampleScope): Promise<void> {
  const setupScope = container.createScope()
  setupScope.register('em', asValue(em))
  try {
    const directory = setupScope.resolve<OrganizationHierarchyService>('organizationHierarchyService')
    if (await directory.resolveAncestorIds(scope) == null) {
      throw new Error('[internal] Invalid organization scope for workflow example.')
    }
  } finally {
    await setupScope.dispose()
  }
}

async function persistIfAbsent(
  em: EntityManager,
  scope: ExampleScope,
  fixture: ExampleFixture,
): Promise<CreateExampleWorkflowDefinitionResult | 'scope_conflict'> {
  const where = { ...scope, workflowId: fixture.workflowId }
  const findExisting = () => findOneWithDecryption(
    em, WorkflowDefinition, where, { fields: ['id'], refresh: true }, scope,
  )
  if (await findExisting()) return 'already_exists'

  try {
    await em.transactional(async (transaction) => {
      transaction.persist(transaction.create(WorkflowDefinition, {
        ...fixture,
        ...scope,
        id: randomUUID(),
      }))
    }, { clear: true })
    return 'created'
  } catch (error) {
    if (!isWorkflowVersionConflict(error)) throw error
    return await findExisting() ? 'already_exists' : 'scope_conflict'
  }
}

export function createWorkflowExampleAuthoring(container: AwilixContainer): WorkflowExampleAuthoring {
  return {
    async createExampleDefinitionIfAbsent(em, input) {
      const parsed = exampleInputSchema.safeParse(input)
      if (!parsed.success || parsed.data.fixture.workflowName.trim().length === 0) {
        throw new Error('[internal] Invalid workflow example input.')
      }
      const { fixture, ...scope } = parsed.data

      await validateSetupOrganization(container, em, scope)

      let result: Awaited<ReturnType<typeof persistIfAbsent>>
      try {
        result = await persistIfAbsent(em, scope, fixture)
      } catch (error) {
        throw Object.assign(new Error('[internal] Workflow example could not be saved.'), {
          code: readPgSqlState(error),
        })
      }
      if (result === 'scope_conflict') {
        throw new Error('[internal] Workflow example version conflicts with an existing definition.')
      }
      return result
    },
  }
}
