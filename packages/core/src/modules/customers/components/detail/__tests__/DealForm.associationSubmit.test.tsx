/**
 * @jest-environment jsdom
 */

/**
 * `DealForm` used to put `personIds` and `companyIds` into every submission regardless of
 * whether it was showing those fields. The deal detail page hides the associations group and
 * manages links from its People and Companies tabs instead, so a Details save there wrote back
 * whatever ids the form had captured when it mounted.
 *
 * `CrudForm` seeds its values with a lazy `useState` initialiser, so it does not re-read
 * `initialValues` after mount. That made the stale write user-visible: unlink someone on the
 * People tab, then save Details, and the person comes back — with the lock token matching,
 * because the page reloaded in between. It also re-dated every surviving link row on the way
 * through.
 */

let capturedSubmit: ((values: Record<string, unknown>) => Promise<void>) | null = null

jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({ onSubmit }: { onSubmit: (values: Record<string, unknown>) => Promise<void> }) => {
    capturedSubmit = onSubmit
    return null
  },
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

// Rendering the real form otherwise pulls the currency dictionary, which throws when it is
// not configured. Nothing here depends on it.
jest.mock('../hooks/useCurrencyDictionary', () => ({
  useCurrencyDictionary: () => ({
    data: { entries: [], defaultCode: null },
    isLoading: false,
    refetch: jest.fn(async () => ({ data: { entries: [], defaultCode: null } })),
  }),
  ensureCurrencyDictionary: jest.fn(async () => ({ entries: [], defaultCode: null })),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, result: { items: [] } })),
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: jest.fn(async () => ({ items: [] })),
}))

import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DealForm } from '../DealForm'

const ADA = '550e8400-e29b-41d4-a716-4466554400a1'
const ACME = '550e8400-e29b-41d4-a716-4466554400c1'

const VALUES = {
  title: 'Expansion renewal',
  status: 'open',
  personIds: [ADA],
  companyIds: [ACME],
}

function renderForm(showAssociationsGroup: boolean, onSubmit: jest.Mock) {
  capturedSubmit = null
  renderWithProviders(
    <DealForm
      mode="edit"
      initialValues={{ id: 'deal-1', title: 'Expansion renewal', personIds: [ADA], companyIds: [ACME] }}
      onSubmit={onSubmit}
      showAssociationsGroup={showAssociationsGroup}
    />,
  )
  if (!capturedSubmit) throw new Error('CrudForm onSubmit was not captured')
  return capturedSubmit
}

describe('DealForm — link lists in the submitted payload', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it('omits personIds and companyIds when the associations group is hidden', async () => {
    const onSubmit = jest.fn(async () => {})
    const submit = renderForm(false, onSubmit)

    await submit(VALUES)

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const base = onSubmit.mock.calls[0][0].base as Record<string, unknown>
    expect(base).not.toHaveProperty('personIds')
    expect(base).not.toHaveProperty('companyIds')
    // The rest of the payload is unaffected.
    expect(base.title).toBe('Expansion renewal')
  })

  it('still submits them when the associations group is shown', async () => {
    const onSubmit = jest.fn(async () => {})
    const submit = renderForm(true, onSubmit)

    await submit(VALUES)

    const base = onSubmit.mock.calls[0][0].base as Record<string, unknown>
    expect(base.personIds).toEqual([ADA])
    expect(base.companyIds).toEqual([ACME])
  })
})
