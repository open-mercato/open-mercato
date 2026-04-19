/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DealLinkedEntitiesTab } from '../DealLinkedEntitiesTab'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div data-testid="dialog-content" {...props}>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('DealLinkedEntitiesTab', () => {
  it('selects all visible results and refreshes the linked list after save', async () => {
    const catalog = {
      'person-1': { id: 'person-1', label: 'Ada Lovelace', subtitle: 'Lead buyer' },
      'person-2': { id: 'person-2', label: 'Grace Hopper', subtitle: 'Procurement lead' },
      'person-3': { id: 'person-3', label: 'Linus Torvalds', subtitle: 'CTO' },
    }
    const savedSelections: string[][] = []

    function Harness() {
      const [selectedIds, setSelectedIds] = React.useState<string[]>(['person-1'])
      const [linkedIds, setLinkedIds] = React.useState<string[]>(['person-1'])

      return (
        <DealLinkedEntitiesTab
          entityLabel="Person"
          entityLabelPlural="People"
          manageLabel="Manage linked people"
          searchPlaceholder="Search linked people…"
          linkedItems={linkedIds.map((id) => catalog[id as keyof typeof catalog])}
          linkedCount={linkedIds.length}
          selectedIds={selectedIds}
          hrefBuilder={(id) => `/backend/customers/people-v2/${id}`}
          onSaveSelection={async (nextIds) => {
            savedSelections.push(nextIds)
            setSelectedIds(nextIds)
            setLinkedIds(nextIds)
          }}
          loadLinkedPage={async () => ({
            items: linkedIds.map((id) => catalog[id as keyof typeof catalog]),
            totalPages: 1,
            total: linkedIds.length,
          })}
          searchEntities={async () => ({
            items: [catalog['person-2'], catalog['person-3']],
            totalPages: 1,
          })}
          fetchEntitiesByIds={async (ids) => ids.map((id) => catalog[id as keyof typeof catalog])}
          icon={<span>icon</span>}
        />
      )
    }

    renderWithProviders(<Harness />)

    await waitFor(() => {
      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Manage links' }))

    await waitFor(() => {
      expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
      expect(screen.getByText('Linus Torvalds')).toBeInTheDocument()
    })

    const graceCheckbox = screen.getByRole('checkbox', { name: 'Select Grace Hopper' })
    fireEvent.click(graceCheckbox)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Linus Torvalds' }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Link (person|company|deal)/ }))
    })

    await waitFor(() => {
      expect(savedSelections).toEqual([['person-1', 'person-2', 'person-3']])
    })

    await waitFor(() => {
      expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
      expect(screen.getByText('Linus Torvalds')).toBeInTheDocument()
    })
  })

  it('navigates between search pages via numbered pagination', async () => {
    const catalog = {
      'person-1': { id: 'person-1', label: 'Ada Lovelace', subtitle: 'Lead buyer' },
      'person-2': { id: 'person-2', label: 'Grace Hopper', subtitle: 'Procurement lead' },
      'person-3': { id: 'person-3', label: 'Linus Torvalds', subtitle: 'CTO' },
    }

    renderWithProviders(
      <DealLinkedEntitiesTab
        entityLabel="Person"
        entityLabelPlural="People"
        manageLabel="Manage linked people"
        searchPlaceholder="Search linked people…"
        linkedItems={[catalog['person-1']]}
        linkedCount={1}
        selectedIds={['person-1']}
        hrefBuilder={(id) => `/backend/customers/people-v2/${id}`}
        onSaveSelection={async () => {}}
        searchEntities={async (_query, page) => {
          if (page === 1) {
            return {
              items: [catalog['person-2']],
              totalPages: 2,
            }
          }
          return {
            items: [catalog['person-3']],
            totalPages: 2,
          }
        }}
        fetchEntitiesByIds={async (ids) => ids.map((id) => catalog[id as keyof typeof catalog])}
        icon={<span>icon</span>}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Manage links' }))

    expect(await screen.findByText('Grace Hopper')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Next$/ }))
    })

    expect(await screen.findByText('Linus Torvalds')).toBeInTheDocument()
  })
})
