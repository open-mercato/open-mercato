/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ConditionBuilder, type ConditionSourceOption } from '../backend/forms/[id]/studio/logic/ConditionBuilder'
import { evaluateFormLogic } from '../services/form-logic-evaluator'
import enDict from '../i18n/en.json'

const sources: ConditionSourceOption[] = [
  { value: 'allergies', label: 'Do you have allergies?', fieldType: 'yes_no_buttons', namespace: 'field' },
  { value: 'details', label: 'Allergy details', fieldType: 'text', namespace: 'field' },
  { value: 'age', label: 'Age', fieldType: 'number', namespace: 'field' },
  { value: 'count', label: 'Count', fieldType: 'integer', namespace: 'field' },
]

function renderBuilder(initialPredicate: unknown = null, sourceOptions = sources) {
  const onChange = jest.fn()
  function ControlledBuilder() {
    const [predicate, setPredicate] = React.useState(initialPredicate)
    return (
      <ConditionBuilder
        predicate={predicate}
        sources={sourceOptions}
        onChange={(next) => {
          setPredicate(next)
          onChange(next)
        }}
      />
    )
  }
  renderWithProviders(<ControlledBuilder />, { dict: enDict })
  return onChange
}

async function selectOption(trigger: HTMLElement, label: string) {
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('option', { name: label, exact: true }))
}

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn()
})

describe('ConditionBuilder rule editing', () => {
  it.each(['boolean', 'yes_no', 'yes_no_buttons'])('saves the displayed is-true operator for a new %s rule', (fieldType) => {
    const onChange = renderBuilder(null, [{ ...sources[0], fieldType }])

    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))

    const predicate = { '==': [{ var: 'allergies' }, true] }
    expect(onChange).toHaveBeenLastCalledWith(predicate)
    expect(within(screen.getByTestId('condition-row')).getAllByRole('combobox')[1]).toHaveTextContent('is true')

    const schema = {
      properties: {
        allergies: { type: 'boolean', 'x-om-type': fieldType },
        details: { type: 'string', 'x-om-type': 'text', 'x-om-visibility-if': onChange.mock.calls.at(-1)?.[0] },
      },
    }
    for (const answer of [true, false]) {
      const state = evaluateFormLogic(schema, { answers: { allergies: answer }, hidden: {}, locale: 'en' })
      expect(state.visibleFieldKeys.has('details')).toBe(answer)
    }
  })

  it('initializes a multi-select rule with its supported contains operator', () => {
    const onChange = renderBuilder(null, [{ ...sources[0], fieldType: 'select_many' }])

    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))

    expect(onChange).toHaveBeenLastCalledWith({ in: ['', { var: 'allergies' }] })
    expect(within(screen.getByTestId('condition-row')).getAllByRole('combobox')[1]).toHaveTextContent('contains')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'pollen' } })
    expect(onChange).toHaveBeenLastCalledWith({ in: ['pollen', { var: 'allergies' }] })
    expect(screen.getByRole('textbox')).toHaveValue('pollen')
  })

  it('uses is true when changing a text source to a boolean source', async () => {
    const onChange = renderBuilder({ '==': [{ var: 'details' }, 'pollen'] })
    const sourceTrigger = within(screen.getByTestId('condition-row')).getAllByRole('combobox')[0]

    await selectOption(sourceTrigger, 'Do you have allergies?')

    expect(onChange).toHaveBeenLastCalledWith({ '==': [{ var: 'allergies' }, true] })
  })

  it('resets an incompatible boolean operator when changing to a text source', async () => {
    const onChange = renderBuilder({ '==': [{ var: 'allergies' }, false] })
    const sourceTrigger = within(screen.getByTestId('condition-row')).getAllByRole('combobox')[0]

    await selectOption(sourceTrigger, 'Allergy details')

    expect(onChange).toHaveBeenLastCalledWith({ '==': [{ var: 'details' }, ''] })
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('preserves a supported operator and comparison value when changing sources', async () => {
    const onChange = renderBuilder({ '>=': [{ var: 'age' }, 18] })
    const sourceTrigger = within(screen.getByTestId('condition-row')).getAllByRole('combobox')[0]

    await selectOption(sourceTrigger, 'Count')

    expect(onChange).toHaveBeenLastCalledWith({ '>=': [{ var: 'count' }, 18] })
  })

  it('shows the actual saved operator and preserves existing rules when adding a row', () => {
    const existingPredicate = { '==': [{ var: 'allergies' }, ''] }
    const onChange = renderBuilder(existingPredicate)

    expect(within(screen.getByTestId('condition-row')).getAllByRole('combobox')[1]).toHaveTextContent('equals')
    expect(screen.getByRole('textbox')).toHaveValue('')
    expect(onChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))

    expect(onChange).toHaveBeenLastCalledWith({
      and: [existingPredicate, { '==': [{ var: 'allergies' }, true] }],
    })
  })

  it('saves an explicit false selection and removes the rule', async () => {
    const onChange = renderBuilder()
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    const operatorTrigger = within(screen.getByTestId('condition-row')).getAllByRole('combobox')[1]

    await selectOption(operatorTrigger, 'is false')

    expect(onChange).toHaveBeenLastCalledWith({ '==': [{ var: 'allergies' }, false] })
    fireEvent.click(screen.getByRole('button', { name: 'Remove rule' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
})
