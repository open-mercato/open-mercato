/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CreateAsnDialog } from '../CreateAsnDialog'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: jest.fn(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/inputs/ComboboxInput', () => ({
  ComboboxInput: () => <input aria-label="lookup" />,
}))

jest.mock('../inventoryMutationLoaders', () => ({
  loadCatalogVariantOptions: jest.fn(async () => []),
  loadStagingLocationOptions: jest.fn(async () => []),
  loadWarehouseOptions: jest.fn(async () => []),
  resolveCatalogVariantLabel: jest.fn(async () => null),
  resolveLocationLabel: jest.fn(async () => null),
  resolveWarehouseLabel: jest.fn(async () => null),
}))

const access = {
  loading: false,
  organizationId: 'org-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  scopeReady: true,
  canManageAsn: true,
} as never

function Harness() {
  const openerRef = React.useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <button
        ref={openerRef}
        type="button"
        onClick={(event) => {
          openerRef.current = event.currentTarget
          setOpen(true)
        }}
      >
        Create ASN
      </button>
      <CreateAsnDialog open={open} onOpenChange={setOpen} access={access} openerRef={openerRef} />
    </>
  )
}

describe('CreateAsnDialog focus restore', () => {
  it('returns focus to the opening button when Escape closes the dialog', async () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Create ASN' })
    fireEvent.click(opener)
    expect(screen.getByRole('dialog')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(opener)
  })
})
