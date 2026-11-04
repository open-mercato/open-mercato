/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import {
  PersonCard,
  PersonEmailCell,
  PersonLifecycleStageCell,
  PersonLinkedDateCell,
  PersonNameCell,
  PersonPhoneCell,
  PersonSourceCell,
  buildPersonRowActionItems,
} from '../PersonCard'
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

const translate = (_key: string, fallback?: string) => fallback ?? ''

describe('PersonCard (deprecated standalone export)', () => {
  it('renders as a card without a table parent', () => {
    const { container } = renderWithProviders(
      <div data-testid="legacy-grid">
        <PersonCard person={person} onUnlink={() => {}} />
      </div>,
    )

    const root = screen.getByTestId('legacy-grid').firstElementChild
    expect(root?.tagName).toBe('DIV')
    expect(root).toHaveClass('rounded-lg', 'border')
    expect(container.querySelector('tr, td')).toBeNull()
    expect(screen.getByText(person.displayName)).toBeInTheDocument()
    expect(screen.getByText('Source')).toBeInTheDocument()
    expect(screen.getByText(`Linked ${formatDate(person.linkedAt)}`)).toBeInTheDocument()
  })

  it('uses wrap-safe text and stacked mobile actions for narrow layouts', () => {
    const longValue = 'avery.long.email.address+with+segments@acme.example.com'
    renderWithProviders(
      <PersonCard person={{ ...person, displayName: longValue, primaryEmail: longValue }} onUnlink={() => {}} />,
    )

    expect(screen.getAllByText(longValue)[0]).toHaveClass('break-words')
    expect(screen.getAllByText(longValue)[1]).toHaveClass('break-all')
    expect(screen.getByRole('link', { name: /Open person/i })).toHaveClass('w-full')
    expect(screen.getByRole('button', { name: 'Unlink' })).toHaveClass('w-full')
  })

  it('keeps the star, unlink and linked-date props working', () => {
    const onToggleStar = jest.fn()
    const onUnlink = jest.fn()
    renderWithProviders(
      <PersonCard person={person} onToggleStar={onToggleStar} onUnlink={onUnlink} isStarred showLinkedDate={false} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Toggle star' }))
    expect(onToggleStar).toHaveBeenCalledWith('person-1')
    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }))
    expect(onUnlink).toHaveBeenCalledWith('person-1')
    expect(screen.queryByText(/^Linked /)).toBeNull()
  })
})

describe('Person table cells', () => {
  function renderCells() {
    return renderWithProviders(
      <table>
        <tbody>
          <tr>
            <td><PersonNameCell person={person} /></td>
            <td><PersonEmailCell person={person} /></td>
            <td><PersonPhoneCell person={person} /></td>
            <td><PersonLifecycleStageCell person={person} /></td>
            <td><PersonSourceCell person={person} /></td>
            <td><PersonLinkedDateCell person={person} /></td>
          </tr>
        </tbody>
      </table>,
    )
  }

  it('renders the name link, contact links and qualifier cells, with truncation', () => {
    renderCells()

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
    expect(screen.getByText(formatDate(person.linkedAt) as string)).toBeInTheDocument()
  })

  it('keeps open and unlink behind the row menu', async () => {
    const onUnlink = jest.fn()
    renderWithProviders(<RowActions items={buildPersonRowActionItems(person, translate, onUnlink)} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Open person' })).toHaveAttribute('href', '/backend/customers/people-v2/person-1')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unlink' }))
    expect(onUnlink).toHaveBeenCalledWith('person-1')
  })

  it('names the star action by its effect', () => {
    const onToggleStar = jest.fn()
    const { rerender } = renderWithProviders(<PersonNameCell person={person} onToggleStar={onToggleStar} isStarred />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove star' }))
    expect(onToggleStar).toHaveBeenCalledWith('person-1')
    rerender(<PersonNameCell person={person} onToggleStar={onToggleStar} isStarred={false} />)
    expect(screen.getByRole('button', { name: 'Star' })).toBeInTheDocument()
  })

  it('gives the row actions stable ids and leaves unlink out without a handler', () => {
    expect(buildPersonRowActionItems(person, translate, () => {}).map((item) => item.id)).toEqual(['open', 'unlink'])
    expect(buildPersonRowActionItems(person, translate).map((item) => item.id)).toEqual(['open'])
  })
})
