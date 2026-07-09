import { normalizeUserTaskFormSchema } from '../user-task-form-schema'

describe('user task form schema normalization', () => {
  test('converts visual-editor fields into JSON Schema properties and required fields', () => {
    const normalized = normalizeUserTaskFormSchema({
      fields: [
        {
          name: 'contact_summary',
          type: 'textarea',
          label: 'Contact Summary',
          required: true,
          placeholder: 'Summarize the contact',
          defaultValue: 'N/A',
        },
        {
          name: 'follow_up_required',
          type: 'checkbox',
          label: 'Follow-up required',
          required: false,
        },
      ],
    })

    expect(normalized).toMatchObject({
      type: 'object',
      required: ['contact_summary'],
      properties: {
        contact_summary: {
          type: 'string',
          title: 'Contact Summary',
          description: 'Summarize the contact',
          placeholder: 'Summarize the contact',
          default: 'N/A',
          maxLength: 2000,
        },
        follow_up_required: {
          type: 'boolean',
          title: 'Follow-up required',
        },
      },
    })
  })

  test('keeps existing JSON Schema form definitions intact', () => {
    const schema = {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email', title: 'Email' },
      },
      required: ['email'],
    }

    expect(normalizeUserTaskFormSchema(schema)).toBe(schema)
  })
})
