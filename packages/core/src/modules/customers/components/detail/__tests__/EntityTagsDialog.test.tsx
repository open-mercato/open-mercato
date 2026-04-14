/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { EntityTagsDialog } from '../EntityTagsDialog'

const apiCallMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('../ManageTagsDialog', () => ({
  ManageTagsDialog: ({ open }: { open: boolean }) => (open ? <div>manage-tags-dialog</div> : null),
}))

describe('EntityTagsDialog', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    readApiResultOrThrowMock.mockReset()
    apiCallMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/customers/dictionaries/sources')) {
        return Promise.resolve({
          ok: true,
          result: {
            items: [
              { id: 'src-1', value: 'customer_referral', label: 'Customer referral', color: '#4ade80' },
              { id: 'src-2', value: 'outbound_campaign', label: 'Outbound campaign', color: '#f59e0b' },
            ],
          },
        })
      }
      if (url.startsWith('/api/customers/dictionaries/job-titles')) {
        return Promise.resolve({
          ok: true,
          result: {
            items: [
              { id: 'job-1', value: 'vp_sales', label: 'VP Sales', color: null },
            ],
          },
        })
      }
      if (url.startsWith('/api/customers/dictionaries/industries')) {
        return Promise.resolve({
          ok: true,
          result: {
            items: [
              { id: 'ind-1', value: 'solar', label: 'Solar', color: null },
            ],
          },
        })
      }
      return Promise.resolve({ ok: true, result: { items: [] } })
    })
    readApiResultOrThrowMock.mockResolvedValue({ items: [], assignedIds: [] })
  })

  it('opens tag settings from the manage-tags modal header', async () => {
    await act(async () => {
      renderWithProviders(
        <EntityTagsDialog
          open
          onClose={jest.fn()}
          entityId="person-1"
          entityType="person"
          entityOrganizationId="org-1"
          entityData={{}}
        />,
      )
    })

    expect(screen.getAllByRole('button', { name: 'Tag settings' })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Tag settings' }))

    expect(screen.getByText('manage-tags-dialog')).toBeInTheDocument()
  })

  it('filters options within the active category and keeps the category model scoped', async () => {
    await act(async () => {
      renderWithProviders(
        <EntityTagsDialog
          open
          onClose={jest.fn()}
          entityId="person-1"
          entityType="person"
          entityOrganizationId="org-1"
          entityData={{ source: 'outbound_campaign' }}
        />,
      )
    })

    fireEvent.click(screen.getByRole('button', { name: /^Source\b/ }))

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search source...')).toBeInTheDocument()
    })

    expect(screen.getByText('Outbound campaign')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search source...')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search source...'), {
      target: { value: 'customer' },
    })

    expect(screen.getByText('Customer referral')).toBeInTheDocument()
    expect(screen.queryByText('Outbound campaign')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Job title\b/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Industry\b/ })).not.toBeInTheDocument()
  })

  it('uses company-specific categories when editing company tags', async () => {
    await act(async () => {
      renderWithProviders(
        <EntityTagsDialog
          open
          onClose={jest.fn()}
          entityId="company-1"
          entityType="company"
          entityOrganizationId="org-1"
          entityData={{ industry: 'solar' }}
        />,
      )
    })

    expect(screen.getByRole('button', { name: /^Industry\b/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Job title\b/ })).not.toBeInTheDocument()
  })
})
