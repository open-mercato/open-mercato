import type { Organization } from '@open-mercato/core/modules/directory/data/entities'
import {
  computeHierarchyForOrganizations,
  findOrganizationParentCycle,
  rebuildHierarchyForTenant,
  type ComputedHierarchy,
} from '../hierarchy'

const TENANT_ID = 'tenant-1'

type OrgShape = {
  id: string
  name: string
  parentId: string | null
  isActive: boolean
  rootId?: string
  treePath?: string
  depth?: number
  ancestorIds?: string[]
  childIds?: string[]
  descendantIds?: string[]
  updatedAt?: Date
}

function org(id: string, parentId: string | null, name = id): OrgShape {
  return { id, name, parentId, isActive: true }
}

function asOrganizations(rows: OrgShape[]): Organization[] {
  return rows as unknown as Organization[]
}

function expectForest(hierarchy: ComputedHierarchy, ids: string[]) {
  expect(hierarchy.map.size).toBe(ids.length)
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
  }
}

describe('computeHierarchyForOrganizations — parent cycles', () => {
  it.each([
    ['larger id first', [org('org-b', 'org-a', 'Same'), org('org-a', 'org-b', 'Same')]],
    ['smaller id first', [org('org-a', 'org-b', 'Same'), org('org-b', 'org-a', 'Same')]],
  ])('breaks a 2-cycle at the smallest id (%s)', (_label, rows) => {
    const hierarchy = computeHierarchyForOrganizations(asOrganizations(rows), TENANT_ID)

    expectForest(hierarchy, ['org-a', 'org-b'])
    expect(hierarchy.map.get('org-a')!.parentId).toBeNull()
    expect(hierarchy.map.get('org-b')!.parentId).toBe('org-a')
    expect(hierarchy.map.get('org-a')!.descendantIds).toEqual(['org-b'])
    expect(hierarchy.map.get('org-b')!.ancestorIds).toEqual(['org-a'])
  })

  it.each([
    ['tail first', ['a-tail', 'm-3', 'm-1', 'm-2']],
    ['cycle first', ['m-2', 'm-3', 'a-tail', 'm-1']],
    ['reversed', ['m-1', 'm-2', 'a-tail', 'm-3']],
  ])('breaks a 3-cycle with a tail at its smallest member (%s)', (_label, order) => {
    const byId: Record<string, OrgShape> = {
      'a-tail': org('a-tail', 'm-2', 'Same'),
      'm-1': org('m-1', 'm-2', 'Same'),
      'm-2': org('m-2', 'm-3', 'Same'),
      'm-3': org('m-3', 'm-1', 'Same'),
    }
    const hierarchy = computeHierarchyForOrganizations(
      asOrganizations(order.map((id) => byId[id])),
      TENANT_ID,
    )

    expectForest(hierarchy, ['a-tail', 'm-1', 'm-2', 'm-3'])
    const roots = Array.from(hierarchy.map.values()).filter((node) => node.parentId === null)
    expect(roots.map((node) => node.id)).toEqual(['m-1'])
    expect(hierarchy.map.get('m-3')!.parentId).toBe('m-1')
    expect(hierarchy.map.get('m-2')!.parentId).toBe('m-3')
    expect(hierarchy.map.get('a-tail')!.parentId).toBe('m-2')
    expect(hierarchy.map.get('a-tail')!.ancestorIds).toEqual(['m-1', 'm-3', 'm-2'])
    expect(hierarchy.map.get('m-1')!.descendantIds.sort()).toEqual(['a-tail', 'm-2', 'm-3'])
  })

  it('cuts exactly one edge per cycle when a tenant carries two cycles', () => {
    const rows = [
      org('x-2', 'x-1'),
      org('x-1', 'x-2'),
      org('y-3', 'y-1'),
      org('y-1', 'y-2'),
      org('y-2', 'y-3'),
      org('root', null),
      org('leaf', 'root'),
    ]
    const hierarchy = computeHierarchyForOrganizations(asOrganizations(rows), TENANT_ID)

    expectForest(hierarchy, rows.map((row) => row.id))
    const roots = Array.from(hierarchy.map.values())
      .filter((node) => node.parentId === null)
      .map((node) => node.id)
      .sort()
    expect(roots).toEqual(['root', 'x-1', 'y-1'])
  })

  it('leaves acyclic input unchanged', () => {
    const rows = [
      org('r', null, 'Root'),
      org('alpha', 'r', 'Alpha'),
      org('beta', 'r', 'Beta'),
      org('gamma', 'alpha', 'Gamma'),
      org('lone', 'missing', 'Lone'),
    ]
    const hierarchy = computeHierarchyForOrganizations(asOrganizations(rows), TENANT_ID)

    expect(hierarchy.ordered).toEqual([
      {
        id: 'r',
        tenantId: TENANT_ID,
        name: 'Root',
        pathLabel: 'Root',
        parentId: null,
        depth: 0,
        rootId: 'r',
        treePath: 'r',
        ancestorIds: [],
        childIds: ['alpha', 'beta'],
        descendantIds: ['alpha', 'gamma', 'beta'],
        isActive: true,
      },
      {
        id: 'alpha',
        tenantId: TENANT_ID,
        name: 'Alpha',
        pathLabel: 'Root / Alpha',
        parentId: 'r',
        depth: 1,
        rootId: 'r',
        treePath: 'r/alpha',
        ancestorIds: ['r'],
        childIds: ['gamma'],
        descendantIds: ['gamma'],
        isActive: true,
      },
      {
        id: 'gamma',
        tenantId: TENANT_ID,
        name: 'Gamma',
        pathLabel: 'Root / Alpha / Gamma',
        parentId: 'alpha',
        depth: 2,
        rootId: 'r',
        treePath: 'r/alpha/gamma',
        ancestorIds: ['r', 'alpha'],
        childIds: [],
        descendantIds: [],
        isActive: true,
      },
      {
        id: 'beta',
        tenantId: TENANT_ID,
        name: 'Beta',
        pathLabel: 'Root / Beta',
        parentId: 'r',
        depth: 1,
        rootId: 'r',
        treePath: 'r/beta',
        ancestorIds: ['r'],
        childIds: [],
        descendantIds: [],
        isActive: true,
      },
      {
        id: 'lone',
        tenantId: TENANT_ID,
        name: 'Lone',
        pathLabel: 'Lone',
        parentId: null,
        depth: 0,
        rootId: 'lone',
        treePath: 'lone',
        ancestorIds: [],
        childIds: [],
        descendantIds: [],
        isActive: true,
      },
    ])
    expect(Array.from(hierarchy.map.keys()).sort()).toEqual(['alpha', 'beta', 'gamma', 'lone', 'r'])
  })
})

