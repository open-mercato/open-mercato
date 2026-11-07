import type { CatalogProductCategory } from '../../data/entities'
import {
  computeHierarchyForCategories,
  findCategoryParentCycle,
  rebuildCategoryHierarchyForOrganization,
  type ComputedCategoryHierarchy,
} from '../categoryHierarchy'

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'

type CategoryShape = {
  id: string
  tenantId: string
  organizationId: string
  name: string
  parentId: string | null
  isActive: boolean
  rootId?: string | null
  treePath?: string | null
  depth?: number
  ancestorIds?: string[]
  childIds?: string[]
  descendantIds?: string[]
  updatedAt?: Date
}

function category(id: string, parentId: string | null, name = id): CategoryShape {
  return { id, tenantId: TENANT_ID, organizationId: ORG_ID, name, parentId, isActive: true }
}

function asCategories(rows: CategoryShape[]): CatalogProductCategory[] {
  return rows as unknown as CatalogProductCategory[]
}

function expectForest(hierarchy: ComputedCategoryHierarchy, ids: string[]) {
  expect(hierarchy.map.size).toBe(ids.length)
  expect(hierarchy.ordered.map((node) => node.id).sort()).toEqual([...ids].sort())
  for (const id of ids) {
    const node = hierarchy.map.get(id)!
    expect(node.ancestorIds).not.toContain(id)
    expect(node.descendantIds).not.toContain(id)
    expect(new Set(node.descendantIds).size).toBe(node.descendantIds.length)
    const seen = new Set<string>([id])
    let parentId = node.parentId
    while (parentId) {
      expect(seen.has(parentId)).toBe(false)
      seen.add(parentId)
      parentId = hierarchy.map.get(parentId)!.parentId
    }
    expect(node.depth).toBe(node.ancestorIds.length)
    expect(node.parentId).toBe(node.ancestorIds.length ? node.ancestorIds[node.ancestorIds.length - 1] : null)
  }
}

describe('computeHierarchyForCategories — parent cycles', () => {
  it.each([
    ['larger id first', [category('cat-b', 'cat-a', 'Same'), category('cat-a', 'cat-b', 'Same')]],
    ['smaller id first', [category('cat-a', 'cat-b', 'Same'), category('cat-b', 'cat-a', 'Same')]],
  ])('breaks a 2-cycle at the smallest id (%s)', (_label, rows) => {
    const hierarchy = computeHierarchyForCategories(asCategories(rows))

    expectForest(hierarchy, ['cat-a', 'cat-b'])
    expect(hierarchy.map.get('cat-a')!.parentId).toBeNull()
    expect(hierarchy.map.get('cat-b')!.parentId).toBe('cat-a')
    expect(hierarchy.map.get('cat-a')!.descendantIds).toEqual(['cat-b'])
    expect(hierarchy.map.get('cat-b')!.ancestorIds).toEqual(['cat-a'])
  })

  it.each([
    ['tail first', ['a-tail', 'm-3', 'm-1', 'm-2']],
    ['cycle first', ['m-2', 'm-3', 'a-tail', 'm-1']],
    ['reversed', ['m-1', 'm-2', 'a-tail', 'm-3']],
  ])('breaks a 3-cycle with a tail at its smallest member (%s)', (_label, order) => {
    const byId: Record<string, CategoryShape> = {
      'a-tail': category('a-tail', 'm-2', 'Same'),
      'm-1': category('m-1', 'm-2', 'Same'),
      'm-2': category('m-2', 'm-3', 'Same'),
      'm-3': category('m-3', 'm-1', 'Same'),
    }
    const hierarchy = computeHierarchyForCategories(asCategories(order.map((id) => byId[id])))

    expectForest(hierarchy, ['a-tail', 'm-1', 'm-2', 'm-3'])
    const roots = Array.from(hierarchy.map.values()).filter((node) => node.parentId === null)
    expect(roots.map((node) => node.id)).toEqual(['m-1'])
    expect(hierarchy.map.get('m-3')!.parentId).toBe('m-1')
    expect(hierarchy.map.get('m-2')!.parentId).toBe('m-3')
    expect(hierarchy.map.get('a-tail')!.parentId).toBe('m-2')
    expect(hierarchy.map.get('a-tail')!.ancestorIds).toEqual(['m-1', 'm-3', 'm-2'])
    expect(hierarchy.map.get('m-1')!.descendantIds.sort()).toEqual(['a-tail', 'm-2', 'm-3'])
  })

  it('cuts exactly one edge per cycle when an organization carries two cycles', () => {
    const rows = [
      category('x-2', 'x-1'),
      category('x-1', 'x-2'),
      category('y-3', 'y-1'),
      category('y-1', 'y-2'),
      category('y-2', 'y-3'),
      category('root', null),
      category('leaf', 'root'),
    ]
    const hierarchy = computeHierarchyForCategories(asCategories(rows))

    expectForest(hierarchy, rows.map((row) => row.id))
    const roots = Array.from(hierarchy.map.values())
      .filter((node) => node.parentId === null)
      .map((node) => node.id)
      .sort()
    expect(roots).toEqual(['root', 'x-1', 'y-1'])
  })

  it('leaves acyclic input unchanged', () => {
    const rows = [
      category('r', null, 'Root'),
      category('alpha', 'r', 'Alpha'),
      category('gamma', 'alpha', 'Gamma'),
      category('lone', 'missing', 'Lone'),
    ]
    const hierarchy = computeHierarchyForCategories(asCategories(rows))

    expectForest(hierarchy, ['r', 'alpha', 'gamma', 'lone'])
    expect(hierarchy.ordered.map((node) => node.id)).toEqual(['r', 'alpha', 'gamma', 'lone'])
    expect(hierarchy.map.get('gamma')).toMatchObject({
      parentId: 'alpha',
      depth: 2,
      rootId: 'r',
      treePath: 'r/alpha/gamma',
      pathLabel: 'Root / Alpha / Gamma',
      ancestorIds: ['r', 'alpha'],
    })
    expect(hierarchy.map.get('r')!.descendantIds).toEqual(['alpha', 'gamma'])
    expect(hierarchy.map.get('lone')!.parentId).toBeNull()
  })
})

