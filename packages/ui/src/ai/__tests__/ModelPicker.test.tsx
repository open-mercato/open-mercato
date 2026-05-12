/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { ModelPicker } from '../ModelPicker'
import type { ModelPickerProvider, ModelPickerValue } from '../ModelPicker'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback: string) => fallback,
}))

jest.mock('@open-mercato/shared/lib/utils', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
}))

const providers: ModelPickerProvider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    isDefault: true,
    models: [
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', isDefault: true },
      { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', isDefault: false },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    isDefault: false,
    models: [{ id: 'gpt-4o', name: 'GPT-4o', isDefault: false }],
  },
]

function ControlledPicker({
  initial = null,
  onChangeSpy,
}: {
  initial?: ModelPickerValue | null
  onChangeSpy?: jest.Mock
}) {
  const [value, setValue] = React.useState<ModelPickerValue | null>(initial)
  const handleChange = React.useCallback(
    (next: ModelPickerValue | null) => {
      setValue(next)
      onChangeSpy?.(next)
    },
    [onChangeSpy],
  )
  return (
    <ModelPicker
      agentId="catalog.merchandising_assistant"
      value={value}
      onChange={handleChange}
      availableProviders={providers}
    />
  )
}

describe('<ModelPicker>', () => {
  it('renders the trigger button', () => {
    render(<ControlledPicker />)
    expect(screen.getByRole('button', { name: 'Select AI model' })).toBeInTheDocument()
  })

  it('does not render when availableProviders is empty', () => {
    const { container } = render(
      <ModelPicker
        agentId="catalog.merchandising_assistant"
        value={null}
        onChange={jest.fn()}
        availableProviders={[]}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('opens the dropdown on trigger click', () => {
    render(<ControlledPicker />)
    fireEvent.click(screen.getByRole('button', { name: 'Select AI model' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('closes the dropdown on second trigger click', () => {
    render(<ControlledPicker />)
    const trigger = screen.getByRole('button', { name: 'Select AI model' })
    fireEvent.click(trigger)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.click(trigger)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes the dropdown when Escape is pressed', () => {
    render(<ControlledPicker />)
    fireEvent.click(screen.getByRole('button', { name: 'Select AI model' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes the dropdown when clicking outside', () => {
    render(
      <div>
        <ControlledPicker />
        <button type="button">Outside</button>
      </div>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Select AI model' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('lists all providers and their models', () => {
    render(<ControlledPicker />)
    fireEvent.click(screen.getByRole('button', { name: 'Select AI model' }))

    expect(screen.getByText('Anthropic')).toBeInTheDocument()
    expect(screen.getByText('Claude Haiku 4.5')).toBeInTheDocument()
    expect(screen.getByText('Claude Sonnet 4.5')).toBeInTheDocument()
    expect(screen.getByText('OpenAI')).toBeInTheDocument()
    expect(screen.getByText('GPT-4o')).toBeInTheDocument()
  })

  it('calls onChange with the selected model and closes the dropdown', () => {
    const onChangeSpy = jest.fn()
    render(<ControlledPicker onChangeSpy={onChangeSpy} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select AI model' }))

    fireEvent.click(screen.getByText('GPT-4o'))

    expect(onChangeSpy).toHaveBeenCalledWith({ providerId: 'openai', modelId: 'gpt-4o' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('calls onChange with null when "Use agent default" is clicked', () => {
    const onChangeSpy = jest.fn()
    const initial: ModelPickerValue = { providerId: 'openai', modelId: 'gpt-4o' }
    render(<ControlledPicker initial={initial} onChangeSpy={onChangeSpy} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select AI model' }))

    fireEvent.click(screen.getByText('Use agent default'))

    expect(onChangeSpy).toHaveBeenCalledWith(null)
  })

  it('selects a model via Enter key', () => {
    const onChangeSpy = jest.fn()
    render(<ControlledPicker onChangeSpy={onChangeSpy} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select AI model' }))

    const gpt4oOption = screen.getByText('GPT-4o').closest('[role="option"]') as HTMLElement
    fireEvent.keyDown(gpt4oOption, { key: 'Enter' })

    expect(onChangeSpy).toHaveBeenCalledWith({ providerId: 'openai', modelId: 'gpt-4o' })
  })

  it('selects a model via Space key', () => {
    const onChangeSpy = jest.fn()
    render(<ControlledPicker onChangeSpy={onChangeSpy} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select AI model' }))

    const claudeHaikuOption = screen.getByText('Claude Haiku 4.5').closest(
      '[role="option"]',
    ) as HTMLElement
    fireEvent.keyDown(claudeHaikuOption, { key: ' ' })

    expect(onChangeSpy).toHaveBeenCalledWith({
      providerId: 'anthropic',
      modelId: 'claude-haiku-4-5',
    })
  })

  it('marks the currently selected model with aria-selected', () => {
    const initial: ModelPickerValue = { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' }
    render(<ControlledPicker initial={initial} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select AI model' }))

    const selectedOption = screen
      .getByText('Claude Sonnet 4.5')
      .closest('[role="option"]') as HTMLElement
    expect(selectedOption).toHaveAttribute('aria-selected', 'true')

    const unselectedOption = screen
      .getByText('Claude Haiku 4.5')
      .closest('[role="option"]') as HTMLElement
    expect(unselectedOption).toHaveAttribute('aria-selected', 'false')
  })

  it('marks the "Use default" option as selected when value is null', () => {
    render(<ControlledPicker initial={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Select AI model' }))

    const defaultOption = screen
      .getByText('Use agent default')
      .closest('[role="option"]') as HTMLElement
    expect(defaultOption).toHaveAttribute('aria-selected', 'true')
  })

  it('does not open when disabled', () => {
    render(
      <ModelPicker
        agentId="test.agent"
        value={null}
        onChange={jest.fn()}
        availableProviders={providers}
        disabled
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Select AI model' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('attaches data-ai-model-picker attribute with the agentId', () => {
    const { container } = render(<ControlledPicker />)
    const root = container.querySelector(
      '[data-ai-model-picker="catalog.merchandising_assistant"]',
    )
    expect(root).toBeInTheDocument()
  })

  it('attaches data-ai-model-picker-model attributes', () => {
    render(<ControlledPicker />)
    fireEvent.click(screen.getByRole('button', { name: 'Select AI model' }))

    expect(
      document.querySelector('[data-ai-model-picker-model="anthropic:claude-haiku-4-5"]'),
    ).toBeInTheDocument()
    expect(
      document.querySelector('[data-ai-model-picker-model="openai:gpt-4o"]'),
    ).toBeInTheDocument()
  })
})
