/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { PersonCompaniesSection } from '../PersonCompaniesSection'

const flashMock = jest.fn()
const apiCallOrThrowMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('../CompanyCard', () => ({
  CompanyCard: ({
    data,
  }: {
    data: { displayName: string }
  }) => <div>{data.displayName}</div>,
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div data-testid="dialog-content" {...props}>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('PersonCompaniesSection', () => {
  beforeEach(() => {
    flashMock.mockReset()
    apiCallOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockReset()
  })

  it('selects visible companies and refreshes the linked summary immediately after apply', async () => {
    let linkedItems = [
      {
        linkId: 'link-1',
        companyId: 'company-1',
        displayName: 'Alpha Corp',
        isPrimary: true,
        subtitle: 'Industry · Warsaw',
        profile: null,
        billing: null,
        primaryAddress: null,
        tags: [],
        roles: [],
        activeDeal: null,
        lastContactAt: null,
        clv: null,
        status: null,
        lifecycleStage: null,
        temperature: null,
        renewalQuarter: null,
      },
    ]

    readApiResultOrThrowMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/customers/people/person-1/companies/enriched')) {
        return {
          items: linkedItems,
          totalPages: 1,
        }
      }
      if (url.startsWith('/api/customers/companies?')) {
        return {
          items: [
            {
              id: 'company-2',
              display_name: 'Beta Holdings',
              website_url: 'beta.example',
            },
          ],
          totalPages: 1,
        }
      }
      throw new Error(`Unexpected read: ${url}`)
    })

    apiCallOrThrowMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/customers/people/person-1/companies') {
        linkedItems = [
          ...linkedItems,
          {
            linkId: 'link-2',
            companyId: 'company-2',
            displayName: 'Beta Holdings',
            isPrimary: false,
            subtitle: 'beta.example',
            profile: null,
            billing: null,
            primaryAddress: null,
            tags: [],
            roles: [],
            activeDeal: null,
            lastContactAt: null,
            clv: null,
            status: null,
            lifecycleStage: null,
            temperature: null,
            renewalQuarter: null,
          },
        ]
        expect(init).toEqual(
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ companyId: 'company-2', isPrimary: false }),
          }),
        )
        return { ok: true }
      }
      throw new Error(`Unexpected write: ${url}`)
    })

    const onChanged = jest.fn()
    const runGuardedMutation = jest.fn(async <T,>(operation: () => Promise<T>) => operation())

    renderWithProviders(
      <PersonCompaniesSection
        personId="person-1"
        personName="Lena Ortiz"
        initialLinkedCompanies={[
          { id: 'company-1', displayName: 'Alpha Corp', isPrimary: true },
        ]}
        onChanged={onChanged}
        runGuardedMutation={runGuardedMutation}
      />,
    )

    expect(await screen.findByText('1 linked companies')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Manage links' }))
    const betaCheckbox = await screen.findByRole('checkbox', { name: 'Select Beta Holdings' })
    fireEvent.click(betaCheckbox)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Link (person|company|deal)/ }))
    })

    await waitFor(() => {
      expect(screen.getByText('2 linked companies')).toBeInTheDocument()
    })
    expect(screen.getByText('Beta Holdings')).toBeInTheDocument()
    expect(onChanged).toHaveBeenCalled()
    expect(runGuardedMutation).toHaveBeenCalled()
  })

  it('navigates search results via numbered pagination', async () => {
    readApiResultOrThrowMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/customers/people/person-1/companies/enriched')) {
        return {
          items: [],
          totalPages: 1,
        }
      }
      const parsed = new URL(url, 'http://localhost')
      const page = Number(parsed.searchParams.get('page') ?? '1')
      if (page === 1) {
        return {
          items: [
            {
              id: 'company-2',
              display_name: 'Beta Holdings',
              website_url: 'beta.example',
            },
          ],
          totalPages: 2,
        }
      }
      return {
        items: [
          {
            id: 'company-3',
            display_name: 'Gamma Industries',
            website_url: 'gamma.example',
          },
        ],
        totalPages: 2,
      }
    })

    renderWithProviders(
      <PersonCompaniesSection
        personId="person-1"
        personName="Lena Ortiz"
        initialLinkedCompanies={[]}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Manage links' }))
    expect(await screen.findByText('Beta Holdings')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Next$/ }))
    })

    expect(await screen.findByText('Gamma Industries')).toBeInTheDocument()
  })
})
