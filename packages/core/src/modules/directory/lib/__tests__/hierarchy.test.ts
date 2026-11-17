import { computeHierarchyForOrganizations } from '../hierarchy'

function org(id: string, name: string, parentId: string | null) {
  return { id, name, parentId, isActive: true } as never
}

describe('computeHierarchyForOrganizations', () => {
  it('orders child nodes by lowercased name ascending when names sort opposite to ids', () => {
    const organizations = [
      org('org-1', 'Zebra', 'org-parent'),
      org('org-2', 'Apple', 'org-parent'),
      org('org-parent', 'Parent', null),
    ]

    const { map } = computeHierarchyForOrganizations(organizations as never, 'tenant-1')
    expect(map.get('org-parent')?.childIds).toEqual(['org-2', 'org-1'])
  })

  it('breaks ties by id when sibling names are equal', () => {
    const organizations = [
      org('org-b', 'Same', 'org-parent'),
      org('org-a', 'Same', 'org-parent'),
      org('org-parent', 'Parent', null),
    ]

    const { map } = computeHierarchyForOrganizations(organizations as never, 'tenant-1')
    expect(map.get('org-parent')?.childIds).toEqual(['org-a', 'org-b'])
  })
})
