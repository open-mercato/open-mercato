const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerEntity, CustomerLabel, CustomerLabelAssignment } from '../../data/entities'
import {
  labelAssignmentIndexEntries,
  removeEntityLabelAssignments,
  restoreEntityLabelAssignments,
} from '../entityLabelAssignments'

const ORG_ID = 'org-1'
const TENANT_ID = 'tenant-1'
const SCOPE = { organizationId: ORG_ID, tenantId: TENANT_ID }

function makeEntity(kind: 'person' | 'company'): CustomerEntity {
  return { id: `${kind}-1`, kind, organizationId: ORG_ID, tenantId: TENANT_ID } as CustomerEntity
}

function makeEm() {
  const created: Array<{ entityClass: unknown; data: Record<string, unknown> }> = []
  const em = {
    nativeDelete: jest.fn(async () => 0),
    create: jest.fn((entityClass: unknown, data: Record<string, unknown>) => {
      created.push({ entityClass, data })
      return data
    }),
    persist: jest.fn(),
  }
  return { em, created, asEm: em as unknown as EntityManager }
}

describe('removeEntityLabelAssignments', () => {
  beforeEach(() => {
    mockFindWithDecryption.mockReset()
  })

  it('locks and deletes only the assignments in the entity scope and returns them for undo', async () => {
    const { em, asEm } = makeEm()
    const company = makeEntity('company')
    const createdAt = new Date('2026-01-01T00:00:00.000Z')
    mockFindWithDecryption.mockResolvedValueOnce([
      { id: 'la-1', label: { id: 'label-1' }, userId: 'user-a', createdAt },
      { id: 'la-2', label: 'label-2', userId: 'user-b', createdAt },
    ])

    const removed = await removeEntityLabelAssignments(asEm, company)

    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      asEm,
      CustomerLabelAssignment,
      { entity: company, ...SCOPE },
      { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'asc' } },
      SCOPE,
    )
    expect(em.nativeDelete).toHaveBeenCalledWith(CustomerLabelAssignment, { id: { $in: ['la-1', 'la-2'] }, ...SCOPE })
    expect(removed).toEqual([
      { id: 'la-1', labelId: 'label-1', userId: 'user-a', createdAt },
      { id: 'la-2', labelId: 'label-2', userId: 'user-b', createdAt },
    ])
  })

  it('skips the delete when the entity carries no labels', async () => {
    const { em, asEm } = makeEm()
    mockFindWithDecryption.mockResolvedValueOnce([])

    expect(await removeEntityLabelAssignments(asEm, makeEntity('person'))).toEqual([])
    expect(em.nativeDelete).not.toHaveBeenCalled()
  })
})

describe('restoreEntityLabelAssignments', () => {
  beforeEach(() => {
    mockFindWithDecryption.mockReset()
  })

  it('restores only assignments whose label still exists in scope for the same owner and is not assigned yet', async () => {
    const { em, created, asEm } = makeEm()
    const person = makeEntity('person')
    const label = { id: 'label-1', userId: 'user-a' }
    mockFindWithDecryption
      .mockResolvedValueOnce([
        label,
        { id: 'label-2', userId: 'user-other' },
        { id: 'label-4', userId: 'user-a' },
      ])
      .mockResolvedValueOnce([{ id: 'la-existing', label: { id: 'label-4' } }])

    const restored = await restoreEntityLabelAssignments(asEm, person, [
      { id: 'la-1', labelId: 'label-1', userId: 'user-a', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'la-2', labelId: 'label-2', userId: 'user-b', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'la-3', labelId: 'label-missing', userId: 'user-a', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'la-4', labelId: 'label-4', userId: 'user-a', createdAt: '2026-01-01T00:00:00.000Z' },
    ])

    expect(mockFindWithDecryption).toHaveBeenNthCalledWith(
      1,
      asEm,
      CustomerLabel,
      { id: { $in: ['label-1', 'label-2', 'label-missing', 'label-4'] }, ...SCOPE },
      undefined,
      SCOPE,
    )
    expect(mockFindWithDecryption).toHaveBeenNthCalledWith(
      2,
      asEm,
      CustomerLabelAssignment,
      { entity: person, ...SCOPE },
      undefined,
      SCOPE,
    )
    expect(em.nativeDelete).not.toHaveBeenCalled()
    expect(restored.map((row) => row.id)).toEqual(['la-1'])
    expect(created).toEqual([
      {
        entityClass: CustomerLabelAssignment,
        data: {
          id: 'la-1',
          ...SCOPE,
          userId: 'user-a',
          label,
          entity: person,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      },
    ])
    expect(em.persist).toHaveBeenCalledTimes(1)
  })

  it('does nothing for undo payloads written before label assignments were captured', async () => {
    const { em, created, asEm } = makeEm()

    expect(await restoreEntityLabelAssignments(asEm, makeEntity('company'), undefined)).toEqual([])
    expect(await restoreEntityLabelAssignments(asEm, makeEntity('company'), [])).toEqual([])
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    expect(em.nativeDelete).not.toHaveBeenCalled()
    expect(created).toEqual([])
  })
})

describe('labelAssignmentIndexEntries', () => {
  it('maps rows to scoped query-index entries', () => {
    expect(labelAssignmentIndexEntries(SCOPE, [{ id: 'la-1', labelId: 'label-1', userId: 'user-a', createdAt: new Date() }])).toEqual([
      { entityType: 'customers:customer_label_assignment', recordId: 'la-1', ...SCOPE },
    ])
    expect(labelAssignmentIndexEntries(SCOPE, undefined)).toEqual([])
  })
})