describe('findCategoryParentCycle', () => {
  const tree = [category('root', null), category('mid', 'root'), category('leaf', 'mid')]

  it('returns null for an acyclic hierarchy', () => {
    expect(findCategoryParentCycle(tree, ['root', 'mid', 'leaf'])).toBeNull()
  })

  it('returns the id whose parent chain leads back to it', () => {
    const rows = [category('root', 'leaf'), category('mid', 'root'), category('leaf', 'mid')]

    expect(findCategoryParentCycle(rows, ['mid'])).toBe('mid')
    expect(findCategoryParentCycle(rows, ['missing', 'leaf'])).toBe('leaf')
  })

  it('ignores an unrelated pre-existing cycle', () => {
    const rows = [...tree, category('x', 'y'), category('y', 'x'), category('tail', 'x')]

    expect(findCategoryParentCycle(rows, ['mid', 'leaf'])).toBeNull()
    expect(findCategoryParentCycle(rows, ['tail'])).toBeNull()
    expect(findCategoryParentCycle(rows, ['y'])).toBe('y')
  })

  it('ignores ids that are not in the given categories and dangling parents', () => {
    expect(findCategoryParentCycle([category('orphan', 'gone')], ['orphan', 'unknown'])).toBeNull()
  })
})

describe('rebuildCategoryHierarchyForOrganization — cyclic data', () => {
  it('persists a repaired parent for a cycle in the stored rows', async () => {
    const rows = [category('cat-b', 'cat-a', 'Same'), category('cat-a', 'cat-b', 'Same')]
    const em = {
      find: jest.fn(async () => rows),
      flush: jest.fn(async () => {}),
    }

    await rebuildCategoryHierarchyForOrganization(em as never, ORG_ID, TENANT_ID)

    expect(em.flush).toHaveBeenCalledTimes(1)
    const [catB, catA] = rows
    expect(catA.parentId).toBeNull()
    expect(catA.rootId).toBe('cat-a')
    expect(catA.descendantIds).toEqual(['cat-b'])
    expect(catB.parentId).toBe('cat-a')
    expect(catB.ancestorIds).toEqual(['cat-a'])
    expect(catB.descendantIds).toEqual([])
  })
})
