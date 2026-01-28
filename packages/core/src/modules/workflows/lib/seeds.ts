import type { EntityManager } from '@mikro-orm/postgresql'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'node:url'
import { WorkflowDefinition, type WorkflowDefinitionData } from '../data/entities'
import { BusinessRule, type RuleType } from '@open-mercato/core/modules/business_rules/data/entities'

const __esmDirname = path.dirname(fileURLToPath(import.meta.url))

export type WorkflowSeedScope = { tenantId: string; organizationId: string }

type WorkflowSeedDefinition = {
  workflowId: string
  workflowName: string
  description?: string | null
  version?: number
  definition: WorkflowDefinitionData
  metadata?: Record<string, unknown> | null
  enabled?: boolean
  effectiveFrom?: string | null
  effectiveTo?: string | null
  createdBy?: string | null
  updatedBy?: string | null
}

type GuardRuleSeed = {
  ruleId: string
  ruleName: string
  ruleType: RuleType
  entityType: string
  conditionExpression: unknown
  eventType?: string | null
  ruleCategory?: string | null
  description?: string | null
  successActions?: unknown
  failureActions?: unknown
  enabled?: boolean
  priority?: number
  version?: number
  effectiveFrom?: string | null
  effectiveTo?: string | null
  createdBy?: string | null
  updatedBy?: string | null
  tagsJson?: string[]
  labelsJson?: Record<string, string>
}

function readExampleJson<T>(fileName: string): T {
  const candidates = [
    path.join(__esmDirname, '..', 'examples', fileName),
    path.join(process.cwd(), 'packages', 'core', 'src', 'modules', 'workflows', 'examples', fileName),
    path.join(process.cwd(), 'src', 'modules', 'workflows', 'examples', fileName),
  ]
  const filePath = candidates.find((candidate) => fs.existsSync(candidate))
  if (!filePath) {
    throw new Error(`Missing workflow seed file: ${fileName}`)
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
}

function requireString(value: unknown, label: string): string {
  if (typeof value === 'string' && value.trim().length > 0) return value
  throw new Error(`Invalid ${label} in workflow seed data.`)
}

async function seedWorkflowDefinition(
  em: EntityManager,
  scope: WorkflowSeedScope,
  fileName: string,
): Promise<boolean> {
  const seed = readExampleJson<WorkflowSeedDefinition>(fileName)
  const workflowId = requireString(seed.workflowId, 'workflowId')

  const existing = await em.findOne(WorkflowDefinition, {
    workflowId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })

  if (existing) {
    // Check if the definition needs to be updated (e.g., missing preConditions on START step)
    const seedStartStep = seed.definition.steps.find((s: any) => s.stepType === 'START')
    const existingStartStep = existing.definition.steps.find((s: any) => s.stepType === 'START')

    const seedHasPreConditions = seedStartStep?.preConditions && seedStartStep.preConditions.length > 0
    const existingHasPreConditions = existingStartStep?.preConditions && existingStartStep.preConditions.length > 0

    // Update if seed has preConditions but existing doesn't
    if (seedHasPreConditions && !existingHasPreConditions) {
      console.log(`[seed] Updating workflow ${workflowId} with preConditions`)
      existing.definition = seed.definition
      await em.flush()
      return true
    }

    return false
  }

  const workflow = em.create(WorkflowDefinition, {
    ...seed,
    workflowId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  em.persist(workflow)
  await em.flush()
  return true
}

async function seedGuardRules(
  em: EntityManager,
  scope: WorkflowSeedScope,
  fileName: string,
): Promise<{ seeded: number; skipped: number; updated: number }> {
  const seeds = readExampleJson<GuardRuleSeed[]>(fileName)
  if (!Array.isArray(seeds)) {
    throw new Error('Invalid guard rules seed data.')
  }

  let seeded = 0
  let skipped = 0
  let updated = 0
  for (const rule of seeds) {
    const ruleId = requireString(rule.ruleId, 'ruleId')
    const existing = await em.findOne(BusinessRule, {
      ruleId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    if (existing) {
      // Check if entityType or eventType needs updating
      const needsUpdate = existing.entityType !== rule.entityType || existing.eventType !== rule.eventType
      if (needsUpdate) {
        console.log(`[seed] Updating business rule ${ruleId}: entityType=${rule.entityType}, eventType=${rule.eventType}`)
        existing.entityType = rule.entityType
        existing.eventType = rule.eventType ?? null
        updated += 1
      } else {
        skipped += 1
      }
      continue
    }
    const entry = em.create(BusinessRule, {
      ...rule,
      ruleId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    em.persist(entry)
    seeded += 1
  }
  if (seeded > 0 || updated > 0) {
    await em.flush()
  }
  return { seeded, skipped, updated }
}

export async function seedExampleWorkflows(em: EntityManager, scope: WorkflowSeedScope): Promise<void> {
  await seedWorkflowDefinition(em, scope, 'checkout-demo-definition.json')
  await seedGuardRules(em, scope, 'guard-rules-example.json')
  await seedWorkflowDefinition(em, scope, 'sales-pipeline-definition.json')
  await seedWorkflowDefinition(em, scope, 'simple-approval-definition.json')
}
