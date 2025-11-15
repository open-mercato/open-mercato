// @ts-nocheck
import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals'
import { MikroORM, type EntityManager } from '@mikro-orm/core'
import { PostgreSqlDriver } from '@mikro-orm/postgresql'
import * as ruleEngine from '../rule-engine'
import type { RuleEngineContext } from '../rule-engine'
import type { BusinessRule } from '../../data/entities'

describe('Rule Engine', () => {
  let orm: MikroORM
  let em: EntityManager

  const testTenantId = '00000000-0000-0000-0000-000000000001'
  const testOrgId = '00000000-0000-0000-0000-000000000002'
  const testEntityId = '00000000-0000-0000-0000-000000000003'

  beforeAll(async () => {
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      dbName: process.env.DB_NAME || 'open_mercato_test',
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT) || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      entities: ['./packages/core/src/modules/*/data/entities.ts'],
      discovery: { warnWhenNoEntities: false },
    })

    em = orm.em.fork()
  })

  afterAll(async () => {
    await orm.close()
  })

  beforeEach(async () => {
    em = orm.em.fork()

    await em.nativeDelete('RuleExecutionLog' as any, {})
    await em.nativeDelete('BusinessRule' as any, {})
  })

  describe('findApplicableRules', () => {
    test('should find rules by entity type', async () => {
      const rule = em.create('BusinessRule' as any, {
        ruleId: 'TEST-001',
        ruleName: 'Test Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
        enabled: true,
        priority: 100,
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      await em.persistAndFlush(rule)

      const rules = await ruleEngine.findApplicableRules(em, {
        entityType: 'WorkOrder',
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      expect(rules).toHaveLength(1)
      expect(rules[0].ruleId).toBe('TEST-001')
    })

    test('should filter by event type', async () => {
      const rule1 = em.create('BusinessRule' as any, {
        ruleId: 'TEST-001',
        ruleName: 'Before Status Change',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        eventType: 'beforeStatusChange',
        conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      const rule2 = em.create('BusinessRule' as any, {
        ruleId: 'TEST-002',
        ruleName: 'After Status Change',
        ruleType: 'ACTION',
        entityType: 'WorkOrder',
        eventType: 'afterStatusChange',
        conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      await em.persistAndFlush([rule1, rule2])

      const rules = await ruleEngine.findApplicableRules(em, {
        entityType: 'WorkOrder',
        eventType: 'beforeStatusChange',
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      expect(rules).toHaveLength(1)
      expect(rules[0].ruleId).toBe('TEST-001')
    })

    test('should exclude disabled rules', async () => {
      const rule = em.create('BusinessRule' as any, {
        ruleId: 'TEST-001',
        ruleName: 'Disabled Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
        enabled: false,
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      await em.persistAndFlush(rule)

      const rules = await ruleEngine.findApplicableRules(em, {
        entityType: 'WorkOrder',
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      expect(rules).toHaveLength(0)
    })

    test('should filter by effective date range', async () => {
      const now = new Date()
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)

      const rule1 = em.create('BusinessRule' as any, {
        ruleId: 'TEST-001',
        ruleName: 'Future Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
        enabled: true,
        effectiveFrom: tomorrow,
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      const rule2 = em.create('BusinessRule' as any, {
        ruleId: 'TEST-002',
        ruleName: 'Past Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
        enabled: true,
        effectiveTo: yesterday,
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      const rule3 = em.create('BusinessRule' as any, {
        ruleId: 'TEST-003',
        ruleName: 'Current Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
        enabled: true,
        effectiveFrom: yesterday,
        effectiveTo: tomorrow,
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      await em.persistAndFlush([rule1, rule2, rule3])

      const rules = await ruleEngine.findApplicableRules(em, {
        entityType: 'WorkOrder',
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      expect(rules).toHaveLength(1)
      expect(rules[0].ruleId).toBe('TEST-003')
    })

    test('should enforce tenant isolation', async () => {
      const otherTenantId = '00000000-0000-0000-0000-000000000999'

      const rule = em.create('BusinessRule' as any, {
        ruleId: 'TEST-001',
        ruleName: 'Other Tenant Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
        enabled: true,
        tenantId: otherTenantId,
        organizationId: testOrgId,
      })

      await em.persistAndFlush(rule)

      const rules = await ruleEngine.findApplicableRules(em, {
        entityType: 'WorkOrder',
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      expect(rules).toHaveLength(0)
    })
  })

  describe('executeSingleRule', () => {
    test('should execute rule with passing condition', async () => {
      const rule = em.create('BusinessRule' as any, {
        ruleId: 'TEST-001',
        ruleName: 'Status Check',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
        successActions: [{ type: 'ALLOW_TRANSITION', config: { message: 'Allowed' } }],
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,

      await em.persistAndFlush(rule)

      const context: RuleEngineContext = {
        entityType: 'WorkOrder',
        entityId: testEntityId,
        data: { status: 'RELEASED' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        dryRun: true,
      }

      const result = await ruleEngine.executeSingleRule(em, rule, context)

      expect(result.conditionResult).toBe(true)
      expect(result.actionsExecuted).not.toBeNull()
      expect(result.actionsExecuted?.success).toBe(true)
      expect(result.executionTime).toBeGreaterThan(0)
    })

    test('should execute rule with failing condition', async () => {
      const rule = em.create('BusinessRule' as any, {
        ruleId: 'TEST-001',
        ruleName: 'Status Check',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
        failureActions: [{ type: 'BLOCK_TRANSITION', config: { message: 'Blocked' } }],
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      await em.persistAndFlush(rule)

      const context: RuleEngineContext = {
        entityType: 'WorkOrder',
        entityId: testEntityId,
        data: { status: 'DRAFT' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        dryRun: true,
      }

      const result = await ruleEngine.executeSingleRule(em, rule, context)

      expect(result.conditionResult).toBe(false)
      expect(result.error).toBeDefined()
    })

    test('should log execution when not in dry run mode', async () => {
      const rule = em.create('BusinessRule' as any, {
        ruleId: 'TEST-001',
        ruleName: 'Status Check',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
        successActions: [{ type: 'LOG', config: { message: 'Logged' } }],
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      await em.persistAndFlush(rule)

      const context: RuleEngineContext = {
        entityType: 'WorkOrder',
        entityId: testEntityId,
        data: { status: 'RELEASED' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        dryRun: false,
      }

      await ruleEngine.executeSingleRule(em, rule, context)

      const logs = (await em.find('RuleExecutionLog' as any, {})) as any[]
      expect(logs).toHaveLength(1)
      expect(logs[0].executionResult).toBe('SUCCESS')
    })
  })

  describe('executeRules', () => {
    test('should execute multiple rules in priority order', async () => {
      const rule1 = em.create('BusinessRule' as any, {
        ruleId: 'TEST-001',
        ruleName: 'Low Priority',
        ruleType: 'ACTION',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
        successActions: [{ type: 'LOG', config: { message: 'Low' } }],
        enabled: true,
        priority: 50,
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      const rule2 = em.create('BusinessRule' as any, {
        ruleId: 'TEST-002',
        ruleName: 'High Priority',
        ruleType: 'ACTION',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
        successActions: [{ type: 'LOG', config: { message: 'High' } }],
        enabled: true,
        priority: 100,
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      await em.persistAndFlush([rule1, rule2])

      const context: RuleEngineContext = {
        entityType: 'WorkOrder',
        entityId: testEntityId,
        data: { status: 'RELEASED' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        dryRun: true,
      }

      const result = await ruleEngine.executeRules(em, context)

      expect(result.executedRules).toHaveLength(2)
      expect(result.executedRules[0].rule.ruleId).toBe('TEST-002')
      expect(result.executedRules[1].rule.ruleId).toBe('TEST-001')
    })

    test('should block operation when GUARD rule fails', async () => {
      const rule = em.create('BusinessRule' as any, {
        ruleId: 'TEST-001',
        ruleName: 'Status Guard',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
        failureActions: [{ type: 'BLOCK_TRANSITION', config: { message: 'Blocked' } }],
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      await em.persistAndFlush(rule)

      const context: RuleEngineContext = {
        entityType: 'WorkOrder',
        entityId: testEntityId,
        data: { status: 'DRAFT' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        dryRun: true,
      }

      const result = await ruleEngine.executeRules(em, context)

      expect(result.allowed).toBe(false)
      expect(result.executedRules).toHaveLength(1)
    })

    test('should allow operation when all GUARD rules pass', async () => {
      const rule1 = em.create('BusinessRule' as any, {
        ruleId: 'TEST-001',
        ruleName: 'Status Guard',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      const rule2 = em.create('BusinessRule' as any, {
        ruleId: 'TEST-002',
        ruleName: 'Priority Guard',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'priority', operator: '=', value: 'HIGH' },
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      await em.persistAndFlush([rule1, rule2])

      const context: RuleEngineContext = {
        entityType: 'WorkOrder',
        entityId: testEntityId,
        data: { status: 'RELEASED', priority: 'HIGH' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        dryRun: true,
      }

      const result = await ruleEngine.executeRules(em, context)

      expect(result.allowed).toBe(true)
      expect(result.executedRules).toHaveLength(2)
      expect(result.executedRules.every((r) => r.conditionResult)).toBe(true)
    })

    test('should continue execution even if one rule fails', async () => {
      const rule1 = em.create('BusinessRule' as any, {
        ruleId: 'TEST-001',
        ruleName: 'Valid Rule',
        ruleType: 'ACTION',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
        successActions: [{ type: 'LOG', config: { message: 'Success' } }],
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      const rule2 = em.create('BusinessRule' as any, {
        ruleId: 'TEST-002',
        ruleName: 'Invalid Condition',
        ruleType: 'ACTION',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'nonexistent', operator: '=', value: 'value' },
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      await em.persistAndFlush([rule1, rule2])

      const context: RuleEngineContext = {
        entityType: 'WorkOrder',
        entityId: testEntityId,
        data: { status: 'RELEASED' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        dryRun: true,
      }

      const result = await ruleEngine.executeRules(em, context)

      expect(result.executedRules).toHaveLength(2)
      expect(result.executedRules[0].conditionResult).toBe(true)
      expect(result.executedRules[1].conditionResult).toBe(false)
    })

    test('should return execution metrics', async () => {
      const rule = em.create('BusinessRule' as any, {
        ruleId: 'TEST-001',
        ruleName: 'Test Rule',
        ruleType: 'ACTION',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
        successActions: [{ type: 'LOG', config: { message: 'Test' } }],
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      await em.persistAndFlush(rule)

      const context: RuleEngineContext = {
        entityType: 'WorkOrder',
        entityId: testEntityId,
        data: { status: 'RELEASED' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        dryRun: true,
      }

      const result = await ruleEngine.executeRules(em, context)

      expect(result.totalExecutionTime).toBeGreaterThan(0)
      expect(result.executedRules[0].executionTime).toBeGreaterThan(0)
    })
  })

  describe('logRuleExecution', () => {
    test('should create execution log with success result', async () => {
      const rule = em.create('BusinessRule' as any, {
        ruleId: 'TEST-001',
        ruleName: 'Test Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,

      await em.persistAndFlush(rule)

      const context: RuleEngineContext = {
        entityType: 'WorkOrder',
        entityId: testEntityId,
        data: { status: 'RELEASED' },
        tenantId: testTenantId,
        organizationId: testOrgId,
      }

      const logId = await ruleEngine.logRuleExecution(em, {
        rule,
        context,
        conditionResult: true,
        actionsExecuted: null,
        executionTime: 42,
      })

      expect(logId).toBeDefined()

      const log = (await em.findOne('RuleExecutionLog' as any, { id: logId })) as any
      expect(log).toBeDefined()
      expect(log!.executionResult).toBe('SUCCESS')
      expect(log!.executionTimeMs).toBe(42)
    })

    test('should create execution log with error result', async () => {
      const rule = em.create('BusinessRule' as any, {
        ruleId: 'TEST-001',
        ruleName: 'Test Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,

      await em.persistAndFlush(rule)

      const context: RuleEngineContext = {
        entityType: 'WorkOrder',
        entityId: testEntityId,
        data: { status: 'DRAFT' },
        tenantId: testTenantId,
        organizationId: testOrgId,
      }

      const logId = await ruleEngine.logRuleExecution(em, {
        rule,
        context,
        conditionResult: false,
        actionsExecuted: null,
        executionTime: 42,
        error: 'Condition failed',
      })

      const log = (await em.findOne('RuleExecutionLog' as any, { id: logId })) as any
      expect(log).toBeDefined()
      expect(log!.executionResult).toBe('ERROR')
      expect(log!.errorMessage).toBe('Condition failed')
    })
  })
})
