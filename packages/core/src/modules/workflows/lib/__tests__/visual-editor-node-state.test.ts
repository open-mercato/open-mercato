import type { Node } from '@xyflow/react'
import { mergeVisualEditorNodes } from '../visual-editor-node-state'

describe('mergeVisualEditorNodes', () => {
  it('preserves page-owned user task config when React Flow emits a stale node snapshot', () => {
    const previousNodes: Node[] = [
      {
        id: 'usertask_1',
        type: 'userTask',
        position: { x: 0, y: 0 },
        selected: false,
        data: {
          label: 'Initial contact',
          assignedTo: 'user123',
          assignedToRoles: ['Sales Representative'],
          formKey: 'initial_contact_form',
          userTaskConfig: {
            assignedTo: 'user123',
            assignedToRoles: ['Sales Representative'],
            formKey: 'initial_contact_form',
            formSchema: {
              fields: [
                {
                  name: 'conversation_summary',
                  label: 'Conversation summary',
                  type: 'textarea',
                  required: true,
                  placeholder: 'Please fill in the details of the conversation',
                },
              ],
            },
          },
        },
      },
    ]
    const staleReactFlowNodes: Node[] = [
      {
        id: 'usertask_1',
        type: 'userTask',
        position: { x: 10, y: 20 },
        selected: true,
        data: {
          label: 'Initial contact',
          userTaskConfig: {},
        },
      },
    ]

    const merged = mergeVisualEditorNodes(previousNodes, staleReactFlowNodes)

    expect(merged[0].position).toEqual({ x: 10, y: 20 })
    expect(merged[0].selected).toBe(true)
    expect(merged[0].data?.userTaskConfig).toEqual(previousNodes[0].data?.userTaskConfig)
    expect(merged[0].data?.assignedToRoles).toEqual(['Sales Representative'])
    expect(merged[0].data?.formKey).toBe('initial_contact_form')
  })

  it('keeps brand-new nodes from React Flow', () => {
    const nextNodes: Node[] = [
      {
        id: 'new_node',
        type: 'automated',
        position: { x: 0, y: 0 },
        data: { label: 'New Node' },
      },
    ]

    expect(mergeVisualEditorNodes([], nextNodes)).toBe(nextNodes)
  })
})
