/**
 * Completion-time form validation across BOTH accepted `formSchema` shapes.
 *
 * `validateFormData` used to check required-key presence only for the
 * JSON-Schema shape, so a task authored in the Studio — which writes
 * `{ fields: [...] }` with a per-field `required` flag — validated nothing at
 * all. These pin both shapes and restrict completion writes to declared fields.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { completeUserTask, UserTaskError } from '../task-handler'

const tenantId = '11111111-1111-1111-1111-111111111111'
const organizationId = '33333333-3333-3333-3333-333333333333'
const userId = '55555555-5555-5555-5555-555555555555'
const taskId = '77777777-7777-7777-7777-777777777777'
const scope = { tenantId, organizationId }

function makeEm(formSchema: unknown) {
  const task = {
    id: taskId,
    tenantId,
    organizationId,
    workflowInstanceId: 'wi',
    stepInstanceId: 'si',
    taskName: 'Approve order',
    status: 'PENDING',
    assignedTo: null,
    assignedToRoles: ['approver'],
    claimedBy: null,
    formSchema,
  }

  return {
    task,
    em: {
      // Only the task lookup succeeds; the instance lookup that follows returns
      // null, so a run that passes validation stops with INSTANCE_NOT_FOUND —
      // which is exactly the signal that validation let it through.
      findOne: jest.fn(async (_entity: unknown, where: Record<string, unknown>) =>
        where.id === taskId ? task : null
      ),
      flush: jest.fn(async () => undefined),
      create: jest.fn(() => ({})),
      persist: jest.fn(function persist(this: unknown) {
        return { flush: async () => undefined }
      }),
    } as unknown as EntityManager,
  }
}

const container = { resolve: jest.fn(() => undefined) } as unknown as AwilixContainer

const complete = (em: EntityManager, formData: Record<string, unknown>) =>
  completeUserTask(em, container, { taskId, formData, userId, scope })

describe('validateFormData — the JSON-Schema shape', () => {
  beforeEach(() => jest.clearAllMocks())

  test('rejects a missing required field', async () => {
    const { em } = makeEm({ properties: { amount: { type: 'number' } }, required: ['amount'] })

    await expect(complete(em, {})).rejects.toMatchObject({ code: 'FORM_VALIDATION_FAILED' })
  })

  test('accepts a supplied required field', async () => {
    const { em } = makeEm({ properties: { amount: { type: 'number' } }, required: ['amount'] })

    await expect(complete(em, { amount: 12 })).rejects.toMatchObject({
      code: 'INSTANCE_NOT_FOUND',
    })
  })
})

describe('validateFormData — the Studio `{ fields: [...] }` shape', () => {
  beforeEach(() => jest.clearAllMocks())

  test('rejects a missing field the author marked required', async () => {
    const { em } = makeEm({
      fields: [{ name: 'reason', type: 'text', label: 'Reason', required: true }],
    })

    await expect(complete(em, {})).rejects.toMatchObject({ code: 'FORM_VALIDATION_FAILED' })
  })

  test('accepts it once supplied', async () => {
    const { em } = makeEm({
      fields: [{ name: 'reason', type: 'text', label: 'Reason', required: true }],
    })

    await expect(complete(em, { reason: 'looks fine' })).rejects.toMatchObject({
      code: 'INSTANCE_NOT_FOUND',
    })
  })

  test('an optional field is still optional', async () => {
    const { em } = makeEm({ fields: [{ name: 'note', type: 'text', label: 'Note' }] })

    await expect(complete(em, {})).rejects.toMatchObject({ code: 'INSTANCE_NOT_FOUND' })
  })
})

describe('empty submissions remain supported without required fields', () => {
  beforeEach(() => jest.clearAllMocks())

  test('completes with an empty payload exactly as before', async () => {
    const { em } = makeEm(null)

    await expect(complete(em, {})).rejects.toMatchObject({ code: 'INSTANCE_NOT_FOUND' })
  })

  test('a schema with no required fields accepts an empty submission', async () => {
    const { em } = makeEm({ properties: { amount: { type: 'number' } } })

    await expect(complete(em, {})).rejects.toMatchObject({ code: 'INSTANCE_NOT_FOUND' })
  })
})

describe('UserTaskError shape', () => {
  test('a validation failure is reported as a UserTaskError, not a raw Error', async () => {
    const { em } = makeEm({ properties: { amount: {} }, required: ['amount'] })

    await expect(complete(em, {})).rejects.toBeInstanceOf(UserTaskError)
  })
})


describe('issue 9142 completion field allowlist', () => {
  const schemas = [
    { properties: { note: { type: 'string' }, amount: { type: 'number' } } },
    { fields: [{ name: 'note', type: 'text' }, { name: 'amount', type: 'number' }] },
  ]

  test.each(schemas)('rejects undeclared context keys for schema %j before any flush', async (formSchema) => {
    const { em, task } = makeEm(formSchema)
    const before = { ...task }

    await expect(complete(em, { note: 'ok', id: 'another-order', approved: true }))
      .rejects.toMatchObject({ code: 'FORM_VALIDATION_FAILED' })

    expect(task).toEqual(before)
    expect(em.flush).not.toHaveBeenCalled()
    expect(em.create).not.toHaveBeenCalled()
    expect(em.persist).not.toHaveBeenCalled()
    expect(em.findOne).toHaveBeenCalledTimes(1)
  })

  test.each([null, {}, { fields: [] }, { properties: {} }])(
    'rejects nonempty submissions when no fields are declared: %j', async (formSchema) => {
      const { em, task } = makeEm(formSchema)
      await expect(complete(em, { approved: true }))
        .rejects.toMatchObject({ code: 'FORM_VALIDATION_FAILED' })
      expect(task.status).toBe('PENDING')
      expect(em.flush).not.toHaveBeenCalled()
    },
  )

  test.each(['__result', '__park', '__error', '__decision', '__custom', '__proto__', '_pendingAsyncActivities'])(
    'rejects reserved key %s even when declared', async (field) => {
      const formData = { [field]: 'forged' }
      for (const formSchema of [
        { properties: { [field]: { type: 'string' } } },
        { fields: [{ name: field, type: 'text' }] },
      ]) {
        const { em } = makeEm(formSchema)
        await expect(complete(em, formData)).rejects.toMatchObject({ code: 'FORM_VALIDATION_FAILED' })
        expect(em.flush).not.toHaveBeenCalled()
      }
    },
  )

  test('an inherited property name is not an authored field', async () => {
    const { em } = makeEm({ properties: { note: {} } })
    await expect(complete(em, { toString: 'forged' }))
      .rejects.toMatchObject({ code: 'FORM_VALIDATION_FAILED' })
    expect(em.flush).not.toHaveBeenCalled()
  })

  test.each(schemas)('preserves falsy values and optional fields for %j', async (formSchema) => {
    const { em } = makeEm(formSchema)
    await expect(complete(em, { note: '', amount: 0 }))
      .rejects.toMatchObject({ code: 'INSTANCE_NOT_FOUND' })
  })

  test('preserves authored nested values without introducing type validation', async () => {
    const { em } = makeEm({ properties: { address: { type: 'object' }, approved: { type: 'boolean' } } })
    await expect(complete(em, { address: { city: 'Warsaw', unit: null }, approved: false }))
      .rejects.toMatchObject({ code: 'INSTANCE_NOT_FOUND' })
  })
})
