import { EntityManager } from '@mikro-orm/postgresql'
import { getOverrides, GetOverridesQuery } from '../../lib/queries'
import { FeatureToggle, FeatureToggleOverride } from '../../data/entities'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'

describe('getOverrides', () => {
    let em: EntityManager

    const mockTenant1 = { id: 'tenant-1', name: 'Tenant 1' } as Tenant

    const mockToggle1 = {
        id: 'toggle-1',
        identifier: 'toggle.one',
        name: 'Toggle One',
        category: 'cat1',
        defaultState: false,
    } as FeatureToggle

    const mockToggle2 = {
        id: 'toggle-2',
        identifier: 'toggle.two',
        name: 'Toggle Two',
        category: 'cat2',
        defaultState: true,
    } as FeatureToggle

    const mockOverride1 = {
        id: 'override-1',
        toggle: { id: 'toggle-1' },
        tenantId: 'tenant-1',
        state: 'enabled',
    } as FeatureToggleOverride

    beforeEach(() => {
        em = {
            find: jest.fn(),
        } as unknown as EntityManager
    })

    it('should return combined toggles and overrides with inheritance', async () => {
        (em.find as jest.Mock).mockResolvedValueOnce([mockToggle1, mockToggle2]);
        (em.find as jest.Mock).mockResolvedValueOnce([mockOverride1]);

        const result = await getOverrides(em, mockTenant1, {})

        expect(result.items).toHaveLength(2)

        const item1 = result.items.find((i) => i.toggleId === 'toggle-1')
        expect(item1).toMatchObject({
            toggleId: 'toggle-1',
            tenantId: 'tenant-1',
            overrideState: 'enabled',
            tenantName: 'Tenant 1',
        })

        const item2 = result.items.find((i) => i.toggleId === 'toggle-2')
        expect(item2).toMatchObject({
            toggleId: 'toggle-2',
            tenantId: 'tenant-1',
            overrideState: 'inherit',
            tenantName: 'Tenant 1',
        })

        expect(result.total).toBe(2)
    })

    it('should apply filters to global toggles query', async () => {
        (em.find as jest.Mock).mockResolvedValueOnce([]);
        (em.find as jest.Mock).mockResolvedValueOnce([]);

        const query: GetOverridesQuery = {
            category: 'cat1',
            name: 'One',
            defaultState: 'enabled'
        }

        await getOverrides(em, mockTenant1, query)

        const findCalls = (em.find as jest.Mock).mock.calls
        const toggleFilter = findCalls[0][1] as any[]

        expect(toggleFilter).toHaveLength(3)
        expect(toggleFilter).toContainEqual({ category: { $ilike: '%cat1%' } })
        expect(toggleFilter).toContainEqual({ name: { $ilike: '%One%' } })
        expect(toggleFilter).toContainEqual({ defaultState: true })
    })

    it('should paginate results', async () => {
        const manyToggles = Array.from({ length: 30 }).map((_, i) => ({
            id: `t-${i}`,
            identifier: `t.${i}`,
            defaultState: false
        } as FeatureToggle));

        (em.find as jest.Mock).mockResolvedValueOnce(manyToggles);
        (em.find as jest.Mock).mockResolvedValueOnce([]);

        const result = await getOverrides(em, mockTenant1, { page: 2, pageSize: 10 })

        expect(result.total).toBe(30)
        expect(result.items).toHaveLength(10)
        expect(result.page).toBe(2)
        expect(result.items[0].toggleId).toBe('t-10')
    })


    it('should sort results locally', async () => {
        (em.find as jest.Mock).mockResolvedValueOnce([mockToggle1, mockToggle2]);
        (em.find as jest.Mock).mockResolvedValueOnce([]);
        (em.find as jest.Mock).mockResolvedValueOnce([mockToggle1, mockToggle2]);
        (em.find as jest.Mock).mockResolvedValueOnce([]);

        const resultAsc = await getOverrides(em, mockTenant1, { sortField: 'name', sortDir: 'asc' })
        expect(resultAsc.items[0].name).toBe('Toggle One')
        expect(resultAsc.items[1].name).toBe('Toggle Two')

        const resultDesc = await getOverrides(em, mockTenant1, { sortField: 'name', sortDir: 'desc' })
        expect(resultDesc.items[0].name).toBe('Toggle Two')
        expect(resultDesc.items[1].name).toBe('Toggle One')
    })
})
