/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { DealLinkedEntitiesTab } from '../DealLinkedEntitiesTab'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useDealAssociations } from '../../../backend/customers/deals/[id]/hooks/useDealAssociations'
import type { DealDetailPayload, GuardedMutationRunner } from '../../../backend/customers/deals/[id]/hooks/types'

const flashMock = jest.fn()
const reportErrorMock = jest.fn()

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({
    reportError: (...args: unknown[]) => reportErrorMock(...args),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: jest.fn(() => false),
}))
jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  updateCrud: jest.fn(async () => ({})),
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: jest.fn(async () => ({ items: [] })),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
}))
jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

beforeEach(() => {
  jest.clearAllMocks()
  reportErrorMock.mockReset()
})

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

jest.mock('@open-mercato/ui/primitives/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div data-testid="dialog-content" {...props}>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('DealLinkedEntitiesTab', () => {
  it.each([
    { kind: 'people', entityLabel: 'Person', previousId: 'person-1', nextId: 'person-2', payloadKey: 'personIds' },
    { kind: 'companies', entityLabel: 'Company', previousId: 'company-1', nextId: 'company-2', payloadKey: 'companyIds' },
  ] as const)('keeps the $kind dialog open after a refusal and closes it after a successful retry', async (association) => {
    const refusal = createCrudFormError('This contact cannot be linked to the deal.', undefined, { status: 422 })
    jest.mocked(updateCrud).mockRejectedValueOnce(refusal)
    if (association.kind === 'companies') {
      reportErrorMock.mockImplementationOnce(() => { throw new Error('Telemetry unavailable') })
    }
    const onRefresh = jest.fn()
    const runMutationWithContext: GuardedMutationRunner = async (operation) => operation()
    const options = [
      { id: association.previousId, label: 'Existing contact', subtitle: null },
      { id: association.nextId, label: 'New contact', subtitle: null },
    ]
    const searchEntities = async () => ({ items: options, totalPages: 1 })
    const fetchEntitiesByIds = async (ids: string[]) => options.filter((option) => ids.includes(option.id))
    const icon = <span>icon</span>
    const initialData: DealDetailPayload = {
      deal: {
        id: 'deal-1', title: 'Deal', description: null, status: null,
        pipelineStage: null, pipelineId: null, pipelineStageId: null,
        valueAmount: null, valueCurrency: null, probability: null,
        expectedCloseAt: null, ownerUserId: null, source: null,
        closureOutcome: null, lossReasonId: null, lossNotes: null,
        organizationId: 'org-1', tenantId: 'tenant-1',
        createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
      },
      people: [{ id: 'person-1', label: 'Existing contact', subtitle: null, kind: 'person' }],
      companies: [{ id: 'company-1', label: 'Existing contact', subtitle: null, kind: 'company' }],
      linkedPersonIds: ['person-1'], linkedCompanyIds: ['company-1'],
      counts: { people: 1, companies: 1 }, customFields: {}, viewer: null,
      pipelineStages: [], pipelineName: null, stageTransitions: [], owner: null,
    }

    function Harness() {
      const [data, setData] = React.useState<DealDetailPayload | null>(initialData)
      const hook = useDealAssociations({ currentDealId: 'deal-1', data, setData, runMutationWithContext, onRefresh })
      const isPeople = association.kind === 'people'
      return (
        <DealLinkedEntitiesTab
          entityLabel={association.entityLabel}
          entityLabelPlural={association.kind}
          manageLabel="Manage linked contacts"
          searchPlaceholder="Search linked contacts"
          linkedItems={data?.[association.kind] ?? []}
          linkedCount={data?.counts[association.kind]}
          selectedIds={isPeople ? hook.peopleEditorIds : hook.companiesEditorIds}
          savePending={isPeople ? hook.peopleSaving : hook.companiesSaving}
          hrefBuilder={(id) => `/backend/customers/${association.kind}/${id}`}
          onSaveSelection={isPeople ? hook.handlePeopleAssociationsChange : hook.handleCompaniesAssociationsChange}
          searchEntities={searchEntities}
          fetchEntitiesByIds={fetchEntitiesByIds}
          icon={icon}
        />
      )
    }

    renderWithProviders(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Manage links' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select New contact' }))
    const confirmLabel = `Link ${association.entityLabel.toLowerCase()}`

    await act(async () => {
      if (association.kind === 'people') {
        fireEvent.click(screen.getByRole('button', { name: confirmLabel }))
      } else {
        fireEvent.keyDown(screen.getByTestId('dialog-content'), { key: 'Enter', ctrlKey: true })
      }
    })

    await waitFor(() => expect(flashMock).toHaveBeenCalledWith(refusal.message, 'error'))
    expect(flashMock).toHaveBeenCalledTimes(1)
    expect(reportErrorMock).toHaveBeenCalledWith(refusal, {
      module: 'customers', code: 'customers.link_confirmation_failed',
    })
    expect(screen.getByTestId('dialog-content')).toBeInTheDocument()
    expect(onRefresh).not.toHaveBeenCalled()
    expect(screen.getByText(`1 linked ${association.entityLabel.toLowerCase()}`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled()
    expect(screen.queryByText('Saving…')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText(`Search all ${association.kind}…`), {
      target: { value: 'New contact' },
    })
    const newContactCheckbox = await screen.findByRole('checkbox', { name: 'Select New contact' })
    if (newContactCheckbox.getAttribute('aria-checked') !== 'true') {
      fireEvent.click(newContactCheckbox)
    }
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: confirmLabel }))
    })

    await waitFor(() => expect(screen.queryByTestId('dialog-content')).not.toBeInTheDocument())
    expect(updateCrud).toHaveBeenCalledTimes(2)
    expect(updateCrud).toHaveBeenLastCalledWith('customers/deals', {
      id: 'deal-1', [association.payloadKey]: [association.previousId, association.nextId],
    })
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('selects all visible results and refreshes the linked list after save', async () => {
    const catalog = {
      'person-1': { id: 'person-1', label: 'Ada Lovelace', subtitle: 'Lead buyer' },
      'person-2': { id: 'person-2', label: 'Grace Hopper', subtitle: 'Procurement lead' },
      'person-3': { id: 'person-3', label: 'Linus Torvalds', subtitle: 'CTO' },
    }
    const savedSelections: string[][] = []

    function Harness() {
      const [selectedIds, setSelectedIds] = React.useState<string[]>(['person-1'])
      const [linkedIds, setLinkedIds] = React.useState<string[]>(['person-1'])

      return (
        <DealLinkedEntitiesTab
          entityLabel="Person"
          entityLabelPlural="People"
          manageLabel="Manage linked people"
          searchPlaceholder="Search linked people…"
          linkedItems={linkedIds.map((id) => catalog[id as keyof typeof catalog])}
          linkedCount={linkedIds.length}
          selectedIds={selectedIds}
          hrefBuilder={(id) => `/backend/customers/people-v2/${id}`}
          onSaveSelection={async (nextIds) => {
            savedSelections.push(nextIds)
            setSelectedIds(nextIds)
            setLinkedIds(nextIds)
          }}
          loadLinkedPage={async () => ({
            items: linkedIds.map((id) => catalog[id as keyof typeof catalog]),
            totalPages: 1,
            total: linkedIds.length,
          })}
          searchEntities={async () => ({
            items: [catalog['person-2'], catalog['person-3']],
            totalPages: 1,
          })}
          fetchEntitiesByIds={async (ids) => ids.map((id) => catalog[id as keyof typeof catalog])}
          icon={<span>icon</span>}
        />
      )
    }

    renderWithProviders(<Harness />)

    await waitFor(() => {
      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Manage links' }))

    await waitFor(() => {
      expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
      expect(screen.getByText('Linus Torvalds')).toBeInTheDocument()
    })

    const graceCheckbox = screen.getByRole('checkbox', { name: 'Select Grace Hopper' })
    fireEvent.click(graceCheckbox)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Linus Torvalds' }))

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Link (person|company|deal)/ }))
    })

    await waitFor(() => {
      expect(savedSelections).toEqual([['person-1', 'person-2', 'person-3']])
    })

    await waitFor(() => {
      expect(screen.getByText('Grace Hopper')).toBeInTheDocument()
      expect(screen.getByText('Linus Torvalds')).toBeInTheDocument()
    })
  })

  it('navigates between search pages via numbered pagination', async () => {
    const catalog = {
      'person-1': { id: 'person-1', label: 'Ada Lovelace', subtitle: 'Lead buyer' },
      'person-2': { id: 'person-2', label: 'Grace Hopper', subtitle: 'Procurement lead' },
      'person-3': { id: 'person-3', label: 'Linus Torvalds', subtitle: 'CTO' },
    }

    renderWithProviders(
      <DealLinkedEntitiesTab
        entityLabel="Person"
        entityLabelPlural="People"
        manageLabel="Manage linked people"
        searchPlaceholder="Search linked people…"
        linkedItems={[catalog['person-1']]}
        linkedCount={1}
        selectedIds={['person-1']}
        hrefBuilder={(id) => `/backend/customers/people-v2/${id}`}
        onSaveSelection={async () => {}}
        searchEntities={async (_query, page) => {
          if (page === 1) {
            return {
              items: [catalog['person-2']],
              totalPages: 2,
            }
          }
          return {
            items: [catalog['person-3']],
            totalPages: 2,
          }
        }}
        fetchEntitiesByIds={async (ids) => ids.map((id) => catalog[id as keyof typeof catalog])}
        icon={<span>icon</span>}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Manage links' }))

    expect(await screen.findByText('Grace Hopper')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Next$/ }))
    })

    expect(await screen.findByText('Linus Torvalds')).toBeInTheDocument()
  })
})
