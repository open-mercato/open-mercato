import { computeHierarchyForCategories } from '../categoryHierarchy'
import type { CatalogProductCategory } from '../../data/entities'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1', isActive: true }

function category(id: string, name: string, parentId: string | null = null): CatalogProductCategory {
  return { ...scope, id, name, parentId } as unknown as CatalogProductCategory
}

describe('computeHierarchyForCategories', () => {
  it('orders siblings alphabetically by name regardless of their ids', () => {
    const { map, ordered } = computeHierarchyForCategories([
      category('root', 'Root'),
      category('a-id', 'Zebra', 'root'),
      category('m-id', 'apple', 'root'),
      category('z-id', 'Mango', 'root'),
    ])

    expect(map.get('root')?.childIds).toEqual(['m-id', 'z-id', 'a-id'])
    expect(ordered.map((node) => node.name)).toEqual(['Root', 'apple', 'Mango', 'Zebra'])
  })

  it('falls back to the id when sibling names match case-insensitively', () => {
    const { map } = computeHierarchyForCategories([
      category('root', 'Root'),
      category('b-id', 'Shoes', 'root'),
      category('a-id', 'shoes', 'root'),
    ])

    expect(map.get('root')?.childIds).toEqual(['a-id', 'b-id'])
  })
})
