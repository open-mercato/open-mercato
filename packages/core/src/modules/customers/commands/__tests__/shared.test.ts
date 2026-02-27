import * as shared from '../shared'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  CustomerDictionaryEntry,
  CustomerTag,
  CustomerTagAssignment,
} from '../../data/entities'

const {
  ensureTenantScope,
  ensureOrganizationScope,
  ensureSameScope,
  extractUndoPayload,
  assertFound,
  ensureDictionaryEntry,
  loadEntityTagIds,
  syncEntityTags,
} = shared

describe('customers commands shared utilities', () => {
  describe('scope guards', () => {
    it('allows matching tenant scope and throws on mismatch', () => {
      const ctx = { auth: { tenantId: 'tenant-1' } } as any
      expect(() => ensureTenantScope(ctx, 'tenant-1')).not.toThrow()
      expect(() => ensureTenantScope(ctx, 'tenant-2')).toThrow(CrudHttpError)
    })

    it('allows matching organization scope and throws on mismatch', () => {
      const ctx = { auth: { orgId: 'org-1' }, selectedOrganizationId: null } as any
      expect(() => ensureOrganizationScope(ctx, 'org-1')).not.toThrow()
      expect(() => ensureOrganizationScope(ctx, 'org-2')).toThrow(CrudHttpError)
    })

    it('ensures same scope for related entities', () => {
      const entity = { organizationId: 'org-1', tenantId: 'tenant-1' }
      expect(() => ensureSameScope(entity, 'org-1', 'tenant-1')).not.toThrow()
      expect(() => ensureSameScope(entity, 'org-2', 'tenant-1')).toThrow(CrudHttpError)
      expect(() => ensureSameScope(entity, 'org-1', 'tenant-2')).toThrow(CrudHttpError)
    })
  })

  describe('extractUndoPayload', () => {
    it('returns undo payload from direct property', () => {
      const logEntry = { commandPayload: { undo: { foo: 'bar' } } }
      expect(extractUndoPayload(logEntry as any)).toEqual({ foo: 'bar' })
    })

    it('returns undo payload from nested value property', () => {
      const logEntry = { commandPayload: { value: { undo: { id: 1 } } } }
      expect(extractUndoPayload(logEntry as any)).toEqual({ id: 1 })
    })

    it('returns null when undo payload is absent', () => {
      expect(extractUndoPayload(null)).toBeNull()
      expect(extractUndoPayload({ commandPayload: { something: {} } } as any)).toBeNull()
    })
  })

  describe('assertFound', () => {
    it('returns value when present and throws otherwise', () => {
      const record = { id: '123' }
      expect(assertFound(record, 'Missing')).toBe(record)
      expect(() => assertFound(null, 'Missing')).toThrow(CrudHttpError)
    })
  })

  describe('ensureDictionaryEntry', () => {
    const createEm = () => ({
      findOne: jest.fn(),
      create: jest.fn((_cls, payload) => ({ id: 'new-entry', ...payload })),
      persist: jest.fn(),
    })

    it('returns null when value is empty after trimming', async () => {
      const em = createEm()
      const result = await ensureDictionaryEntry(em as any, {
        tenantId: 't1',
        organizationId: 'o1',
        kind: 'status',
        value: '   ',
      })
      expect(result).toBeNull()
      expect(em.findOne).not.toHaveBeenCalled()
    })

    it('throws when dictionary kind is unsupported', async () => {
      const em = createEm()
      await expect(
        ensureDictionaryEntry(em as any, {
          tenantId: 't1',
          organizationId: 'o1',
          kind: 'unsupported' as any,
          value: 'Hot',
        })
      ).rejects.toThrow(CrudHttpError)
    })

    it('updates existing entry with normalized color and icon', async () => {
      const existing = Object.assign(new CustomerDictionaryEntry(), {
        id: 'entry-1',
        tenantId: 't1',
        organizationId: 'o1',
        kind: 'status',
        value: 'Hot',
        normalizedValue: 'hot',
        label: 'Hot',
        color: '#ff0000',
        icon: 'flame',
        updatedAt: new Date(0),
      })

      const em = createEm()
      em.findOne.mockResolvedValue(existing)

      const iconInput = 'x'.repeat(60)
      const result = await ensureDictionaryEntry(em as any, {
        tenantId: 't1',
        organizationId: 'o1',
        kind: 'status',
        value: '  HOT ',
        color: '#ABCDEF',
        icon: iconInput,
      })

      expect(result).toBe(existing)
      expect(existing.color).toBe('#abcdef')
      expect(existing.icon).toBe(iconInput.slice(0, 48))
      expect(em.persist).toHaveBeenCalledWith(existing)
    })

    it('creates new entry when none exists', async () => {
      const em = createEm()
      em.findOne.mockResolvedValue(null)

      const result = await ensureDictionaryEntry(em as any, {
        tenantId: 't1',
        organizationId: 'o1',
        kind: 'status',
        value: ' Hot ',
      })

      expect(em.create).toHaveBeenCalledWith(
        CustomerDictionaryEntry,
        expect.objectContaining({
          tenantId: 't1',
          organizationId: 'o1',
          kind: 'status',
          value: 'Hot',
          label: 'Hot',
          normalizedValue: 'hot',
          color: null,
          icon: null,
        })
      )
      expect(em.persist).toHaveBeenCalledWith(result)
      expect(result).toMatchObject({
        id: 'new-entry',
        value: 'Hot',
        label: 'Hot',
        normalizedValue: 'hot',
      })
    })
  })

  describe('entity tag helpers', () => {
    it('loads tag ids resolving references', async () => {
      const em = {
        find: jest.fn().mockResolvedValue([
          { tag: 'tag-1' },
          { tag: { id: 'tag-2' } },
        ]),
      }
      const entity = { id: 'entity' } as any
      const ids = await loadEntityTagIds(em as any, entity)
      expect(ids).toEqual(['tag-1', 'tag-2'])
      expect(em.find).toHaveBeenCalledWith(
        CustomerTagAssignment,
        { entity },
        { populate: ['tag'] }
      )
    })

    it('syncs entity tags by removing missing and adding new ones', async () => {
      const entity = { id: 'entity-1', tenantId: 't1', organizationId: 'o1' } as any
      const em = {
        nativeDelete: jest.fn().mockResolvedValue(undefined),
        find: jest.fn(async (model, where) => {
          if (model === CustomerTagAssignment) {
            return [{ tag: 'tag-1' }]
          }
          if (model === CustomerTag) {
            return [{ id: 'tag-2' }]
          }
          return []
        }),
        create: jest.fn((_cls, payload) => payload),
        persist: jest.fn(),
        getReference: jest.fn((_cls, id) => ({ id })),
      }

      await syncEntityTags(em as any, entity, ['tag-2', 'tag-2'])

      expect(em.nativeDelete).toHaveBeenCalledWith(CustomerTagAssignment, {
        entity,
        tag: { $in: ['tag-1'] },
      })
      expect(em.find).toHaveBeenCalledWith(
        CustomerTag,
        {
          id: { $in: ['tag-2'] },
          organizationId: 'o1',
          tenantId: 't1',
        }
      )
      expect(em.getReference).toHaveBeenCalledWith(CustomerTag, 'tag-2')
      expect(em.create).toHaveBeenCalledWith(
        CustomerTagAssignment,
        expect.objectContaining({
          tenantId: 't1',
          organizationId: 'o1',
          entity,
        })
      )
      expect(em.persist).toHaveBeenCalled()
    })

    it('throws when new tags are missing in scope', async () => {
      const entity = { id: 'entity-1', tenantId: 't1', organizationId: 'o1' } as any
      const em = {
        nativeDelete: jest.fn(),
        find: jest.fn(async (model) => {
          if (model === CustomerTagAssignment) {
            return []
          }
          if (model === CustomerTag) {
            return []
          }
          return []
        }),
        create: jest.fn(),
        persist: jest.fn(),
        getReference: jest.fn(),
      }

      await expect(syncEntityTags(em as any, entity, ['tag-2'])).rejects.toThrow(CrudHttpError)
    })

    it('skips work when tags argument is undefined', async () => {
      const entity = { id: 'entity-1', tenantId: 't1', organizationId: 'o1' } as any
      const em = {
        nativeDelete: jest.fn(),
        find: jest.fn(),
        create: jest.fn(),
        persist: jest.fn(),
        getReference: jest.fn(),
      }
      await syncEntityTags(em as any, entity, undefined)
      expect(em.find).not.toHaveBeenCalled()
      expect(em.nativeDelete).not.toHaveBeenCalled()
    })
  })
})

