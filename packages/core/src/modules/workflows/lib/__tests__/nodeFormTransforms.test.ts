import { formValuesToNodeUpdates } from '../nodeFormTransforms'
import type { Node } from '@xyflow/react'

describe('nodeFormTransforms', () => {
  it('keeps user task form config when advanced config contains stale empty userTaskConfig', () => {
    const updates = formValuesToNodeUpdates(
      {
        stepName: 'Initial contact',
        assignedToRoles: 'Sales Representative',
        formKey: 'initial_contact_form',
        formFields: [
          {
            name: 'conversation_summary',
            type: 'textarea',
            label: 'Conversation summary',
            required: true,
            placeholder: 'Please fill in the details of the conversation',
          },
        ],
        advancedConfig: {
          userTaskConfig: {},
        },
      },
      {
        id: 'usertask_initial_contact',
        type: 'userTask',
        data: {
          userTaskConfig: {},
        },
      } as unknown as Node,
    )

    expect(updates).toMatchObject({
      assignedToRoles: ['Sales Representative'],
      formKey: 'initial_contact_form',
      userTaskConfig: {
        assignedToRoles: ['Sales Representative'],
        formSchema: {
          fields: [
            {
              name: 'conversation_summary',
              type: 'textarea',
              label: 'Conversation summary',
              required: true,
              placeholder: 'Please fill in the details of the conversation',
            },
          ],
        },
      },
    })
  })
})
