/** @jest-environment jsdom */
import * as React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  invalidateInjectionWidgetCache,
  registerCoreInjectionTables,
  registerCoreInjectionWidgets,
  registerEnabledModuleIds,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'

const mockTranslate = (key: string, fallback?: string, params?: Record<string, unknown>) =>
  (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (match, name: string) => String(params?.[name] ?? match))
const mockTranslationManager = jest.fn((_props: Record<string, unknown>) => <div data-testid="translation-manager" />)
const mockChrome = { payload: { grantedFeatures: ['translations.*'] }, isReady: true, isLoading: false, refresh: jest.fn() }
const mockQueryClient = { invalidateQueries: jest.fn() }
const mockEntry = { id: 'entry-one', value: 'preferred', label: 'Preferred customer', color: null, icon: null, createdAt: null, updatedAt: null }
const mockReadApiResult = jest.fn()

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
  useOptionalT: () => mockTranslate,
}))
jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useBackendChrome: () => mockChrome }))
jest.mock('../TranslationManager', () => ({
  TranslationManager: (props: Record<string, unknown>) => mockTranslationManager(props),
}))
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => mockQueryClient }))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({ useOrganizationScopeVersion: () => 0 }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => false), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResult(...args),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => unknown) => run(),
}))
jest.mock('@open-mercato/core/modules/dictionaries/components/hooks/useDictionaryEntries', () => ({
  useDictionaryEntries: () => ({ data: { fullEntries: [mockEntry], map: {} }, isLoading: false, isError: false }),
  invalidateDictionaryEntries: jest.fn(),
}))
jest.mock('@open-mercato/core/modules/dictionaries/components/AppearanceSelector', () => ({
  AppearanceSelector: () => null,
  useAppearanceState: () => ({ icon: null, color: null, setIcon: jest.fn(), setColor: jest.fn() }),
}))
jest.mock('@open-mercato/core/modules/dictionaries/components/dictionaryAppearance', () => ({ DictionaryValue: () => null }))
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({
  CrudForm: ({ groups, isLoading }: { groups: Array<{ id: string; component?: React.ComponentType }>; isLoading?: boolean }) => (
    <div data-testid="definitions-form" data-loading={String(isLoading)}>
      {groups.map((group) => group.component ? <group.component key={group.id} /> : null)}
    </div>
  ),
}))
jest.mock('@open-mercato/ui/backend/fields/registry', () => ({
  loadGeneratedFieldRegistrations: jest.fn(async () => undefined),
  FieldRegistry: { getDefEditor: () => undefined },
}))
jest.mock('@open-mercato/ui/backend/utils/customFieldDefs', () => ({ invalidateCustomFieldDefs: jest.fn() }))

import { DictionaryEntriesEditor } from '../../../dictionaries/components/DictionaryEntriesEditor'
import EditDefinitionsPage from '../../../entities/backend/entities/user/[entityId]/page'
import dictionaryWidget from '../../widgets/injection/dictionary-entry-translation/widget'
import fieldWidget from '../../widgets/injection/field-definition-translation/widget'
import { buildInjectionTable } from '../../widgets/injection-table'

function registerTranslationActions(enabled: boolean) {
  const entries: ModuleInjectionWidgetEntry[] = enabled ? [
    { moduleId: 'translations', key: 'dictionary-entry-translation', source: 'package', widgetId: dictionaryWidget.metadata.id, loader: async () => dictionaryWidget },
    { moduleId: 'translations', key: 'field-definition-translation', source: 'package', widgetId: fieldWidget.metadata.id, loader: async () => fieldWidget },
  ] : []
  registerCoreInjectionWidgets(entries)
  registerCoreInjectionTables(enabled ? [{ moduleId: 'translations', table: buildInjectionTable({}) }] : [], entries)
  registerEnabledModuleIds(enabled ? ['dictionaries', 'entities', 'translations'] : ['dictionaries', 'entities'])
  invalidateInjectionWidgetCache()
}

describe('translation contributions at real rendered hosts', () => {
  beforeEach(() => {
    mockTranslationManager.mockClear()
    mockChrome.payload.grantedFeatures = ['translations.*']
    mockReadApiResult.mockImplementation(async (url: string) => url === '/api/entities/entities'
      ? { items: [{ entityId: 'example:record', label: 'Example record', source: 'custom' }] }
      : { items: [{ key: 'nickname', kind: 'text', configJson: { label: 'Nickname' } }], fieldsets: [], deletedKeys: [] })
  })

  afterEach(() => {
    cleanup()
    registerTranslationActions(false)
  })

  it('mounts the registered dictionary action and forwards the row identity through the real spot', async () => {
    registerTranslationActions(true)
    render(<DictionaryEntriesEditor dictionaryId="dictionary-one" dictionaryName="Customer status" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Translate' }))

    expect(mockTranslationManager).toHaveBeenLastCalledWith(expect.objectContaining({
      entityType: 'dictionaries:dictionary_entry', recordId: 'entry-one', baseValues: { label: 'Preferred customer' },
    }))
  })

  it('keeps Translate absent when the translations module contributes no widgets', async () => {
    registerTranslationActions(false)
    render(<DictionaryEntriesEditor dictionaryId="dictionary-one" dictionaryName="Customer status" />)

    await waitFor(() => expect(screen.getByText('Preferred customer')).toBeVisible())
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'Translate' })).toBeNull()
  })

  it('keeps inherited dictionary entries read-only even with a registered translation widget', async () => {
    registerTranslationActions(true)
    render(<DictionaryEntriesEditor dictionaryId="dictionary-one" dictionaryName="Customer status" readOnly />)

    expect(screen.getByText('Managed in parent organization')).toBeVisible()
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'Translate' })).toBeNull()
  })

  it('mounts the field action through the page and real shared editor with wildcard grants', async () => {
    registerTranslationActions(true)
    render(<EditDefinitionsPage params={{ entityId: 'example:record' }} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Translate field' }))

    expect(mockTranslationManager).toHaveBeenLastCalledWith(expect.objectContaining({
      entityType: 'entities:custom_field_def', recordId: 'example:record:nickname', baseValues: { label: 'Nickname' },
    }))
  })

  it('does not render a field Translate action when translations is absent', async () => {
    registerTranslationActions(false)
    render(<EditDefinitionsPage params={{ entityId: 'example:record' }} />)

    await waitFor(() => expect(screen.getByDisplayValue('nickname')).toBeVisible())
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'Translate field' })).toBeNull()
  })

  it('hides a registered Translate action without the manage feature', async () => {
    mockChrome.payload.grantedFeatures = ['translations.view']
    registerTranslationActions(true)
    render(<DictionaryEntriesEditor dictionaryId="dictionary-one" dictionaryName="Customer status" />)

    await waitFor(() => expect(screen.getByText('Preferred customer')).toBeVisible())
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'Translate' })).toBeNull()
  })
})
