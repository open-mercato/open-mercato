import type { EntityManager } from '@mikro-orm/postgresql'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import { HybridQueryEngine } from '../lib/engine'

const em = {
  getMetadata: () => ({ find: () => ({ tableName: 'global_records' }), getAll: () => [{ className: 'GlobalRecord', tableName: 'global_records', properties: {} }] }),
  getKysely: () => ({ selectFrom: jest.fn(() => { throw new Error('unexpected data read') }) }),
} as unknown as EntityManager

type EngineInternals = {
  columnExists: (table: string, column: string) => Promise<boolean>
  tableExists: (table: string) => Promise<boolean>
  isCustomEntity: (entity: string) => Promise<boolean>
  searchAvailability: () => { staticEnabled: () => Promise<boolean> }
  queryFallback: () => Promise<{ items: unknown[]; total: number }>
}

describe('global base tables require explicit scope opt-out', () => {
  it.each(['basic', 'hybrid'] as const)('%s denies before data reads', async (kind) => {
    const engine = kind === 'basic' ? new BasicQueryEngine(em) : new HybridQueryEngine(em, new BasicQueryEngine(em))
    const internal = engine as unknown as EngineInternals
    jest.spyOn(internal, 'columnExists').mockResolvedValue(false)
    jest.spyOn(internal, 'searchAvailability').mockReturnValue({ staticEnabled: async () => false })
    if (kind === 'hybrid') {
      jest.spyOn(internal, 'tableExists').mockResolvedValue(true)
      jest.spyOn(internal, 'isCustomEntity').mockResolvedValue(false)
    }
    await expect(engine.query('test:global_record', { tenantId: 'tenant-a' })).rejects.toThrow('QueryEngine: unscoped base table requires explicit scope opt-out')
  })

  it('hybrid delegates an explicit opt-out to the basic engine', async () => {
    const engine = new HybridQueryEngine(em, new BasicQueryEngine(em))
    const internal = engine as unknown as EngineInternals
    jest.spyOn(internal, 'columnExists').mockResolvedValue(false)
    jest.spyOn(internal, 'searchAvailability').mockReturnValue({ staticEnabled: async () => false })
    jest.spyOn(internal, 'tableExists').mockResolvedValue(true)
    jest.spyOn(internal, 'isCustomEntity').mockResolvedValue(false)
    const fallback = jest.spyOn(internal, 'queryFallback').mockResolvedValue({ items: [], total: 0 })
    await expect(engine.query('test:global_record', { tenantId: 'tenant-a', omitAutomaticTenantOrgScope: true })).resolves.toEqual({ items: [], total: 0 })
    expect(fallback).toHaveBeenCalled()
  })
})
