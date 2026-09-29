/** @jest-environment jsdom */
import * as React from 'react'
import { DataTable } from '../DataTable'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { render, screen } from '@testing-library/react'
import { formatWithPublicDateFormat } from '../../primitives/date-format'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
}))

jest.mock('../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false }),
}))

type Row = { id: string; created_at: string }

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

function renderTable(data: Row[], locale = 'pl') {
  const columns: ColumnDef<Row>[] = [{ accessorKey: 'created_at', header: 'Created' }]
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } })
  return render(
    React.createElement(
      QueryClientProvider as any,
      { client: queryClient },
      React.createElement(
        I18nProvider as any,
        { locale, dict: {} },
        React.createElement(DataTable as any, { columns, data, title: 'Test' }),
      ),
    ),
  )
}

describe('DataTable date cells', () => {
  // `new Date('2026-07-01')` reads a bare date as UTC midnight. Asserting the time too, not just
  // the day, catches that in either direction: a UTC parse reads `02:00` in Europe/Warsaw and
  // `2026-06-30 17:00` in America/Los_Angeles, while local midnight is `00:00` everywhere.
  it('renders a date-only value as local midnight of the stored day', () => {
    renderTable([{ id: '1', created_at: '2026-07-01' }])

    // `pl`, not `en`: under `en` a component that never reads the locale renders the same string as
    // one that does, so the assertion would hold either way — the corollary in
    // `.ai/lessons/tests-asserting-intl-output-must-pin-locale-and-date.md`. Mutation-checked:
    // dropping the locale from `DataTable`'s formatter call fails this case.
    //
    // The time is asserted too: a UTC parse reads `02:00` in Europe/Warsaw and 30 June further west,
    // while local midnight is `00:00` everywhere.
    expect(screen.getByText('1 lip 2026, 00:00')).toBeInTheDocument()
  })

  // The `locale` parameter exists for this case. `en` is `defaultLocale`, so a 12-hour clock in
  // every backend table is what most deployments get from this change; asserting it here means the
  // most-seen rendering in the product is guarded rather than inferred from the `pl` case above.
  it('renders the default locale on a 12-hour clock', () => {
    renderTable([{ id: '1', created_at: '2026-07-01' }], 'en')

    expect(screen.getByText('Jul 1, 2026, 12:00 AM')).toBeInTheDocument()
  })

  // One env chain with the detail-page helpers: a table cell and a detail field must not disagree.
  it('honours the date-time env format', () => {
    process.env.NEXT_PUBLIC_OM_DATE_TIME_FORMAT = 'dd.MM.yyyy HH:mm'
    renderTable([{ id: '1', created_at: '2026-07-01T09:30:00Z' }])

    // Same reason as the date-format suite: `09:30Z` is 30 June at UTC-10 and further west,
    // so the expectation comes from the formatter rather than a literal.
    const expected = formatWithPublicDateFormat(new Date('2026-07-01T09:30:00Z'), 'dd.MM.yyyy HH:mm')!
    expect(screen.getByText(expected)).toBeInTheDocument()
  })

  // The date vars stay in the chain and stay bare: appending a time to a caller's date-only
  // pattern would change how every existing table renders.
  it('uses a date-only env format bare, without inventing a time', () => {
    process.env.NEXT_PUBLIC_OM_DATE_FORMAT = 'dd.MM.yyyy'
    renderTable([{ id: '1', created_at: '2026-07-01' }])

    expect(screen.getByText('01.07.2026')).toBeInTheDocument()
  })
})
