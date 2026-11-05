import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import {
  scheduleCreateSchema,
  scheduleUpdateSchema,
} from '../validators'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'

const tenantId = '123e4567-e89b-12d3-a456-426614174000'
const organizationId = '123e4567-e89b-12d3-a456-426614174001'
const scheduleId = '123e4567-e89b-12d3-a456-426614174002'

const REGISTRY_KEY = '__openMercatoModulesRegistry__'

beforeAll(() => {
  registerModules([
    {
      id: 'test_module',
      workers: [
        {
          id: 'test_module:workers:safe',
          queue: 'test-module-safe-queue',
          concurrency: 1,
          schedulerSafe: true,
          handler: async () => {},
        },
        {
          id: 'test_module:workers:internal',
          queue: 'stripe-webhook',
          concurrency: 1,
          handler: async () => {},
        },
      ],
    },
  ] as never)
})

afterAll(() => {
  ;(globalThis as Record<string, unknown>)[REGISTRY_KEY] = null
})

describe('scheduler queue target authorization (#5213)', () => {
  describe('scheduleCreateSchema', () => {
    it('accepts a queue target declared scheduler-safe by its worker', () => {
      const result = scheduleCreateSchema.parse({
        name: 'Safe queue schedule',
        scopeType: 'organization',
        organizationId,
        tenantId,
        scheduleType: 'interval',
        scheduleValue: '15m',
        targetType: 'queue',
        targetQueue: 'test-module-safe-queue',
      })

      expect(result.targetQueue).toBe('test-module-safe-queue')
    })

    it('rejects a queue target the worker did not declare scheduler-safe', () => {
      expect(() =>
        scheduleCreateSchema.parse({
          name: 'Internal sink schedule',
          scopeType: 'organization',
          organizationId,
          tenantId,
          scheduleType: 'interval',
          scheduleValue: '15m',
          targetType: 'queue',
          targetQueue: 'stripe-webhook',
        })
      ).toThrow(/not an approved scheduler target/)
    })

    it('rejects an unknown queue target', () => {
      expect(() =>
        scheduleCreateSchema.parse({
          name: 'Unknown queue schedule',
          scopeType: 'organization',
          organizationId,
          tenantId,
          scheduleType: 'interval',
          scheduleValue: '15m',
          targetType: 'queue',
          targetQueue: 'no-such-queue-anywhere',
        })
      ).toThrow(/not an approved scheduler target/)
    })
  })

  describe('scheduleUpdateSchema', () => {
    // Queue-safety rules for updates live in the scheduler.jobs.update command
    // (change-detection against the stored row), so unchanged targets resent by
    // the edit form and legacy remediation stay possible (#5213 N1).
    // See commands/__tests__/jobs.target-guard.test.ts for that coverage.
    it('accepts the request shape the edit form sends for an unchanged target', () => {
      const result = scheduleUpdateSchema.parse({
        id: scheduleId,
        targetType: 'queue',
        targetQueue: 'stripe-webhook',
        isEnabled: false,
      })
      expect(result.isEnabled).toBe(false)
    })

    it('still rejects changing to a queue without providing the queue value', () => {
      expect(() =>
        scheduleUpdateSchema.parse({ id: scheduleId, targetType: 'queue' })
      ).toThrow(/corresponding targetQueue/)
    })
  })
})
