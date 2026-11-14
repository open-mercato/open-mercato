/** @jest-environment jsdom */
import * as React from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { StageSelectMenu } from '../StageSelectMenu'

const stages = [
  { id: 'stage-won', label: 'Won', order: 3 },
  { id: 'stage-2', label: 'Proposal', order: 2 },
  { id: 'stage-1', label: 'Qualification', order: 1 },
]

describe('StageSelectMenu', () => {
  it('lists the non-terminal stages in order and moves the deal to the chosen one', () => {
    const onStageChange = jest.fn()
    renderWithProviders(<StageSelectMenu stages={stages} currentStageId="stage-1" onStageChange={onStageChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Move stage' }))
    const menu = within(screen.getByRole('dialog'))
    const items = menu.getAllByRole('button')
    expect(items.map((item) => item.textContent)).toEqual(['Qualification', 'Proposal'])
    expect(menu.getByRole('button', { name: 'Qualification' })).toBeDisabled()
    expect(menu.getByRole('button', { name: 'Qualification' })).toHaveAttribute('aria-current', 'true')

    fireEvent.click(menu.getByRole('button', { name: 'Proposal' }))
    expect(onStageChange).toHaveBeenCalledWith('stage-2')
  })

  it('shows the current stage on the trigger when asked to', () => {
    renderWithProviders(
      <StageSelectMenu stages={stages} currentStageId="stage-2" onStageChange={jest.fn()} showCurrentStage />,
    )
    expect(screen.getByRole('button', { name: 'Proposal' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Move stage' })).not.toBeInTheDocument()
  })

  it.each([
    ['disabled', { disabled: true }],
    ['saving', { isSaving: true }],
  ])('disables the trigger while %s', (_name, props) => {
    renderWithProviders(<StageSelectMenu stages={stages} currentStageId="stage-1" onStageChange={jest.fn()} {...props} />)
    expect(screen.getByRole('button', { name: 'Move stage' })).toBeDisabled()
  })

  it('renders nothing without a non-terminal stage', () => {
    const { container } = renderWithProviders(
      <StageSelectMenu stages={[{ id: 'stage-won', label: 'Won', order: 1 }]} currentStageId={null} onStageChange={jest.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
