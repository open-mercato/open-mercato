/**
 * @jest-environment jsdom
 *
 * Step 1.3 (workflows UX Phase 2a): the ContextSchemaEditor edits the
 * definition's declared contextSchema ({ input: { fields } }) on the visual
 * editor's metadata panel. Rows must render from value, add/remove/edit must
 * propagate onChange with the canonical shape (absent stays absent — an empty
 * field list emits undefined), and the options editor is visible only for
 * select-typed fields.
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ContextSchemaEditor } from '../ContextSchemaEditor'
import type { WorkflowContextSchema } from '../../data/entities'

const NAME_LABEL_KEY = 'workflows.contextSchema.fields.name'
const LABEL_LABEL_KEY = 'workflows.contextSchema.fields.label'
const REQUIRED_LABEL_KEY = 'workflows.contextSchema.fields.required'
const OPTIONS_LABEL_KEY = 'workflows.contextSchema.fields.options'
const OPTIONS_PLACEHOLDER_KEY = 'workflows.contextSchema.placeholders.options'
const ADD_KEY = 'workflows.contextSchema.addField'
const REMOVE_KEY = 'workflows.contextSchema.removeField'
const EMPTY_STATE_KEY = 'workflows.contextSchema.emptyState'

const twoFieldSchema: WorkflowContextSchema = {
  input: {
    fields: [
      { name: 'dealId', type: 'text', label: 'Deal ID', required: true },
      { name: 'stage', type: 'select', options: ['new', 'won'] },
    ],
  },
}

describe('ContextSchemaEditor', () => {
  it('renders the empty state when no fields are declared', () => {
    renderWithProviders(<ContextSchemaEditor value={undefined} onChange={jest.fn()} />)

    expect(screen.getByText(EMPTY_STATE_KEY)).toBeInTheDocument()
    expect(screen.queryAllByLabelText(NAME_LABEL_KEY)).toHaveLength(0)
  })

  it('renders one row per declared field with its stored values', () => {
    renderWithProviders(<ContextSchemaEditor value={twoFieldSchema} onChange={jest.fn()} />)

    const nameInputs = screen.getAllByLabelText(NAME_LABEL_KEY)
    expect(nameInputs).toHaveLength(2)
    expect(nameInputs[0]).toHaveValue('dealId')
    expect(nameInputs[1]).toHaveValue('stage')
    expect(screen.getAllByLabelText(LABEL_LABEL_KEY)[0]).toHaveValue('Deal ID')

    const requiredCheckboxes = screen.getAllByLabelText(REQUIRED_LABEL_KEY)
    expect(requiredCheckboxes[0]).toHaveAttribute('data-state', 'checked')
    expect(requiredCheckboxes[1]).toHaveAttribute('data-state', 'unchecked')
  })

  it('adds a new text field row through onChange', () => {
    const onChange = jest.fn()
    renderWithProviders(<ContextSchemaEditor value={undefined} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: ADD_KEY }))

    expect(onChange).toHaveBeenCalledWith({
      input: { fields: [{ name: '', type: 'text' }] },
    })
  })

  it('propagates name edits with the full field list shape', () => {
    const onChange = jest.fn()
    renderWithProviders(<ContextSchemaEditor value={twoFieldSchema} onChange={onChange} />)

    fireEvent.change(screen.getAllByLabelText(NAME_LABEL_KEY)[0], { target: { value: 'orderId' } })

    expect(onChange).toHaveBeenCalledWith({
      input: {
        fields: [
          { name: 'orderId', type: 'text', label: 'Deal ID', required: true },
          { name: 'stage', type: 'select', options: ['new', 'won'] },
        ],
      },
    })
  })

  it('propagates required toggles', () => {
    const onChange = jest.fn()
    renderWithProviders(<ContextSchemaEditor value={twoFieldSchema} onChange={onChange} />)

    fireEvent.click(screen.getAllByLabelText(REQUIRED_LABEL_KEY)[1])

    expect(onChange).toHaveBeenCalledWith({
      input: {
        fields: [
          { name: 'dealId', type: 'text', label: 'Deal ID', required: true },
          { name: 'stage', type: 'select', options: ['new', 'won'], required: true },
        ],
      },
    })
  })

  it('removes a row and keeps the remaining fields', () => {
    const onChange = jest.fn()
    renderWithProviders(<ContextSchemaEditor value={twoFieldSchema} onChange={onChange} />)

    fireEvent.click(screen.getAllByRole('button', { name: REMOVE_KEY })[0])

    expect(onChange).toHaveBeenCalledWith({
      input: { fields: [{ name: 'stage', type: 'select', options: ['new', 'won'] }] },
    })
  })

  it('emits undefined when the last field is removed so absent stays absent', () => {
    const onChange = jest.fn()
    const singleField: WorkflowContextSchema = {
      input: { fields: [{ name: 'dealId', type: 'text' }] },
    }
    renderWithProviders(<ContextSchemaEditor value={singleField} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: REMOVE_KEY }))

    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  it('shows the options editor only for select-typed fields', () => {
    renderWithProviders(<ContextSchemaEditor value={twoFieldSchema} onChange={jest.fn()} />)

    expect(screen.getAllByText(OPTIONS_LABEL_KEY)).toHaveLength(1)
    expect(screen.getAllByPlaceholderText(OPTIONS_PLACEHOLDER_KEY)).toHaveLength(1)
    expect(screen.getByText('new')).toBeInTheDocument()
    expect(screen.getByText('won')).toBeInTheDocument()
  })
})
