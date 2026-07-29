/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import ResourcesResourceTypesPage from '../resource-types/page'
import ResourcesResourcesPage from '../resources/page'
import ResourcesResourceDetailPage from '../resources/[id]/page'

const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockRefresh = jest.fn()
let mockSearchParams = new URLSearchParams()

const mockApiCall = jest.fn()
const mockApiCallOrThrow = jest.fn()
const mockReadApiResultOrThrow = jest.fn()
const mockWithScopedApiRequestHeaders = jest.fn((_headers: Record<string, string>, run: () => unknown) => run())
const mockCreateCrud = jest.fn()
const mockUpdateCrud = jest.fn()
const mockDeleteCrud = jest.fn()
const mockRunMutation = jest.fn(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
const mockRetryLastMutation = jest.fn(async () => false)
const mockResolveFieldsetCode = jest.fn(() => 'resources_resource_default')
const mockTranslate = (_key: string, fallback?: string) => fallback ?? _key

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/resources/resources',
  useRouter: () => ({ push: mockPush, replace: mockReplace, refresh: mockRefresh }),
  useSearchParams: () => mockSearchParams,
}))

jest.mock('next/link', () => ({ children, href }: { children: React.ReactNode; href: string }) => (
  <a href={href}>{children}</a>
))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('@open-mercato/shared/lib/i18n/translate', () => ({
  createTranslatorWithFallback: () => mockTranslate,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 1,
}))

jest.mock('#generated/entities.ids.generated', () => ({
  E: {
    resources: {
      resources_resource: 'resources:resources_resource',
      resources_resource_activity: 'resources:resources_resource_activity',
    },
  },
}), { virtual: true })

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/forms', () => ({
  FormHeader: ({ title }: { title: React.ReactNode }) => <h1>{title}</h1>,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, asChild: _asChild, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => (
    <button {...props}>{children}</button>
  ),
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: (props: { data?: Array<Record<string, unknown>>; rowActions?: (row: Record<string, unknown>) => React.ReactNode }) => (
    <div>
      {(props.data ?? []).map((row, index) => (
        <div key={String(row.id ?? index)} data-testid={`row-${String(row.id ?? index)}`}>
          {props.rowActions?.(row)}
        </div>
      ))}
    </div>
  ),
  withDataTableNamespaces: (row: Record<string, unknown>) => row,
}))

