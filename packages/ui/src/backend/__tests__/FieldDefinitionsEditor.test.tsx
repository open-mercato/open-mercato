/**
 * @jest-environment jsdom
 */
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { FieldDefinitionsEditor, type FieldDefinition } from '../custom-fields/FieldDefinitionsEditor'

// Radix Select uses pointer capture / scrollIntoView APIs that jsdom doesn't implement.
// Polyfill them so tests can interact with Radix-based comboboxes.
if (typeof window !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => undefined
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined
  }
}

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

      const assignFieldsetTrigger = screen.getAllByRole('combobox').find((element) => {
        return element.textContent?.trim() === 'Unassigned'
      })

      expect(assignFieldsetTrigger).toBeDefined()

      fireEvent.pointerDown(assignFieldsetTrigger!, { button: 0, ctrlKey: false })
      fireEvent.click(assignFieldsetTrigger!)

      const option = screen.getByRole('option', { name: 'New fieldset' })
      fireEvent.pointerDown(option)
      fireEvent.click(option)

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
