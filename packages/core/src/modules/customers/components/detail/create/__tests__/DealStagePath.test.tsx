/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { DealStagePath } from '../DealStagePath'

const stages = [
  { id: 'offer', label: 'Offering', order: 2 },
  { id: 'lead', label: 'Lead', order: 0 },
  { id: 'qualified', label: 'Qualified', order: 1 },
  { id: 'won', label: 'Won', order: 3 },
]

describe('DealStagePath', () => {
  it('renders the open stages in pipeline order and hides terminal outcomes', () => {
    render(<DealStagePath stages={stages} value="lead" onChange={jest.fn()} label="Sales" />)

    const items = screen.getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual(['1Lead', '2Qualified', '3Offering'])
    expect(screen.queryByRole('button', { name: 'Won' })).toBeNull()
  })

  it('shows a selected terminal stage so a submitted stage is never hidden', () => {
    render(<DealStagePath stages={stages} value="won" onChange={jest.fn()} label="Sales" />)

    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Lead', 'Qualified', 'Offering', '4Won'])
    expect(screen.getByRole('button', { name: /Won/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('renders nothing for a pipeline of terminal stages with none selected', () => {
    const { container } = render(
      <DealStagePath stages={[{ id: 'won', label: 'Won', order: 0 }, { id: 'lost', label: 'Lost', order: 1 }]} value="" onChange={jest.fn()} label="Sales" />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('marks the picked stage as current and the earlier ones as done', () => {
    render(<DealStagePath stages={stages} value="qualified" onChange={jest.fn()} label="Sales" />)

    expect(screen.getByRole('button', { name: /Qualified/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('listitem')[1]).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: /^Lead$/ })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: /^Lead$/ }).querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('button', { name: /Offering/ }).querySelector('svg')).toBeNull()
  })

  it('reports a click on another stage and ignores the current one', () => {
    const onChange = jest.fn()
    render(<DealStagePath stages={stages} value="lead" onChange={onChange} label="Sales" />)

    fireEvent.click(screen.getByRole('button', { name: /Offering/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Lead$/ }))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('offer')
  })

  it('disables every stage while submitting', () => {
    render(<DealStagePath stages={stages} value="lead" onChange={jest.fn()} disabled label="Sales" />)

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('data-slot', 'button')
    }
  })
})
