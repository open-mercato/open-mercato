/** @jest-environment node */

import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  assertPutawayAssignable,
  assertPutawayCancellable,
  assertPutawayCompleteAuthorized,
  assertPutawayCompletable,
  assertPutawayConfirmedQuantity,
  assertPutawayDeletable,
  assertPutawayLifecycleFieldsForbidden,
  assertPutawayStartable,
  assertPutawayTargetLocationType,
  buildPutawayCompleteReferenceId,
  buildPutawayTaskStatusFilter,
  computeUncommittedPutawaySourceQuantity,
  hasUncommittedPutawaySourceQuantity,
  putawayResidualQuantity,
  selectCoveringOpenPutawayTask,
} from '../putaway'

describe('putaway lifecycle guards', () => {
  it('allows assign/start/complete/cancel for open tasks', () => {
    expect(() => assertPutawayAssignable('open')).not.toThrow()
    expect(() => assertPutawayStartable('open')).not.toThrow()
    expect(() => assertPutawayCompletable('open')).not.toThrow()
    expect(() => assertPutawayCancellable('open')).not.toThrow()
  })

  it('allows start/complete for in_progress tasks', () => {
    expect(() => assertPutawayStartable('in_progress')).not.toThrow()
    expect(() => assertPutawayCompletable('in_progress')).not.toThrow()
    expect(() => assertPutawayAssignable('in_progress')).not.toThrow()
  })

  it('rejects terminal states', () => {
    expect(() => assertPutawayAssignable('done')).toThrow(CrudHttpError)
    expect(() => assertPutawayCompletable('cancelled')).toThrow(CrudHttpError)
    expect(() => assertPutawayCancellable('done')).toThrow(CrudHttpError)
    expect(() => assertPutawayStartable('done')).toThrow(CrudHttpError)
    try {
      assertPutawayCompletable('done')
    } catch (error) {
      expect(error).toBeInstanceOf(CrudHttpError)
      expect((error as CrudHttpError).status).toBe(409)
    }
  })

  it('allows delete only for cancelled (done is permanent history)', () => {
    expect(() => assertPutawayDeletable('cancelled')).not.toThrow()
    expect(() => assertPutawayDeletable('done')).toThrow(CrudHttpError)
    expect(() => assertPutawayDeletable('open')).toThrow(CrudHttpError)
    expect(() => assertPutawayDeletable('in_progress')).toThrow(CrudHttpError)
    try {
      assertPutawayDeletable('open')
    } catch (error) {
      expect(error).toBeInstanceOf(CrudHttpError)
      expect((error as CrudHttpError).status).toBe(409)
      expect((error as CrudHttpError).body).toMatchObject({
        error: 'putaway_delete_requires_terminal_status',
      })
    }
    try {
      assertPutawayDeletable('done')
    } catch (error) {
      expect(error).toBeInstanceOf(CrudHttpError)
      expect((error as CrudHttpError).status).toBe(409)
      expect((error as CrudHttpError).body).toMatchObject({
        error: 'putaway_delete_done_forbidden',
      })
    }
  })

  it('allows manage_putaway to complete any task; operators only when assigned', () => {
    const actor = '99999999-9999-4999-8999-999999999999'
    expect(() =>
      assertPutawayCompleteAuthorized({
        canManagePutaway: true,
        canAdjustInventory: false,
        actorUserId: actor,
        assignedTo: null,
      }),
    ).not.toThrow()
    expect(() =>
      assertPutawayCompleteAuthorized({
        canManagePutaway: false,
        canAdjustInventory: true,
        actorUserId: actor,
        assignedTo: actor,
      }),
    ).not.toThrow()
    expect(() =>
      assertPutawayCompleteAuthorized({
        canManagePutaway: false,
        canAdjustInventory: true,
        actorUserId: actor,
        assignedTo: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    ).toThrow(CrudHttpError)
    expect(() =>
      assertPutawayCompleteAuthorized({
        canManagePutaway: false,
        canAdjustInventory: true,
        actorUserId: actor,
        assignedTo: null,
      }),
    ).toThrow(CrudHttpError)
  })

  it('rejects over-complete quantities and computes residual for under', () => {
    expect(() => assertPutawayConfirmedQuantity(5, 5)).not.toThrow()
    expect(() => assertPutawayConfirmedQuantity(5, 4)).not.toThrow()
    expect(() => assertPutawayConfirmedQuantity(5, 6)).toThrow(CrudHttpError)
    expect(putawayResidualQuantity(5, 3)).toBe(2)
    expect(putawayResidualQuantity(5, 5)).toBe(0)
  })

  it('rejects staging/dock putaway targets', () => {
    expect(() => assertPutawayTargetLocationType('bin')).not.toThrow()
    expect(() => assertPutawayTargetLocationType('slot')).not.toThrow()
    expect(() => assertPutawayTargetLocationType('staging')).toThrow(CrudHttpError)
    expect(() => assertPutawayTargetLocationType('dock')).toThrow(CrudHttpError)
  })

  it('builds a qty-independent putaway-complete reference id', () => {
    const taskId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const a = buildPutawayCompleteReferenceId(taskId)
    const b = buildPutawayCompleteReferenceId(taskId)
    expect(a).toBe(b)
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
    // Different task → different reference (prevents cross-task idempotency collision)
    expect(buildPutawayCompleteReferenceId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).not.toBe(a)
  })
})

describe('buildPutawayTaskStatusFilter', () => {
  it('returns $eq for a single status', () => {
    expect(buildPutawayTaskStatusFilter('open')).toEqual({ $eq: 'open' })
  })

  it('returns $in for comma-separated active-queue statuses', () => {
    expect(buildPutawayTaskStatusFilter('open,in_progress')).toEqual({
      $in: ['open', 'in_progress'],
    })
  })

  it('dedupes and ignores blank/invalid tokens', () => {
    expect(buildPutawayTaskStatusFilter('open, open, bogus,in_progress')).toEqual({
      $in: ['open', 'in_progress'],
    })
    expect(buildPutawayTaskStatusFilter('')).toBeUndefined()
    expect(buildPutawayTaskStatusFilter(undefined)).toBeUndefined()
    expect(buildPutawayTaskStatusFilter('not-a-status')).toBeUndefined()
  })
})

describe('assertPutawayLifecycleFieldsForbidden', () => {
  it('rejects status and assignedTo on CRUD payloads', () => {
    expect(() => assertPutawayLifecycleFieldsForbidden({ status: 'done' })).toThrow(CrudHttpError)
    expect(() =>
      assertPutawayLifecycleFieldsForbidden({
        assignedTo: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    ).toThrow(CrudHttpError)
    expect(() =>
      assertPutawayLifecycleFieldsForbidden({
        assigned_to: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    ).toThrow(CrudHttpError)
    expect(() => assertPutawayLifecycleFieldsForbidden({ priority: 3 })).not.toThrow()
  })
})

describe('uncommitted putaway source quantity', () => {
  it('subtracts open putaway commitments from available balance', () => {
    expect(
      computeUncommittedPutawaySourceQuantity({
        quantityOnHand: 10,
        quantityReserved: 2,
        quantityAllocated: 1,
        openPutawayQuantities: [3, 2],
      }),
    ).toBe(2)
    expect(hasUncommittedPutawaySourceQuantity(2, 2)).toBe(true)
    expect(hasUncommittedPutawaySourceQuantity(2, 2.001)).toBe(false)
  })

  it('selects the smallest open putaway that covers the requested qty', () => {
    const tasks = [
      { id: 'a', quantity: 10 },
      { id: 'b', quantity: 5 },
      { id: 'c', quantity: 3 },
    ]
    expect(selectCoveringOpenPutawayTask(tasks, 5)?.id).toBe('b')
    expect(selectCoveringOpenPutawayTask(tasks, 7)?.id).toBe('a')
    expect(selectCoveringOpenPutawayTask(tasks, 11)).toBeNull()
    expect(selectCoveringOpenPutawayTask([], 1)).toBeNull()
  })
})
