import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { PageHeader } from '../Page'

describe('PageHeader', () => {
  it('retains the original title, description, action and heading defaults', () => {
    const action = jest.fn()
    render(<PageHeader title="Orders" description="Recent orders" actions={<button onClick={action}>Create</button>} />)
    expect(screen.getByRole('heading', { name: 'Orders', level: 1 })).toHaveClass('font-semibold')
    expect(screen.getByText('Recent orders')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('composes a source section header with a semantic heading and optional title action', () => {
    const { container } = render(<PageHeader title="Team" appearance="section" leading={<img alt="Company" src="company.svg" />} titleAction={<button>Switch team</button>} />)
    expect(screen.getByRole('heading', { name: 'Team', level: 2 })).toHaveClass('text-lg', 'font-medium', 'leading-6')
    expect(container.querySelector('[data-slot="page-header"]')).toHaveClass('py-4', 'px-8')
    expect(screen.getByRole('img', { name: 'Company' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch team' })).toBeInTheDocument()
  })

  it('allows heading-level override and omission of the divider', () => {
    const { container } = render(<PageHeader title="Card" appearance="page" headingLevel={3} divider={false} />)
    expect(screen.getByRole('heading', { name: 'Card', level: 3 })).toBeInTheDocument()
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
  })
})
