/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { PipelineStageSelect } from '../PipelineStageSelect'

// Radix Select renders its content in a portal and depends on pointer APIs jsdom lacks,
// so we replace the primitive with thin stand-ins that render trigger + items inline and
// expose onValueChange through a button click. This keeps the assertions focused on
// PipelineStageSelect's own logic (selected-stage lookup + "stage n of N" formatting).
jest.mock('@open-mercato/ui/primitives/select', () => {
  const React = require('react')
  const Ctx = React.createContext({ onValueChange: (_value: string) => {} })
  return {
    Select: ({ onValueChange, children }: any) =>
      React.createElement(Ctx.Provider, { value: { onValueChange } }, children),
    SelectTrigger: ({ children }: any) => React.createElement('div', null, children),
    SelectTriggerLeading: ({ children }: any) => React.createElement('span', null, children),
    SelectValue: ({ placeholder, children }: any) =>
      React.createElement('span', { 'data-testid': 'select-value' }, children != null ? children : placeholder),
    SelectContent: ({ children }: any) => React.createElement('div', null, children),
    SelectItem: ({ value, children }: any) => {
      const ctx = React.useContext(Ctx)
      return React.createElement('button', { type: 'button', onClick: () => ctx.onValueChange(value) }, children)
    },
  }
})

const stages = [
  { id: 's1', label: 'Qualified', order: 1 },
  { id: 's2', label: 'Proposal', order: 2 },
  { id: 's3', label: 'Won', order: 3 },
]

const formatCount = (position: number, total: number) => `· stage ${position} of ${total}`

describe('PipelineStageSelect', () => {
  it('shows the placeholder when nothing is selected', () => {
    render(
      <PipelineStageSelect
        stages={stages}
        value=""
        onChange={() => {}}
        placeholder="Select stage…"
        formatCount={formatCount}
      />,
    )
    expect(screen.getByTestId('select-value')).toHaveTextContent('Select stage…')
  })

  it('renders the selected stage with its "stage n of N" position', () => {
    render(
      <PipelineStageSelect
        stages={stages}
        value="s2"
        onChange={() => {}}
        placeholder="Select stage…"
        formatCount={formatCount}
      />,
    )
    expect(screen.getByTestId('select-value')).toHaveTextContent('Proposal· stage 2 of 3')
  })

  it('labels every option with its 1-based position out of the total', () => {
    render(
      <PipelineStageSelect
        stages={stages}
        value=""
        onChange={() => {}}
        placeholder="Select stage…"
        formatCount={formatCount}
      />,
    )
    expect(screen.getByRole('button', { name: /Qualified.*stage 1 of 3/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Won.*stage 3 of 3/ })).toBeInTheDocument()
  })

  it('emits the stage id when an option is chosen', () => {
    const onChange = jest.fn()
    render(
      <PipelineStageSelect
        stages={stages}
        value=""
        onChange={onChange}
        placeholder="Select stage…"
        formatCount={formatCount}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Won.*stage 3 of 3/ }))
    expect(onChange).toHaveBeenCalledWith('s3')
  })
})
