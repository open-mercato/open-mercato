/**
 * @jest-environment jsdom
 */
import * as fs from 'fs'
import * as path from 'path'
import { fireEvent, screen, within } from '@testing-library/react'
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

const repoRoot = path.resolve(__dirname, '../../../../..')
const readEditorSource = () =>
  fs.readFileSync(path.join(repoRoot, 'packages/ui/src/backend/custom-fields/FieldDefinitionsEditor.tsx'), 'utf8')

describe('FieldDefinitionsEditor', () => {
  it('uses DS primitives and semantic status tokens for editor controls', () => {
    const source = readEditorSource()

    expect(source).not.toMatch(/<input\b/)
    expect(source).not.toMatch(/<select\b/)
    expect(source).not.toMatch(/<textarea\b/)
    expect(source).not.toMatch(/\b(?:border-red|text-red|bg-amber|text-amber|text-blue)-\d{2,3}\b/)
    expect(source).toMatch(/from ['"]\.\.\/\.\.\/primitives\/input['"]/)
    expect(source).toMatch(/from ['"]\.\.\/\.\.\/primitives\/checkbox-field['"]/)
  })

  it('renders injected actions for each field with the definition and row index', () => {
    const definitions: FieldDefinition[] = [
      { key: 'first_name', kind: 'text', configJson: { label: 'First name' } },
      { key: 'last_name', kind: 'text', configJson: { label: 'Last name' } },
    ]
    const renderFieldActions = jest.fn((definition: FieldDefinition, index: number) => (
      <span data-testid={`field-action-${index}`}>{definition.key}</span>
    ))

    renderWithProviders(
      <FieldDefinitionsEditor
        definitions={definitions}
        onAddField={() => undefined}
        onRemoveField={() => undefined}
        onDefinitionChange={() => undefined}
        renderFieldActions={renderFieldActions}
      />,
    )

    expect(renderFieldActions).toHaveBeenCalledWith(definitions[0], 0)
    expect(renderFieldActions).toHaveBeenCalledWith(definitions[1], 1)
    expect(screen.getByTestId('field-action-0')).toHaveTextContent('first_name')
    expect(screen.getByTestId('field-action-1')).toHaveTextContent('last_name')
    expect(screen.queryByRole('button', { name: 'Translate field' })).toBeNull()
  })

  it('preserves the legacy translate callback when callers supply it', () => {
    const definition: FieldDefinition = { key: 'first_name', kind: 'text' }
    const onTranslate = jest.fn()

    renderWithProviders(
      <FieldDefinitionsEditor
        definitions={[definition]}
        onAddField={() => undefined}
        onRemoveField={() => undefined}
        onDefinitionChange={() => undefined}
        onTranslate={onTranslate}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Translate field' }))
    expect(onTranslate).toHaveBeenCalledWith(definition, 0)
  })

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
  it('does not submit an enclosing form when a rule is added', () => {
    const handleSubmit = jest.fn((event: { preventDefault: () => void }) => event.preventDefault())
    const handleDefinitionChange = jest.fn()

    const definitions: FieldDefinition[] = [
      {
        key: 'nickname',
        kind: 'text',
        configJson: { label: 'Nickname' },
        isActive: true,
      },
    ]

    renderWithProviders(
      <form onSubmit={handleSubmit}>
        <FieldDefinitionsEditor
          definitions={definitions}
          onAddField={() => undefined}
          onRemoveField={() => undefined}
          onDefinitionChange={handleDefinitionChange}
        />
      </form>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))

    expect(handleSubmit).not.toHaveBeenCalled()
    expect(handleDefinitionChange).toHaveBeenCalledWith(0, expect.objectContaining({
      key: 'nickname',
      configJson: expect.objectContaining({
        validation: [expect.objectContaining({ rule: 'required' })],
      }),
    }))
  })


  it('adds a select option without submitting its enclosing form', () => {
    const handleSubmit = jest.fn((event: { preventDefault: () => void }) => event.preventDefault())
    const handleDefinitionChange = jest.fn()
    renderWithProviders(
      <form onSubmit={handleSubmit}>
        <FieldDefinitionsEditor
          definitions={[{ key: 'priority', kind: 'select', configJson: { options: [] } }]}
          onAddField={() => undefined}
          onRemoveField={() => undefined}
          onDefinitionChange={handleDefinitionChange}
        />
      </form>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add option' }))
    expect(handleSubmit).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog', { name: 'Add option' })
    fireEvent.change(within(dialog).getByPlaceholderText('unique_value'), { target: { value: 'high' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add option' }))
    expect(handleSubmit).not.toHaveBeenCalled()
    expect(handleDefinitionChange).toHaveBeenCalledWith(0, expect.objectContaining({
      configJson: expect.objectContaining({ options: [{ value: 'high', label: 'high' }] }),
    }))
  })

})
