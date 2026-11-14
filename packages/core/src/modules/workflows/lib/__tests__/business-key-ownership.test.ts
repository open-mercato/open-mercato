/** @jest-environment node */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import { UniqueConstraintViolationException } from '@mikro-orm/core'

const findOneWithDecryption = jest.fn<(...args: unknown[]) => Promise<unknown>>()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))

import { WorkflowBusinessKeyHeldError, reopenWorkflowInstance } from '../business-key-ownership'
import type { WorkflowInstance } from '../../data/entities'
import { registerTelemetryRuntime, type TelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

function registerThrowingTelemetry() {
  const reportError = jest.fn(() => {
    throw new Error('telemetry exporter down')
  })
  const unregister = registerTelemetryRuntime({
    canUseGlobalTracePropagation: () => false,
    captureTraceContext: () => ({}),
    continueTrace: (_carrier, _name, fn) => fn(),
    recordHttpDuration: () => {},
    reportError,
    shutdown: async () => {},
  } satisfies TelemetryRuntime)
  return { reportError, unregister }
}

function makeInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-a',
    status: 'FAILED',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    workflowId: 'wf-1',
    businessKey: 'order:42',
    ...overrides,
  } as unknown as WorkflowInstance
}

function makeEm() {
  const em = {
    flush: jest.fn(async () => undefined),
    refresh: jest.fn(async () => undefined),
    transactional: jest.fn(async (work: (trx: unknown) => Promise<unknown>) => work(em)),
  }
  return em
}

describe('reopenWorkflowInstance', () => {
  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findOneWithDecryption.mockResolvedValue(null)
  })

  test('refuses before writing anything while another run holds the key open', async () => {
    findOneWithDecryption.mockResolvedValue({ id: 'run-b' })
    const em = makeEm()
    const reopen = jest.fn()
    const audit = jest.fn(async () => undefined)

    await expect(
      reopenWorkflowInstance(em as never, makeInstance(), { reopen, audit }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_BUSINESS_KEY_HELD', holderInstanceId: 'run-b' })

    expect(reopen).not.toHaveBeenCalled()
    expect(audit).not.toHaveBeenCalled()
    expect(em.transactional).not.toHaveBeenCalled()
  })

  test('looks the holder up in the instance scope, excluding the instance itself', async () => {
    await reopenWorkflowInstance(makeEm() as never, makeInstance(), { reopen: jest.fn() })

    const [, , where, , scope] = findOneWithDecryption.mock.calls[0]
    expect(where).toMatchObject({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      workflowId: 'wf-1',
      businessKey: 'order:42',
      deletedAt: null,
      id: { $ne: 'run-a' },
    })
    expect(scope).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  test.each([
    ['a keyless instance', { businessKey: null }],
    ['a parked instance, which already owns its key', { status: 'PAUSED' }],
  ])('does not look for a holder for %s', async (_label, overrides) => {
    const em = makeEm()
    const reopen = jest.fn()

    await reopenWorkflowInstance(em as never, makeInstance(overrides), { reopen })

    expect(findOneWithDecryption).not.toHaveBeenCalled()
    expect(reopen).toHaveBeenCalledTimes(1)
    expect(em.flush).toHaveBeenCalledTimes(1)
  })

  test('commits the reopen before the audit record, in one transaction', async () => {
    const em = makeEm()
    const order: string[] = []
    em.flush.mockImplementation(async () => {
      order.push('flush')
    })

    await reopenWorkflowInstance(em as never, makeInstance(), {
      reopen: () => order.push('reopen'),
      audit: async () => {
        order.push('audit')
      },
    })

    expect(order).toEqual(['reopen', 'flush', 'audit'])
    expect(em.transactional).toHaveBeenCalledTimes(1)
  })

  test('turns a racing unique violation into the domain conflict and restores the instance', async () => {
    const em = makeEm()
    const audit = jest.fn(async () => undefined)
    const instance = makeInstance()
    em.flush.mockRejectedValueOnce(new UniqueConstraintViolationException(new Error('duplicate key')))
    findOneWithDecryption.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'run-b' })

    await expect(
      reopenWorkflowInstance(em as never, instance, { reopen: jest.fn(), audit }),
    ).rejects.toMatchObject({ holderInstanceId: 'run-b' })

    expect(audit).not.toHaveBeenCalled()
    expect(em.refresh).toHaveBeenCalledWith(instance)
  })

  test('reports a conflict with no holder when the racing run ended before it could be read', async () => {
    const em = makeEm()
    em.flush.mockRejectedValueOnce(new UniqueConstraintViolationException(new Error('duplicate key')))

    const refusal = await reopenWorkflowInstance(em as never, makeInstance(), { reopen: jest.fn() }).catch(
      (error: unknown) => error,
    )

    expect(refusal).toBeInstanceOf(WorkflowBusinessKeyHeldError)
    expect((refusal as WorkflowBusinessKeyHeldError).holderInstanceId).toBeNull()
  })

  test('a failed audit write restores the instance and surfaces the original error', async () => {
    const em = makeEm()
    const instance = makeInstance()
    const failure = new Error('audit down')

    await expect(
      reopenWorkflowInstance(em as never, instance, {
        reopen: jest.fn(),
        audit: async () => {
          throw failure
        },
      }),
    ).rejects.toBe(failure)

    expect(em.refresh).toHaveBeenCalledWith(instance)
  })

  test('a failed restore never masks the original error, and drops the identity map', async () => {
    const em = { ...makeEm(), clear: jest.fn() }
    em.transactional = jest.fn(async () => {
      throw new Error('connection lost')
    })
    em.refresh.mockRejectedValueOnce(new Error('still down'))

    await expect(
      reopenWorkflowInstance(em as never, makeInstance(), { reopen: jest.fn() }),
    ).rejects.toThrow('connection lost')

    expect(em.clear).toHaveBeenCalledTimes(1)
  })

  test('a throwing telemetry runtime neither skips the identity-map clear nor replaces the original error', async () => {
    const { reportError, unregister } = registerThrowingTelemetry()
    try {
      const em = { ...makeEm(), clear: jest.fn() }
      em.transactional = jest.fn(async () => {
        throw new Error('connection lost')
      })
      em.refresh.mockRejectedValueOnce(new Error('still down'))

      await expect(
        reopenWorkflowInstance(em as never, makeInstance(), { reopen: jest.fn() }),
      ).rejects.toThrow('connection lost')

      expect(em.clear).toHaveBeenCalledTimes(1)
      expect(reportError).toHaveBeenCalledTimes(1)
    } finally {
      unregister()
    }
  })

  test('a unique violation on a keyless instance is not a business-key conflict', async () => {
    const em = makeEm()
    const failure = new UniqueConstraintViolationException(new Error('duplicate key'))
    em.flush.mockRejectedValueOnce(failure)

    await expect(
      reopenWorkflowInstance(em as never, makeInstance({ businessKey: null }), { reopen: jest.fn() }),
    ).rejects.toBe(failure)
  })
})
