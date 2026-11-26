/**
 * @jest-environment jsdom
 */
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { FieldDefinitionsEditor, type FieldDefinition } from '../custom-fields/FieldDefinitionsEditor'

type RuleSeed = { rule: string; param?: unknown; message: string }

function renderEditorWithRule(kind: string, rule: RuleSeed) {
  const handleDefinitionChange = jest.fn<void, [number, FieldDefinition]>()
  const definition: FieldDefinition = {
    key: 'score',
    kind,
    configJson: { label: 'Score', validation: [rule] },
    isActive: true,
  }
  renderWithProviders(
    <FieldDefinitionsEditor
      definitions={[definition]}
      onAddField={() => undefined}
      onRemoveField={() => undefined}
      onDefinitionChange={handleDefinitionChange}
    />,
  )
  return handleDefinitionChange
}

function lastSavedParam(handleDefinitionChange: jest.Mock<void, [number, FieldDefinition]>): unknown {
  const calls = handleDefinitionChange.mock.calls
  const saved = calls[calls.length - 1]?.[1]
  const rules: Array<{ param?: unknown }> = saved?.configJson?.validation ?? []
  return rules[0]?.param
}

function typeInto(input: HTMLElement, steps: string[]) {
  for (const text of steps) {
    fireEvent.change(input, { target: { value: text } })
    expect(input).toHaveValue(text)
  }
}

describe('FieldDefinitionsEditor rule parameters', () => {
  it('stores an eq parameter on an integer field as a number', () => {
    const handleDefinitionChange = renderEditorWithRule('integer', { rule: 'eq', param: 7, message: 'Must match' })
    const input = screen.getByDisplayValue('7')

    typeInto(input, ['5'])
    fireEvent.blur(input)

    expect(lastSavedParam(handleDefinitionChange)).toBe(5)
  })

  it('stores a ne parameter on a float field as a number and lets a decimal be typed', () => {
    const handleDefinitionChange = renderEditorWithRule('float', { rule: 'ne', param: 7, message: 'Must differ' })
    const input = screen.getByDisplayValue('7')

    typeInto(input, ['1', '1.', '1.5'])
    fireEvent.blur(input)

    expect(lastSavedParam(handleDefinitionChange)).toBe(1.5)
  })

  it('turns an eq parameter saved earlier as text into a number on the next edit', () => {
    const handleDefinitionChange = renderEditorWithRule('integer', { rule: 'eq', param: '7', message: 'Must match' })
    const input = screen.getByDisplayValue('7')

    fireEvent.blur(input)

    expect(lastSavedParam(handleDefinitionChange)).toBe(7)
  })

  it('keeps an eq parameter on a text field as text', () => {
    const handleDefinitionChange = renderEditorWithRule('text', { rule: 'eq', param: 'old', message: 'Must match' })
    const input = screen.getByDisplayValue('old')

    typeInto(input, ['5'])
    fireEvent.blur(input)

    expect(lastSavedParam(handleDefinitionChange)).toBe('5')
  })

  it('keeps an eq parameter that is not a number as typed on an integer field', () => {
    const handleDefinitionChange = renderEditorWithRule('integer', { rule: 'eq', param: 7, message: 'Must match' })
    const input = screen.getByDisplayValue('7')

    typeInto(input, ['abc'])
    fireEvent.blur(input)

    expect(lastSavedParam(handleDefinitionChange)).toBe('abc')
  })

  it('lets a negative decimal be typed into a comparison rule and stores it as a number', () => {
    const handleDefinitionChange = renderEditorWithRule('float', { rule: 'gte', param: 7, message: 'Too small' })
    const input = screen.getByDisplayValue('7')

    typeInto(input, ['-', '-2', '-2.', '-2.5'])
    fireEvent.blur(input)

    expect(lastSavedParam(handleDefinitionChange)).toBe(-2.5)
  })

  it('stores 0 for a comparison rule whose parameter is cleared or not a number', () => {
    const handleDefinitionChange = renderEditorWithRule('float', { rule: 'lt', param: 7, message: 'Too big' })
    const input = screen.getByDisplayValue('7')

    typeInto(input, [''])
    fireEvent.blur(input)
    expect(lastSavedParam(handleDefinitionChange)).toBe(0)

    typeInto(input, ['abc'])
    fireEvent.blur(input)
    expect(lastSavedParam(handleDefinitionChange)).toBe(0)
  })

  it('leaves a cleared eq parameter on an integer field empty', () => {
    const handleDefinitionChange = renderEditorWithRule('integer', { rule: 'eq', param: 7, message: 'Must match' })
    const input = screen.getByDisplayValue('7')

    typeInto(input, [''])
    fireEvent.blur(input)

    expect(lastSavedParam(handleDefinitionChange)).toBe('')
  })

  it('shows the number placeholder for eq on a numeric field', () => {
    renderEditorWithRule('integer', { rule: 'eq', message: 'Must match' })

    expect(screen.getByPlaceholderText('Number')).toBeInTheDocument()
  })

  it('shows the value placeholder for eq and ne on a text field', () => {
    renderEditorWithRule('text', { rule: 'ne', message: 'Must differ' })

    expect(screen.getByPlaceholderText('Value')).toBeInTheDocument()
  })
})
