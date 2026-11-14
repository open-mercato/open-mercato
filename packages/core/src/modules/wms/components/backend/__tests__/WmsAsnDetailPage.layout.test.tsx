/**
 * @jest-environment jsdom
 */
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import WmsAsnDetailPage from '../WmsAsnDetailPage'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
  useLocale: () => 'en',
}))

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    invalidateQueries: jest.fn(),
    setQueryData: jest.fn(),
  }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = queryKey.join(':')
    if (key.includes('header')) {
      return {
        isLoading: false,
        isError: false,
        data: {
          id: '11111111-1111-4111-8111-111111111111',
          warehouse_id: '22222222-2222-4222-8222-222222222222',
          status: 'in_transit',
          reference_number: 'ASN-1',
          updated_at: '2026-08-01T00:00:00.000Z',
        },
        refetch: jest.fn(),
      }
    }
    return {
      isLoading: false,
      isError: false,
      data: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          catalog_variant_id: '44444444-4444-4444-8444-444444444444',
          expected_qty: '2',
          received_qty: '0',
          qc_status: 'pending',
        },
      ],
      refetch: jest.fn(),
    }
  },
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: () => <div data-testid="asn-lines-table" />,
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: jest.fn(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('../useWmsInventoryMutationAccess', () => ({
  useWmsInventoryMutationAccess: () => ({
    loading: false,
    canManageAsn: false,
    canReceive: false,
    canManagePutaway: false,
  }),
}))

jest.mock('../useAsnDetailLabelCache', () => ({
  useAsnDetailLabelCache: () => ({}),
}))

jest.mock('../ReceiveAsnLineDialog', () => ({
  ReceiveAsnLineDialog: () => null,
}))

describe('WmsAsnDetailPage layout', () => {
  it('keeps the receiving-lines table inside a horizontal scroll container', () => {
    render(<WmsAsnDetailPage asnId="11111111-1111-4111-8111-111111111111" />)
    const scroller = screen.getByTestId('asn-detail-lines')
    expect(scroller.className).toContain('overflow-x-auto')
    expect(scroller.className).toContain('min-w-0')
    expect(scroller.querySelector('[data-testid="asn-lines-table"]')).toBeTruthy()
  })
})
