/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

const createCrudMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
  apiCall: jest.fn().mockResolvedValue({ ok: true, result: { items: [] } }),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: (...args: unknown[]) => createCrudMock(...args),
  updateCrud: jest.fn(),
  deleteCrud: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 'scope-v1',
}))

// Fires the form's submit payload as soon as the dialog mounts, so the assertion targets the
// payload DealsSection builds rather than the form UI (covered by DealForm's own tests).
let submitPayload: { base: Record<string, unknown>; custom: Record<string, unknown> } | null = null
jest.mock('../DealDialog', () => ({
  DealDialog: ({ onSubmit }: { onSubmit: (p: unknown) => Promise<void> }) => {
    const fired = React.useRef(false)
    React.useEffect(() => {
      if (fired.current || !submitPayload) return
      fired.current = true
      void onSubmit(submitPayload)
    }, [onSubmit])
    return null
  },
}))

jest.mock('../../linking/LinkEntityDialog', () => ({ LinkEntityDialog: () => null }))

jest.mock(
  '#generated/entities.ids.generated',
  () => ({ E: { customers: { customer_deal: 'customers:customer_deal' } } }),
  { virtual: true },
)

jest.mock('../hooks/useCustomerDictionary', () => ({ useCustomerDictionary: () => ({ data: { map: {} } }) }))
jest.mock('../hooks/useCurrencyDictionary', () => ({ useCurrencyDictionary: jest.fn() }))
jest.mock('../hooks/useCustomFieldDisplay', () => ({
  useCustomFieldDisplay: () => ({ definitions: [], dictionaryMapsByKey: {}, isLoading: false, error: null }),
}))
jest.mock('../CustomFieldValuesList', () => ({ CustomFieldValuesList: () => null }))
jest.mock('@open-mercato/ui/backend/detail', () => ({
  LoadingMessage: ({ label }: { label: string }) => <div>{label}</div>,
  TabEmptyState: ({ title }: { title: string }) => <div>{title}</div>,
}))

import { DealsSection } from '../DealsSection'

function bodyOf(call: unknown[]): Record<string, unknown> {
  return call[1] as Record<string, unknown>
}

beforeEach(() => {
  createCrudMock.mockReset()
  createCrudMock.mockResolvedValue({ id: 'deal-1' })
  readApiResultOrThrowMock.mockReset()
  readApiResultOrThrowMock.mockResolvedValue({ items: [], total: 0 })
  submitPayload = null
})

/**
 * Regression guard. `handleCreate` builds its create payload as an explicit allow-list, so a
 * field missing from it never reaches the API however well the form collects it. `ownerUserId`
 * was absent: the "Add deal" dialog on a person/company page showed the owner pre-filled, the
 * save succeeded, and every deal created from that flow was silently unowned — which also meant
 * its won/lost notification went nowhere, the exact problem the feature exists to fix.
 */
describe('DealsSection create payload — owner', () => {
  it('forwards the selected owner to the create call', async () => {
    submitPayload = {
      base: { title: 'Expansion renewal', ownerUserId: 'user-7', personIds: [], companyIds: [] },
      custom: {},
    }

    renderWithProviders(
      <DealsSection
        scope={{ kind: 'person', entityId: 'person-1' }}
        addActionLabel="Add deal"
        emptyLabel="—"
        emptyState={{ title: 'No deals', actionLabel: 'Create deal' }}
      />,
    )

    await waitFor(() => expect(createCrudMock).toHaveBeenCalled())
    expect(bodyOf(createCrudMock.mock.calls[0])).toMatchObject({ ownerUserId: 'user-7' })
  })

  it('sends null when the picker is empty, so the deal is deliberately unowned', async () => {
    submitPayload = {
      base: { title: 'Unowned deal', ownerUserId: null, personIds: [], companyIds: [] },
      custom: {},
    }

    renderWithProviders(
      <DealsSection
        scope={{ kind: 'person', entityId: 'person-1' }}
        addActionLabel="Add deal"
        emptyLabel="—"
        emptyState={{ title: 'No deals', actionLabel: 'Create deal' }}
      />,
    )

    await waitFor(() => expect(createCrudMock).toHaveBeenCalled())
    expect(bodyOf(createCrudMock.mock.calls[0]).ownerUserId).toBeNull()
  })
})
