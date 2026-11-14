/**
 * @jest-environment jsdom
 */

// Regression for #8080: TC-CRM-006 intermittently saved a company address with
// `addressLine1` empty even though the test had just typed into it. The CI trace showed
// every OTHER field correctly filled (label, type, city, region, postal, primary) while
// `addressLine1` — edited between the type select and the city fill — was blank and
// `aria-invalid`, which blocks `AddressTiles`'s client-side `validate()` and hangs the
// Save click forever (the observed 20s timeout, with no request ever sent).
//
// `AddressEditor.update()` builds the next draft from a `current` object derived from the
// `value` prop at render time. If the host (`AddressTiles`) has not yet re-rendered with an
// earlier edit's result — e.g. two field changes land in the same render batch — a second
// `update()` call used the SAME stale `current`, so its `onChange` call silently dropped the
// first edit when the host replaced `draft` wholesale. This reproduces that scenario directly
// (fire two field edits without an intervening re-render) rather than relying on Radix Select's
// exact async timing, which is incidental to the underlying race.

import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { AddressEditor, type AddressEditorDraft } from '../AddressEditor'

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/customers/companies/1',
  useSearchParams: () => new URLSearchParams(),
}))

const t = (_key: string, fallback?: string) => fallback ?? ''

const emptyDraft: AddressEditorDraft = {
  name: '',
  purpose: '',
  companyName: '',
  addressLine1: '',
  addressLine2: '',
  buildingNumber: '',
  flatNumber: '',
  city: '',
  region: '',
  postalCode: '',
  country: '',
  isPrimary: false,
}

describe('AddressEditor — field edits in the same render batch do not clobber each other', () => {
  it('keeps an earlier edit when a later edit fires before the host re-renders with it', () => {
    const calls: AddressEditorDraft[] = []
    renderWithProviders(
      <AddressEditor
        value={emptyDraft}
        onChange={(next) => calls.push(next)}
        format="line_first"
        t={t}
      />,
    )

    // Note: the host never re-renders `value` between these two edits — this is the exact
    // condition under which the pre-fix `update()` recomputed `next` from the SAME stale
    // `current` for both calls.
    fireEvent.change(screen.getByPlaceholderText('Label'), { target: { value: 'HQ' } })
    fireEvent.change(screen.getByPlaceholderText('Address line 1'), {
      target: { value: '100 Main Street' },
    })

    expect(calls).toHaveLength(2)
    const last = calls[calls.length - 1]
    expect(last.addressLine1).toBe('100 Main Street')
    expect(last.name).toBe('HQ')
  })
})
