import { nodeToFormValues, formValuesToNodeUpdates } from '../nodeFormTransforms'

function userTaskNode(data: Record<string, unknown>) {
  return { id: 'task_1', type: 'userTask', position: { x: 0, y: 0 }, data } as any
}

describe('nodeFormTransforms — assignedToRoles (B1)', () => {
  it('hydrates roles as an array rather than a comma-joined string', () => {
    const values = nodeToFormValues(userTaskNode({
      stepName: 'Approve',
      assignedToRoles: ['admin', 'manager'],
    }))

    expect(values.assignedToRoles).toEqual(['admin', 'manager'])
  })

  it('defaults to an empty array when the node has no roles', () => {
    const values = nodeToFormValues(userTaskNode({ stepName: 'Approve' }))

    expect(values.assignedToRoles).toEqual([])
  })

  it('tolerates a legacy comma-joined string without splitting it into characters', () => {
    const values = nodeToFormValues(userTaskNode({
      stepName: 'Approve',
      assignedToRoles: 'admin, manager' as any,
    }))

    expect(values.assignedToRoles).toEqual([])
  })

  it('writes roles straight through to the node and userTaskConfig', () => {
    const updates = formValuesToNodeUpdates(
      { stepName: 'Approve', assignedToRoles: ['admin', 'manager'] },
      userTaskNode({ stepName: 'Approve' }),
    )

    expect(updates.assignedToRoles).toEqual(['admin', 'manager'])
    expect((updates.userTaskConfig as any).assignedToRoles).toEqual(['admin', 'manager'])
  })

  it('omits assignedToRoles from userTaskConfig when no role is selected', () => {
    const updates = formValuesToNodeUpdates(
      { stepName: 'Approve', assignedToRoles: [] },
      userTaskNode({ stepName: 'Approve' }),
    )

    expect(updates.assignedToRoles).toEqual([])
    expect((updates.userTaskConfig as any).assignedToRoles).toBeUndefined()
  })

  it('preserves a role name that is not an existing role (free-text escape hatch)', () => {
    const updates = formValuesToNodeUpdates(
      { stepName: 'Approve', assignedToRoles: ['not_yet_created'] },
      userTaskNode({ stepName: 'Approve' }),
    )

    expect(updates.assignedToRoles).toEqual(['not_yet_created'])
  })

  it('round-trips node → form → node without mutating the roles', () => {
    const node = userTaskNode({ stepName: 'Approve', assignedToRoles: ['reviewer'] })
    const updates = formValuesToNodeUpdates(nodeToFormValues(node), node)

    expect(updates.assignedToRoles).toEqual(['reviewer'])
  })
})