describe('findOrganizationParentCycle', () => {
  const tree = [org('root', null), org('mid', 'root'), org('leaf', 'mid')]

  it('returns null for an acyclic hierarchy', () => {
    expect(findOrganizationParentCycle(tree, ['root', 'mid', 'leaf'])).toBeNull()
  })

  it('returns the id whose parent chain leads back to it', () => {
    const rows = [org('root', 'leaf'), org('mid', 'root'), org('leaf', 'mid')]

    expect(findOrganizationParentCycle(rows, ['mid'])).toBe('mid')
    expect(findOrganizationParentCycle(rows, ['missing', 'leaf'])).toBe('leaf')
  })

  it('ignores an unrelated pre-existing cycle', () => {
    const rows = [...tree, org('x', 'y'), org('y', 'x'), org('tail', 'x')]

    expect(findOrganizationParentCycle(rows, ['mid', 'leaf'])).toBeNull()
    expect(findOrganizationParentCycle(rows, ['tail'])).toBeNull()
    expect(findOrganizationParentCycle(rows, ['y'])).toBe('y')
  })

  it('ignores ids that are not in the given organizations and dangling parents', () => {
    const rows = [org('orphan', 'gone')]

    expect(findOrganizationParentCycle(rows, ['orphan', 'unknown'])).toBeNull()
  })
})

describe('rebuildHierarchyForTenant — cyclic data', () => {
  it('persists a repaired parent for a cycle in the stored rows', async () => {
    const rows = [org('org-b', 'org-a', 'Same'), org('org-a', 'org-b', 'Same')]
    const em = {
      find: jest.fn(async () => rows),
      flush: jest.fn(async () => {}),
    }

    await rebuildHierarchyForTenant(em as never, TENANT_ID)

    expect(em.flush).toHaveBeenCalledTimes(1)
    const [orgB, orgA] = rows
    expect(orgA.parentId).toBeNull()
    expect(orgA.rootId).toBe('org-a')
    expect(orgA.descendantIds).toEqual(['org-b'])
    expect(orgB.parentId).toBe('org-a')
    expect(orgB.ancestorIds).toEqual(['org-a'])
    expect(orgB.descendantIds).toEqual([])
  })
})
