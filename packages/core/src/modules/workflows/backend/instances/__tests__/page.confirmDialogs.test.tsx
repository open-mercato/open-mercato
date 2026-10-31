/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createTranslator } from '@open-mercato/shared/lib/i18n/translate'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import WorkflowInstancesListPage from '../page'
import enDict from '../../../i18n/en.json'
import plDict from '../../../i18n/pl.json'

type InstanceFixture = { id: string; workflowId: string; status: string }
type ConfirmOptions = { title?: string; text?: string; variant?: string }
type RowActionItem = { id: string; label: string; onSelect?: () => void }
type CellColumn = { id?: string; cell?: (ctx: { row: { original: InstanceFixture } }) => React.ReactNode }

const instances: InstanceFixture[] = [
  { id: 'inst-failed', workflowId: 'order-approval', status: 'FAILED' },
  { id: 'inst-paused', workflowId: 'invoice-sync', status: 'PAUSED' },
]

let mockTranslate: TranslateFn = createTranslator(enDict)
const mockConfirm = jest.fn<Promise<boolean>, [ConfirmOptions]>()

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: instances, isLoading: false, error: null }),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: mockConfirm, ConfirmDialogElement: null }),
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: ({ columns, data }: { columns: CellColumn[]; data: InstanceFixture[] }) => {
    const actionsColumn = columns.find((column) => column.id === 'actions')
    return (
      <div>
        {data.map((row) => (
          <div key={row.id}>{actionsColumn?.cell?.({ row: { original: row } })}</div>
        ))}
      </div>
    )
  },
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: RowActionItem[] }) => (
    <div>
      {items
        .filter((item) => item.onSelect)
        .map((item) => (
          <button key={item.id} type="button" onClick={() => item.onSelect?.()}>
            {item.label}
          </button>
        ))}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/primitives/segmented-control', () => ({
  SegmentedControl: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SegmentedControlItem: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('../../../components/run/useLiveRunUpdates', () => ({ useLiveRunUpdates: jest.fn() }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('next/link', () => ({ children, href }: { children: React.ReactNode; href: string }) => (
  <a href={href}>{children}</a>
))

async function openConfirmFor(actionLabel: string): Promise<ConfirmOptions> {
  render(<WorkflowInstancesListPage />)
  fireEvent.click(screen.getByRole('button', { name: actionLabel }))
  await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1))
  return mockConfirm.mock.calls[0][0]
}

describe('workflow instances list confirmation dialogs', () => {
  beforeEach(() => {
    mockTranslate = createTranslator(enDict)
    mockConfirm.mockReset()
    mockConfirm.mockResolvedValue(false)
  })

  it('names the workflow in the retry confirmation', async () => {
    const options = await openConfirmFor(enDict['workflows.instances.actions.retry'])

    expect(options.title).toBe("Are you sure you want to retry workflow 'order-approval'?")
  })

  it('names the workflow in the cancel confirmation', async () => {
    const options = await openConfirmFor(enDict['workflows.instances.actions.cancel'])

    expect(options.title).toBe("Are you sure you want to cancel workflow 'invoice-sync'?")
  })

  it('interpolates the workflow id in the Polish translation', async () => {
    mockTranslate = createTranslator(plDict)

    const options = await openConfirmFor(plDict['workflows.instances.actions.retry'])

    expect(options.title).toBe("Czy na pewno chcesz ponowić przepływ 'order-approval'?")
    expect(options.title).not.toContain('{{')
  })
})
