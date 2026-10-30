/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { PersonCard } from '../PersonCard'
import { formatDate } from '../utils'

const person = {
  id: 'person-1',
  displayName: 'Avery Quintessentially-Long Display-Name Director-of-Relationships',
  primaryEmail: 'avery.long.email.address+with+segments@acme.example.com',
  primaryPhone: '+1 555 123 456 789 000',
  status: 'active',
  lifecycleStage: 'customer',
  jobTitle: 'Director of Strategic Relationship Development',
  linkedAt: '2026-04-10T00:00:00.000Z',
  source: 'customer referral',
  temperature: 'warm',
}

function renderRow(props: Partial<React.ComponentProps<typeof PersonCard>> = {}) {
  return renderWithProviders(
    <table>
      <tbody>
        <PersonCard person={person} onUnlink={() => {}} {...props} />
      </tbody>
    </table>,
  )
}

describe('PersonCard', () => {
  it('renders a table row: name link, contact links and qualifier cells, with truncation', () => {
    renderRow()

    const nameLink = screen.getByRole('link', { name: person.displayName })
    expect(nameLink).toHaveAttribute('href', '/backend/customers/people-v2/person-1')
    expect(nameLink).toHaveClass('truncate')
    expect(screen.getByText(person.jobTitle)).toHaveClass('truncate')

    expect(screen.getByRole('link', { name: person.primaryEmail })).toHaveAttribute('href', `mailto:${person.primaryEmail}`)
    expect(screen.getByRole('link', { name: /\+1 555 123 456 789 000/ })).toHaveAttribute('href', 'tel:+1555123456789000')

    expect(screen.getByRole('img', { name: 'Active' })).toBeInTheDocument()
    expect(screen.getByText('Customer')).toBeInTheDocument()
    expect(screen.getByText('Customer referral')).toBeInTheDocument()
    expect(screen.getByLabelText('High Interest')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Open person/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unlink' })).not.toBeInTheDocument()
  })

  it('keeps open and unlink behind the row menu and shows the linked date as a cell', () => {
    const onUnlink = jest.fn()
    renderRow({ onUnlink })

    expect(screen.getByText(formatDate(person.linkedAt))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('link', { name: /Open person/ })).toHaveAttribute('href', '/backend/customers/people-v2/person-1')
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }))
    expect(onUnlink).toHaveBeenCalledWith('person-1')
  })

  it('names the star action by its effect', () => {
    const onToggleStar = jest.fn()
    const { rerender } = renderRow({ onToggleStar, isStarred: true })
    fireEvent.click(screen.getByRole('button', { name: 'Remove star' }))
    expect(onToggleStar).toHaveBeenCalledWith('person-1')
    rerender(<table><tbody><PersonCard person={person} onUnlink={() => {}} onToggleStar={onToggleStar} isStarred={false} /></tbody></table>)
    expect(screen.getByRole('button', { name: 'Star' })).toBeInTheDocument()
  })
})
