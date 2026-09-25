/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { z } from 'zod'
import { CreateDealForm } from '../CreateDealForm'

const mockCreateCrud = jest.fn()
const mockRunMutation = jest.fn()
let mockCurrentUserId = ''

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/backend/customers/deals/create',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('next/link', () => {
  const ReactForMock = require('react') as typeof React
  return {
    __esModule: true,
    default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
      ReactForMock.createElement('a', { href, ...props }, children),
  }
})

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallbackOrParams?: string | Record<string, string | number>) =>
    typeof fallbackOrParams === 'string' ? fallbackOrParams : key,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: (...args: unknown[]) => mockCreateCrud(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: mockRunMutation, retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/utils/useCurrentUserId', () => ({
  useCurrentUserId: () => mockCurrentUserId,
}))

jest.mock('../../DealForm', () => {
  const textField = z.preprocess((value) => (typeof value === 'string' ? value : ''), z.string())
  return {
    dealFormSchema: z.object({
      title: z.string().trim().min(1, 'customers.people.detail.deals.titleRequired'),
      status: textField,
      pipelineId: textField,
      pipelineStageId: textField,
      valueCurrency: textField,
      expectedCloseAt: textField,
      description: textField,
      ownerUserId: textField,
      personIds: z.array(z.string()).default([]),
      companyIds: z.array(z.string()).default([]),
    }),
  }
})

jest.mock('../useDealPipelines', () => ({
  useDealPipelines: () => ({ pipelines: [], stages: [], loadStages: jest.fn() }),
}))

// Surfaces the two values under test so the assertions do not depend on the real
// picker's async roster fetch.
jest.mock('../DealDetailsFields', () => {
  const ReactForMock = require('react') as typeof React
  return {
    DealDetailsFields: ({
      values,
      patch,
    }: {
      values: { title: string; ownerUserId: string }
      patch: (partial: Partial<{ title: string; ownerUserId: string }>) => void
    }) =>
      ReactForMock.createElement(
        'div',
        null,
        ReactForMock.createElement('input', {
          'aria-label': 'Deal title',
          value: values.title,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => patch({ title: event.target.value }),
        }),
        ReactForMock.createElement('input', {
          'aria-label': 'Owner',
          value: values.ownerUserId,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => patch({ ownerUserId: event.target.value }),
        }),
      ),
  }
})

jest.mock('../DealAssociationsField', () => ({ DealAssociationsField: () => null }))
// Submit stays disabled until custom fields report loaded, so the mock must fire onLoaded.
jest.mock('../DealCustomAttributes', () => {
  const ReactForMock = require('react') as typeof React
  return {
    DealCustomAttributes: ({ onLoaded }: { onLoaded?: (state: { fields: unknown[]; definitions: unknown[] }) => void }) => {
      const loadedRef = ReactForMock.useRef(false)
      ReactForMock.useEffect(() => {
        if (loadedRef.current) return
        loadedRef.current = true
        onLoaded?.({ fields: [], definitions: [] })
      }, [onLoaded])
      return null
    },
  }
})

function submit() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Create deal' })[0])
}

beforeEach(() => {
  mockCreateCrud.mockReset()
  mockRunMutation.mockReset()
  mockRunMutation.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
  mockCreateCrud.mockResolvedValue({ id: 'deal-1' })
  mockCurrentUserId = ''
})

describe('CreateDealForm owner', () => {
  it('defaults the owner to the current user once the id resolves', async () => {
    mockCurrentUserId = 'user-42'
    render(<CreateDealForm />)

    await waitFor(() => {
      expect((screen.getByLabelText('Owner') as HTMLInputElement).value).toBe('user-42')
    })
  })

  it('sends the defaulted owner in the create payload', async () => {
    mockCurrentUserId = 'user-42'
    render(<CreateDealForm />)

    await waitFor(() => expect((screen.getByLabelText('Owner') as HTMLInputElement).value).toBe('user-42'))
    fireEvent.change(screen.getByLabelText('Deal title'), { target: { value: 'Expansion renewal' } })
    submit()

    await waitFor(() => expect(mockCreateCrud).toHaveBeenCalled())
    expect(mockCreateCrud.mock.calls[0][1]).toMatchObject({ ownerUserId: 'user-42' })
  })

  it('never overrides an owner the user already picked', async () => {
    mockCurrentUserId = ''
    const { rerender } = render(<CreateDealForm />)

    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'user-chosen' } })
    // The current-user id arrives after the user has already chosen someone else.
    mockCurrentUserId = 'user-42'
    rerender(<CreateDealForm />)

    await waitFor(() => {
      expect((screen.getByLabelText('Owner') as HTMLInputElement).value).toBe('user-chosen')
    })
  })

  it('respects an explicit owner seed over the current-user default', async () => {
    mockCurrentUserId = 'user-42'
    render(<CreateDealForm initialValues={{ ownerUserId: 'user-seeded' }} />)

    await waitFor(() => {
      expect((screen.getByLabelText('Owner') as HTMLInputElement).value).toBe('user-seeded')
    })
  })

  it('omits the owner from the payload when none is set', async () => {
    mockCurrentUserId = ''
    render(<CreateDealForm />)

    fireEvent.change(screen.getByLabelText('Deal title'), { target: { value: 'Unowned deal' } })
    submit()

    await waitFor(() => expect(mockCreateCrud).toHaveBeenCalled())
    expect(mockCreateCrud.mock.calls[0][1].ownerUserId).toBeUndefined()
  })
})
