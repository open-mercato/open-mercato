/**
 * @jest-environment jsdom
 *
 * Regression coverage for #3616: the MFA settings page's provider cell must not
 * call useProviderListComponent conditionally. Previously ProviderListCell
 * returned early for recovery_codes / missing-provider rows and only then called
 * the hook, so the same cell fiber switching row kind between renders changed the
 * hook count and React threw "Rendered more/fewer hooks than during the previous
 * render". The hook now lives in a dedicated ProviderRowItem that always receives
 * a provider; ProviderListCell itself calls no hooks.
 */
import * as React from 'react'
import * as fs from 'fs'
import * as path from 'path'
import { render } from '@testing-library/react'
import type { MfaProvider } from '@open-mercato/enterprise/modules/security/types'

// useProviderListComponent is the conditional hook at the heart of the bug. Mock
// it with a real React hook (useMemo) so that, in the unfixed code, the early
// returns in ProviderListCell would change the hook count between renders.
jest.mock('@open-mercato/enterprise/modules/security/components/mfa-ui-registry', () => ({
  useProviderListComponent: (provider: MfaProvider) => {
    React.useMemo(() => provider.type, [provider.type])
    return function ListComponent({ provider: p }: { provider: MfaProvider }) {
      return <div data-testid="provider-list-item">{p.label}</div>
    }
  },
}))

jest.mock(
  '@open-mercato/enterprise/modules/security/components/mfa-provider-list-items/RecoveryCodesListItem',
  () => ({
    __esModule: true,
    default: () => <div data-testid="recovery-codes-item">Recovery codes</div>,
  }),
)

// Mock the heavy/unrelated imports the page module pulls in at import time so the
// test stays focused on the cell components and does not boot a full DataTable.
jest.mock('next/navigation.js', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({ DataTable: () => <div /> }))
jest.mock('@open-mercato/ui/backend/EmptyState', () => ({ EmptyState: () => <div /> }))
jest.mock('@open-mercato/ui/backend/detail', () => ({ LoadingMessage: () => <div /> }))
jest.mock('@open-mercato/ui/backend/forms/FormHeader', () => ({ FormHeader: () => <div /> }))
jest.mock('@open-mercato/enterprise/modules/security/components/MfaEnrollmentNotice', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('@open-mercato/enterprise/modules/security/components/hooks/useMfaStatus', () => ({
  useMfaStatus: () => ({ loading: false, methods: [], providers: [] }),
}))
jest.mock('@open-mercato/enterprise/modules/security/lib/mfa-enrollment-notice', () => ({
  removeMfaEnrollmentNoticeQueryFromHref: () => null,
  resolveMfaEnrollmentNotice: () => ({ visible: false, overdue: false }),
}))

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pageModule = require('../page')
const ProviderListCell = pageModule.ProviderListCell as React.ComponentType<{
  row: { kind: 'provider' | 'recovery_codes'; provider?: MfaProvider; configuredCount?: number }
  onOpenProvider: (providerType: string) => void
}>

const provider: MfaProvider = {
  type: 'totp',
  label: 'Authenticator app',
  icon: 'shield',
  allowMultiple: false,
}

const providerRow = { kind: 'provider' as const, provider, configuredCount: 1 }
const recoveryRow = { kind: 'recovery_codes' as const }

describe('SecurityMfaPage ProviderListCell hook stability (#3616)', () => {
  it('does not change hook count when a cell switches provider → recovery_codes', () => {
    const { rerender } = render(
      <ProviderListCell row={providerRow} onOpenProvider={() => {}} />,
    )
    expect(() => {
      rerender(<ProviderListCell row={recoveryRow} onOpenProvider={() => {}} />)
    }).not.toThrow()
  })

  it('does not change hook count when a cell switches recovery_codes → provider', () => {
    const { rerender } = render(
      <ProviderListCell row={recoveryRow} onOpenProvider={() => {}} />,
    )
    expect(() => {
      rerender(<ProviderListCell row={providerRow} onOpenProvider={() => {}} />)
    }).not.toThrow()
  })

  it('renders the provider list item for a provider row', () => {
    const { getByTestId } = render(
      <ProviderListCell row={providerRow} onOpenProvider={() => {}} />,
    )
    expect(getByTestId('provider-list-item').textContent).toBe('Authenticator app')
  })
})

describe('SecurityMfaPage ProviderListCell — structural (#3616)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8')

  it('declares ProviderRowItem that calls the hook unconditionally', () => {
    expect(source).toMatch(/function ProviderRowItem\b/)
  })

  it('does not call useProviderListComponent inside ProviderListCell after an early return', () => {
    const cellBody = source.slice(source.indexOf('function ProviderListCell'))
    expect(cellBody).not.toMatch(/useProviderListComponent/)
  })
})
