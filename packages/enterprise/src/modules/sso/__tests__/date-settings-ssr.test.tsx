import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolveDateLocaleSettings } from '@open-mercato/shared/lib/date-locale/resolve'
import { DateLocaleSettingsProvider } from '@open-mercato/ui/primitives/date-locale-settings'
import SsoConfigListPage from '../backend/page'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }), { virtual: true })
jest.mock('next/link', () => () => null, { virtual: true })
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string) => key,
  useLocale: () => 'en',
}))
jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: React.PropsWithChildren) => children,
  PageBody: ({ children }: React.PropsWithChildren) => children,
}))
jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ columns }: {
    columns: Array<{
      accessorKey?: string
      cell?: (context: { row: { original: { createdAt: string } } }) => React.ReactNode
    }>
  }) => columns.find((column) => column.accessorKey === 'createdAt')?.cell?.({
    row: { original: { createdAt: '2026-07-02T02:05:00Z' } },
  }),
}))
jest.mock('@open-mercato/ui/backend/RowActions', () => ({ RowActions: () => null }))
jest.mock('@open-mercato/ui/primitives/button', () => ({ Button: () => null }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn(), apiCallOrThrow: jest.fn() }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))

it('formats the SSO date cell with tenant settings on its initial server render', () => {
  const settings = resolveDateLocaleSettings({ tenant: {
    locale: 'en-GB', dateFormat: 'dd/MM/yyyy', timeZone: 'America/Los_Angeles',
  } })
  const html = renderToStaticMarkup(
    <DateLocaleSettingsProvider value={settings}><SsoConfigListPage /></DateLocaleSettingsProvider>,
  )
  expect(html).toBe('01/07/2026')
})