jest.mock('@open-mercato/ui/backend/RowActions', () => ({
  RowActions: ({ items }: { items: Array<{ id: string; label: string; onSelect?: () => void }> }) => (
    <div>
      {items.map((item) => (
        <button key={item.id} type="button" data-testid={`row-action-${item.id}`} onClick={() => item.onSelect?.()}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn(async () => true),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => mockApiCall(...args),
  apiCallOrThrow: (...args: unknown[]) => mockApiCallOrThrow(...args),
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
  withScopedApiRequestHeaders: (...args: [Record<string, string>, () => unknown]) =>
    mockWithScopedApiRequestHeaders(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/crud', () => ({
  createCrud: (...args: unknown[]) => mockCreateCrud(...args),
  updateCrud: (...args: unknown[]) => mockUpdateCrud(...args),
  deleteCrud: (...args: unknown[]) => mockDeleteCrud(...args),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: (updatedAt?: string | null) =>
    updatedAt ? { 'x-om-ext-optimistic-lock-expected-updated-at': updatedAt } : {},
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: mockRunMutation,
    retryLastMutation: mockRetryLastMutation,
  }),
}))

jest.mock('@open-mercato/core/modules/dictionaries/components/dictionaryAppearance', () => ({
  ICON_SUGGESTIONS: [],
  renderDictionaryColor: (color: string) => <span>{color}</span>,
  renderDictionaryIcon: (icon: string) => <span>{icon}</span>,
}))

jest.mock('@open-mercato/ui/backend/ValueIcons', () => ({
  BooleanIcon: ({ value }: { value: boolean }) => <span>{String(value)}</span>,
}))

jest.mock('@open-mercato/ui/backend/version-history', () => ({
  VersionHistoryAction: () => null,
}))

jest.mock('@open-mercato/ui/backend/messages', () => ({
  SendObjectMessageDialog: () => null,
}))

jest.mock('@open-mercato/core/modules/resources/components/detail/dictionaries', () => ({
  createResourceDictionaryEntry: jest.fn(async (_dictionary: string, input: Record<string, unknown>) => ({
    id: 'activity-type-2',
    ...input,
  })),
  loadResourceDictionary: jest.fn(async () => ({ dictionary: { id: 'activity-types' }, entries: [] })),
}))

jest.mock('@open-mercato/core/modules/planner/components/AvailabilityRulesEditor', () => ({
  AvailabilityRulesEditor: ({ onRulesetChange }: { onRulesetChange: (nextId: string | null) => Promise<void> }) => (
    <button type="button" data-testid="change-ruleset" onClick={() => { void onRulesetChange('ruleset-2') }}>
      change ruleset
    </button>
  ),
}))

jest.mock('@open-mercato/core/modules/resources/components/ResourceCrudForm', () => ({
  ResourcesResourceForm: ({
    formConfig,
    onDelete,
  }: {
    formConfig: { tagsSection?: { createTag: (label: string) => Promise<unknown>; onSave: (payload: unknown) => Promise<void> } }
    onDelete?: () => Promise<void>
  }) => (
    <div>
      <button type="button" data-testid="detail-delete" onClick={() => { void onDelete?.() }}>
        delete resource
      </button>
      <button type="button" data-testid="create-tag" onClick={() => { void formConfig.tagsSection?.createTag('Urgent') }}>
        create tag
      </button>
      <button
        type="button"
        data-testid="save-tags"
        onClick={() => {
          void formConfig.tagsSection?.onSave({
            next: [{ id: 'tag-new', label: 'New tag', color: null }],
            added: [{ id: 'tag-new', label: 'New tag', color: null }],
            removed: [{ id: 'tag-old', label: 'Old tag', color: null }],
          })
        }}
      >
        save tags
      </button>
    </div>
  ),
  useResourcesResourceFormConfig: ({ tagsSection }: { tagsSection?: unknown }) => ({
    fields: [],
    groups: [],
    resourceTypesLoaded: true,
    resolveFieldsetCode: mockResolveFieldsetCode,
    tagsSection,
  }),
}))

jest.mock('@open-mercato/ui/backend/detail', () => ({
  ActivitiesSection: ({ dataAdapter }: { dataAdapter: { create: (payload: unknown) => Promise<void>; update: (payload: unknown) => Promise<void>; delete: (payload: unknown) => Promise<void> } }) => (
    <div>
      <button
        type="button"
        data-testid="activity-create"
        onClick={() => {
          void dataAdapter.create({
            entityId: 'resource-1',
            activityType: 'meeting',
            subject: 'Visit',
            body: 'Checked room',
            occurredAt: '2026-06-19T10:00:00.000Z',
          })
        }}
      >
        create activity
      </button>
      <button
        type="button"
        data-testid="activity-update"
        onClick={() => { void dataAdapter.update({ id: 'activity-1', patch: { subject: 'Updated' } }) }}
      >
        update activity
      </button>
      <button
        type="button"
        data-testid="activity-delete"
        onClick={() => { void dataAdapter.delete({ id: 'activity-1' }) }}
      >
        delete activity
      </button>
    </div>
  ),
  NotesSection: ({ dataAdapter }: { dataAdapter: { create: (payload: unknown) => Promise<unknown>; update: (payload: unknown) => Promise<void>; delete: (payload: unknown) => Promise<void> } }) => (
    <div>
      <button
        type="button"
        data-testid="note-create"
        onClick={() => {
          void dataAdapter.create({
            entityId: 'resource-1',
            body: 'Needs cleaning',
            appearanceIcon: null,
            appearanceColor: null,
          })
        }}
      >
        create note
      </button>
      <button
        type="button"
        data-testid="note-update"
        onClick={() => { void dataAdapter.update({ id: 'note-1', patch: { body: 'Updated note' } }) }}
      >
        update note
      </button>
      <button
        type="button"
        data-testid="note-delete"
        onClick={() => { void dataAdapter.delete({ id: 'note-1' }) }}
      >
        delete note
      </button>
    </div>
  ),
  RecordNotFoundState: () => <div>not found</div>,
}))

jest.mock('lucide-react', () => new Proxy({}, { get: () => () => null }))

function apiResult(result: Record<string, unknown>) {
  return { ok: true, result }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSearchParams = new URLSearchParams()
  mockRunMutation.mockImplementation(async ({ operation }: { operation: () => Promise<unknown> }) => operation())
  mockRetryLastMutation.mockResolvedValue(false)
  mockCreateCrud.mockResolvedValue(undefined)
  mockUpdateCrud.mockResolvedValue(undefined)
  mockDeleteCrud.mockResolvedValue(undefined)
  mockApiCallOrThrow.mockImplementation(async (url: string) => {
    if (url === '/api/resources/tags') {
      return { result: { id: 'tag-created', label: 'Urgent', color: null } }
    }
    return { result: {} }
  })
  mockApiCall.mockImplementation(async (url: string) => {
    if (url === '/api/auth/feature-check') {
      return apiResult({ ok: true, granted: ['resources.manage_resources'] })
    }
    if (url.startsWith('/api/resources/resource-types')) {
      return apiResult({
        items: [{ id: 'type-1', name: 'Room', appearanceIcon: null, appearanceColor: null }],
        total: 1,
        page: 1,
        totalPages: 1,
      })
    }
    if (url.startsWith('/api/resources/resources')) {
      return apiResult({
        items: [
          {
            id: 'resource-1',
            name: 'Room 1',
            resourceTypeId: null,
            capacity: 1,
            tags: [],
            isActive: true,
            updatedAt: '2026-06-19T10:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        totalPages: 1,
      })
    }
    return apiResult({ items: [] })
  })
  mockReadApiResultOrThrow.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/resources/resource-types')) {
      return {
        items: [
          {
            id: 'resource-type-1',
            name: 'Room',
            description: null,
            appearanceIcon: null,
            appearanceColor: null,
            updatedAt: '2026-06-19T10:00:00.000Z',
            resourceCount: 0,
          },
        ],
        total: 1,
        totalPages: 1,
      }
    }
    if (url.startsWith('/api/resources/resources')) {
      return {
        items: [
          {
            id: 'resource-1',
            name: 'Room 1',
            resourceTypeId: null,
            capacity: 1,
            tags: [{ id: 'tag-old', label: 'Old tag', color: null }],
            isActive: true,
            updatedAt: '2026-06-19T10:00:00.000Z',
            availabilityRuleSetId: 'ruleset-1',
          },
        ],
        total: 1,
        totalPages: 1,
      }
    }
    return { items: [] }
  })
})

it('wraps resource list deletes in the guarded mutation path', async () => {
  render(<ResourcesResourcesPage />)

  fireEvent.click(await screen.findByTestId('row-action-delete'))

  await waitFor(() => {
    expect(mockDeleteCrud).toHaveBeenCalledWith('resources/resources', 'resource-1', expect.any(Object))
  })
  expect(mockRunMutation).toHaveBeenCalledWith(expect.objectContaining({
    context: expect.objectContaining({
      formId: 'resources.resources.list',
      resourceKind: 'resources.resource',
      resourceId: 'resource-1',
      retryLastMutation: mockRetryLastMutation,
    }),
    mutationPayload: expect.objectContaining({ operation: 'deleteResource', id: 'resource-1' }),
  }))
})

it('wraps resource type list deletes in the guarded mutation path', async () => {
  render(<ResourcesResourceTypesPage />)

  fireEvent.click(await screen.findByTestId('row-action-delete'))

  await waitFor(() => {
    expect(mockDeleteCrud).toHaveBeenCalledWith('resources/resource-types', 'resource-type-1', expect.any(Object))
  })
  expect(mockRunMutation).toHaveBeenCalledWith(expect.objectContaining({
    context: expect.objectContaining({
      formId: 'resources.resource-types.list',
      resourceKind: 'resources.resourceType',
      resourceId: 'resource-type-1',
      retryLastMutation: mockRetryLastMutation,
    }),
    mutationPayload: expect.objectContaining({ operation: 'deleteResourceType', id: 'resource-type-1' }),
  }))
})

it('wraps resource detail tag writes and delete in the guarded mutation path', async () => {
  render(<ResourcesResourceDetailPage params={{ id: 'resource-1' }} />)

  fireEvent.click(await screen.findByTestId('create-tag'))
  fireEvent.click(await screen.findByTestId('save-tags'))
  fireEvent.click(await screen.findByTestId('detail-delete'))

  await waitFor(() => {
    expect(mockRunMutation).toHaveBeenCalledWith(expect.objectContaining({
      mutationPayload: expect.objectContaining({ operation: 'createTag', label: 'Urgent' }),
    }))
    expect(mockRunMutation).toHaveBeenCalledWith(expect.objectContaining({
      mutationPayload: expect.objectContaining({ operation: 'assignTag', resourceId: 'resource-1', tagId: 'tag-new' }),
    }))
    expect(mockRunMutation).toHaveBeenCalledWith(expect.objectContaining({
      mutationPayload: expect.objectContaining({ operation: 'unassignTag', resourceId: 'resource-1', tagId: 'tag-old' }),
    }))
    expect(mockRunMutation).toHaveBeenCalledWith(expect.objectContaining({
      mutationPayload: expect.objectContaining({ operation: 'deleteResource', id: 'resource-1' }),
    }))
  })
})

it('wraps resource availability ruleset updates in the guarded mutation path', async () => {
  render(<ResourcesResourceDetailPage params={{ id: 'resource-1' }} />)

  fireEvent.click(await screen.findByRole('tab', { name: 'Availability' }))
  fireEvent.click(await screen.findByTestId('change-ruleset'))

  await waitFor(() => {
    expect(mockUpdateCrud).toHaveBeenCalledWith(
      'resources/resources',
      { id: 'resource-1', availabilityRuleSetId: 'ruleset-2' },
      expect.any(Object),
    )
  })
  expect(mockRunMutation).toHaveBeenCalledWith(expect.objectContaining({
    context: expect.objectContaining({
      formId: 'resources.resource:resource-1',
      resourceKind: 'resources.resource',
      resourceId: 'resource-1',
      retryLastMutation: mockRetryLastMutation,
    }),
    mutationPayload: expect.objectContaining({
      operation: 'updateAvailabilityRuleSet',
      id: 'resource-1',
      availabilityRuleSetId: 'ruleset-2',
    }),
  }))
})

it('wraps resource notes and activities adapter writes in the guarded mutation path', async () => {
  render(<ResourcesResourceDetailPage params={{ id: 'resource-1' }} />)

  fireEvent.click(await screen.findByTestId('note-create'))
  fireEvent.click(await screen.findByTestId('note-update'))
  fireEvent.click(await screen.findByTestId('note-delete'))

  const activitiesTab = screen.getByRole('tab', { name: 'Activities' })
  expect(activitiesTab).toHaveAttribute('data-slot', 'tabs-trigger')
  expect(activitiesTab).toHaveAttribute('data-variant', 'underline')
  fireEvent.click(activitiesTab)
  fireEvent.click(await screen.findByTestId('activity-create'))
  fireEvent.click(await screen.findByTestId('activity-update'))
  fireEvent.click(await screen.findByTestId('activity-delete'))

  await waitFor(() => {
    for (const operation of ['createNote', 'updateNote', 'deleteNote', 'createActivity', 'updateActivity', 'deleteActivity']) {
      expect(mockRunMutation).toHaveBeenCalledWith(expect.objectContaining({
        mutationPayload: expect.objectContaining({ operation }),
      }))
    }
  })
})
