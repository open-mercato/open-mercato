/**
 * @jest-environment jsdom
 */
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { FieldDefinitionsEditor, type FieldDefinition } from '../custom-fields/FieldDefinitionsEditor'

describe('FieldDefinitionsEditor', () => {
  it('assigns a field to a fieldset without triggering a render-time parent update warning', () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const handleDefinitionChange = jest.fn()

    const definitions: FieldDefinition[] = [
      {
        key: 'buying_role',
        kind: 'select',
        configJson: {
          label: 'Buying role',
          options: [{ value: 'champion', label: 'Champion' }],
        },
        isActive: true,
      },
    ]

    try {
      renderWithProviders(
        <FieldDefinitionsEditor
          definitions={definitions}
          fieldsets={[{ code: 'fieldset_1', label: 'New fieldset' }]}
          activeFieldset={null}
          onActiveFieldsetChange={() => undefined}
          onFieldsetsChange={() => undefined}
          onAddField={() => undefined}
          onRemoveField={() => undefined}
          onDefinitionChange={handleDefinitionChange}
        />,
      )

      const assignFieldsetSelect = screen.getAllByRole('combobox').find((element) => {
        if (!(element instanceof HTMLSelectElement)) return false
        const optionLabels = Array.from(element.options).map((option) => option.text)
        return optionLabels.includes('Unassigned') && optionLabels.includes('New fieldset')
      })

      expect(assignFieldsetSelect).toBeDefined()

      fireEvent.change(assignFieldsetSelect as HTMLSelectElement, { target: { value: 'fieldset_1' } })

      expect(handleDefinitionChange).toHaveBeenCalledWith(0, expect.objectContaining({
        key: 'buying_role',
        configJson: expect.objectContaining({
          fieldset: 'fieldset_1',
        }),
      }))

      const renderTimeWarnings = consoleErrorSpy.mock.calls.filter((args) =>
        args.some((value) => typeof value === 'string' && value.includes('Cannot update a component')),
      )
      expect(renderTimeWarnings).toHaveLength(0)
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})
