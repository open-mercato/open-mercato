/** @jest-environment node */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'
import fs from 'node:fs'
import polish from '../../i18n/pl.json'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  getSupportedLocales: () => ['en', 'pl'],
  loadDictionary: jest.fn(async (locale: string) => locale === 'pl' ? polish : {}),
}))
import path from 'node:path'
import { asValue, createContainer } from 'awilix'
import { runWithRequestScopeContainer } from '@open-mercato/shared/lib/di/request-scope'
import { getEntityIds, registerEntityIds, type EntityIds } from '@open-mercato/shared/lib/encryption/entityIds'

const executeRuleByRuleId = jest.fn<(...args: unknown[]) => Promise<unknown>>()
const findWorkflowDefinition = jest.fn<(...args: unknown[]) => Promise<unknown>>()

jest.mock('../../../business_rules/lib/rule-engine', () => ({
  executeRuleByRuleId: (...args: unknown[]) => executeRuleByRuleId(...args),
  invalidateBusinessRuleDiscoveryCache: jest.fn(async () => undefined),
  resolveBusinessRuleDiscoveryCache: jest.fn(() => null),
}))

jest.mock('../find-definition', () => ({
  findWorkflowDefinition: (...args: unknown[]) => findWorkflowDefinition(...args),
}))

import { validateWorkflowStart } from '../start-validator'
import { startWorkflow } from '../workflow-executor'
import { seedExampleWorkflows } from '../seeds'
import { WorkflowDefinition } from '../../data/entities'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

function definitionWithPreConditions(preConditions: Array<{ ruleId: string; required: boolean }>) {
  return {
    enabled: true,
    definition: {
      steps: [
        { stepId: 'start', stepType: 'START', preConditions },
        { stepId: 'end', stepType: 'END' },
      ],
      transitions: [{ fromStepId: 'start', toStepId: 'end' }],
    },
  }
}

function cliCommandSource(command: string): string {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'cli.ts'), 'utf8')
  const start = source.indexOf(`command: '${command}'`)
  if (start < 0) throw new Error(`missing CLI command ${command}`)
  const end = source.indexOf('\nconst ', start)
  return source.slice(start, end < 0 ? undefined : end)
}

