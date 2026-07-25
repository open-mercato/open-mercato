import { EntityManager } from '@mikro-orm/postgresql'
import { getOverrides } from '../../lib/queries'
import { GetOverridesQuery } from '../../data/validators'
import { FeatureToggle, FeatureToggleOverride } from '../../data/entities'
import { Tenant } from '@open-mercato/core/modules/directory/data/entities'

describe('getOverrides', () => {
    let em: EntityManager

    const mockTenant1 = { id: 'tenant-1', name: 'Tenant 1' } as Tenant

    const makeToggle = (overrides: Partial<FeatureToggle>): FeatureToggle => ({
        id: 'toggle-1',
        identifier: 'toggle.one',
        name: 'Toggle One',
        category: 'cat1',
        defaultValue: false,
        type: 'boolean',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    } as unknown as FeatureToggle)

    const mockToggle1 = makeToggle({ id: 'toggle-1', identifier: 'toggle.one', name: 'Toggle One', category: 'cat1' })
    const mockToggle2 = makeToggle({ id: 'toggle-2', identifier: 'toggle.two', name: 'Toggle Two', category: 'cat2' })

    const mockOverride1 = {
        id: 'override-1',
        toggle: { id: 'toggle-1' },
        tenantId: 'tenant-1',
        value: undefined,
    } as unknown as FeatureToggleOverride

    beforeEach(() => {
        em = {
            find: jest.fn(),
            count: jest.fn(),
        } as unknown as EntityManager
    })

    it('should map toggles to overrides using an O(1) lookup map', async () => {
        (em.count as jest.Mock).mockResolvedValueOnce(2);
        (em.find as jest.Mock).mockResolvedValueOnce([mockToggle1, mockToggle2]);
        (em.find as jest.Mock).mockResolvedValueOnce([mockOverride1]);

        const result = await getOverrides(em, mockTenant1, { page: 1, pageSize: 25 })

        expect(result.items).toHaveLength(2)

        const item1 = result.items.find((i) => i.toggleId === 'toggle-1')
        expect(item1).toMatchObject({
            id: 'override-1',
            toggleId: 'toggle-1',
            tenantId: 'tenant-1',
            isOverride: true,
        })

        const item2 = result.items.find((i) => i.toggleId === 'toggle-2')
        expect(item2).toMatchObject({
            id: '',
            toggleId: 'toggle-2',
            tenantId: 'tenant-1',
            isOverride: false,
        })

        expect(result.total).toBe(2)
    })

    it('should apply filters to both the count and the toggle page query', async () => {
        (em.count as jest.Mock).mockResolvedValueOnce(0);
        (em.find as jest.Mock).mockResolvedValueOnce([]);

        const query: GetOverridesQuery = {
            category: 'cat1',
            name: 'One',
            page: 1,
            pageSize: 25,
        }

        await getOverrides(em, mockTenant1, query)

        const expectedFilter = {
            deletedAt: null,
            category: { $ilike: '%cat1%' },
            name: { $ilike: '%One%' },
        }

        const countCall = (em.count as jest.Mock).mock.calls[0]
        expect(countCall[1]).toEqual(expectedFilter)

        const findCall = (em.find as jest.Mock).mock.calls[0]
        expect(findCall[1]).toEqual(expectedFilter)
    })

    it('should not query overrides when the toggle page is empty', async () => {
        (em.count as jest.Mock).mockResolvedValueOnce(0);
        (em.find as jest.Mock).mockResolvedValueOnce([]);

        const result = await getOverrides(em, mockTenant1, { page: 1, pageSize: 25 })

        expect(result.items).toHaveLength(0)
        expect(em.find as jest.Mock).toHaveBeenCalledTimes(1)
    })

    it('should push pagination into the database (limit + offset)', async () => {
        const pageToggles = Array.from({ length: 10 }).map((_, i) =>
            makeToggle({ id: `t-${i + 10}`, identifier: `t.${i + 10}`, name: `T ${i + 10}` }),
        );

        (em.count as jest.Mock).mockResolvedValueOnce(30);
        (em.find as jest.Mock).mockResolvedValueOnce(pageToggles);
        (em.find as jest.Mock).mockResolvedValueOnce([]);

        const result = await getOverrides(em, mockTenant1, { page: 2, pageSize: 10 })

        expect(result.total).toBe(30)
        expect(result.totalPages).toBe(3)
        expect(result.page).toBe(2)
        expect(result.items).toHaveLength(10)

        const findOptions = (em.find as jest.Mock).mock.calls[0][2]
        expect(findOptions).toMatchObject({ limit: 10, offset: 10 })
    })

    it('should return correct totals independent of the current page size', async () => {
        (em.count as jest.Mock).mockResolvedValueOnce(95);
        (em.find as jest.Mock).mockResolvedValueOnce([mockToggle1]);
        (em.find as jest.Mock).mockResolvedValueOnce([]);

        const result = await getOverrides(em, mockTenant1, { page: 4, pageSize: 25 })

        expect(result.total).toBe(95)
        expect(result.totalPages).toBe(4)
    })

    it('should push sorting into the database with a deterministic id tiebreaker', async () => {
        (em.count as jest.Mock).mockResolvedValueOnce(0);
        (em.find as jest.Mock).mockResolvedValueOnce([]);

        await getOverrides(em, mockTenant1, { sortField: 'name', sortDir: 'desc', page: 1, pageSize: 25 })

        const findOptions = (em.find as jest.Mock).mock.calls[0][2]
        expect(findOptions.orderBy).toEqual({ name: 'DESC', id: 'ASC' })
    })

    it('should ignore non-sortable sort fields but keep the id tiebreaker', async () => {
        (em.count as jest.Mock).mockResolvedValueOnce(0);
        (em.find as jest.Mock).mockResolvedValueOnce([]);

        await getOverrides(em, mockTenant1, {
            sortField: 'overrideState',
            sortDir: 'asc',
            page: 1,
            pageSize: 25,
        } as unknown as GetOverridesQuery)

        const findOptions = (em.find as jest.Mock).mock.calls[0][2]
        expect(findOptions.orderBy).toEqual({ id: 'ASC' })
    })
})