describe('workflows without the business_rules module (#9217)', () => {
  let previousEntityIds: EntityIds

  beforeEach(() => {
    previousEntityIds = getEntityIds(false)
    registerEntityIds({ workflows: { workflow_definition: 'workflows:workflow_definition' } })
    executeRuleByRuleId.mockReset()
    findWorkflowDefinition.mockReset()
  })

  afterEach(() => {
    registerEntityIds(previousEntityIds)
  })

  describe('validateWorkflowStart', () => {
    test('starts when every pre-condition is optional, without calling the rule engine', async () => {
      findWorkflowDefinition.mockResolvedValue(definitionWithPreConditions([{ ruleId: 'optional_rule', required: false }]))

      const result = await validateWorkflowStart({} as never, {
        workflowId: 'wf',
        context: {},
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })

      expect(result).toEqual({ canStart: true, errors: [], validatedRules: [] })
      expect(executeRuleByRuleId).not.toHaveBeenCalled()
    })

    test('blocks a required pre-condition with RULE_ENGINE_UNAVAILABLE', async () => {
      findWorkflowDefinition.mockResolvedValue(
        definitionWithPreConditions([
          { ruleId: 'required_rule', required: true },
          { ruleId: 'optional_rule', required: false },
        ]),
      )

      const result = await validateWorkflowStart({} as never, {
        workflowId: 'wf',
        context: {},
        locale: 'pl',
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })

      expect(result.canStart).toBe(false)
      expect(result.errors).toEqual([
        {
          ruleId: 'required_rule',
          code: 'RULE_ENGINE_UNAVAILABLE',
          message: 'Moduł reguł biznesowych jest wyłączony: required_rule',
        },
      ])
      expect(executeRuleByRuleId).not.toHaveBeenCalled()
    })

    test('still evaluates pre-conditions through the rule engine when business_rules is enabled', async () => {
      registerEntityIds({ business_rules: { business_rule: 'business_rules:business_rule' } })
      findWorkflowDefinition.mockResolvedValue(definitionWithPreConditions([{ ruleId: 'required_rule', required: true }]))
      executeRuleByRuleId.mockResolvedValue({ conditionResult: true, executionTime: 1 })

      const container = createContainer().register({ ruleEngine: asValue({ executeRuleByRuleId }) })
      const em = {} as never
      const result = await runWithRequestScopeContainer(container, () => validateWorkflowStart(em, {
        workflowId: 'wf',
        context: {},
        ...scope,
      }))

      expect(executeRuleByRuleId).toHaveBeenCalledWith(em, expect.objectContaining({
        ...scope,
        ruleId: 'required_rule',
        eventType: 'validate_start',
        dryRun: true,
      }))
      expect(result.canStart).toBe(true)
    })
    test('never falls back from an explicitly unavailable provider in the supplied scope', async () => {
      const ambient = createContainer().register({ ruleEngine: asValue({ executeRuleByRuleId }) })
      const explicit = createContainer()
      findWorkflowDefinition.mockResolvedValue(definitionWithPreConditions([{ ruleId: 'required_rule', required: true }]))

      const result = await runWithRequestScopeContainer(ambient, () =>
        validateWorkflowStart({} as never, { workflowId: 'wf', context: {}, ...scope }, { container: explicit }),
      )

      expect(result.errors).toEqual([expect.objectContaining({ code: 'RULE_ENGINE_UNAVAILABLE' })])
      expect(executeRuleByRuleId).not.toHaveBeenCalled()
    })

    test('actual dry-run start suppresses START rule actions and rejects a required failure', async () => {
      const container = createContainer().register({ ruleEngine: asValue({ executeRuleByRuleId }) })
      findWorkflowDefinition.mockResolvedValue(definitionWithPreConditions([{ ruleId: 'required_rule', required: true }]))
      executeRuleByRuleId.mockResolvedValue({ conditionResult: false, executionTime: 1 })
      const em = {} as never

      await expect(startWorkflow(em, { workflowId: 'wf', isDryRun: true, ...scope }, container)).rejects.toMatchObject({
        code: 'START_PRE_CONDITIONS_FAILED',
      })
      expect(executeRuleByRuleId).toHaveBeenCalledWith(em, expect.objectContaining({
        ...scope,
        ruleId: 'required_rule',
        dryRun: true,
        skipActions: true,
      }))
    })
  })

  describe('seedExampleWorkflows', () => {
    test('seeds the sales-pipeline definition and never touches BusinessRule', async () => {
      const touchedEntities: unknown[] = []
      const em = {
        findOne: jest.fn(async (entity: unknown) => {
          touchedEntities.push(entity)
          return null
        }),
        create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
          touchedEntities.push(entity)
          return data
        }),
        persist: jest.fn(),
        flush: jest.fn(async () => undefined),
      }

      await seedExampleWorkflows(em as never, scope)

      expect(new Set(touchedEntities)).toEqual(new Set([WorkflowDefinition]))
      expect(em.create).toHaveBeenCalledWith(
        WorkflowDefinition,
        expect.objectContaining({ workflowId: 'sales_pipeline_v1', tenantId: scope.tenantId }),
      )
    })
  })

  describe('CLI', () => {
    // cli.ts reads import.meta.url at load time, which this Jest transform cannot
    // evaluate, so the guard is asserted on the command source instead.
    test.each(['seed-demo-with-rules', 'seed-order-approval'])(
      '%s returns before opening a container when business_rules is disabled',
      (command) => {
        const body = cliCommandSource(command)
        const guardAt = body.indexOf('if (!isBusinessRulesModuleEnabled())')
        expect(guardAt).toBeGreaterThan(-1)
        expect(guardAt).toBeLessThan(body.indexOf('createRequestContainer()'))
      },
    )
  })
})
