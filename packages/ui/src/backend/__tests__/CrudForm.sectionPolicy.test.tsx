import '@testing-library/jest-dom'
import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { webcrypto } from 'node:crypto'
import { TextEncoder } from 'node:util'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import { z } from 'zod'
import {
  failCrudFormSectionClientRegistry,
  registerCrudFormSectionClientRegistry,
  type CrudFormSectionClientRegistry,
} from '@open-mercato/shared/lib/crud/form-sections/client-registry'
import type { CrudFormSectionSurfaceAlternativeFact } from '@open-mercato/shared/modules/form-section-facts'
import {
  registerCoreInjectionTables, registerCoreInjectionWidgets, registerEnabledModuleIds, setInjectionRegistryError,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import { registerComponentOverrides, ComponentReplacementHandles, crudFormSectionScope } from '@open-mercato/shared/modules/widgets/component-registry'
import { CrudForm, type CrudField } from '../CrudForm'
import { ComponentOverrideProvider } from '../injection/ComponentOverrideProvider'
import { CrudFormSectionLedgerProvider } from '../injection/crud-form-section-ledger'
import { defineCrudFormSectionRuntime } from '../injection/crud-form-section-runtime'
import { apiCall } from '../utils/apiCall'

const mockSubscribe = jest.fn()
jest.mock('@open-mercato/shared/lib/crud/form-sections/client-registry', () => {
  const original = jest.requireActual('@open-mercato/shared/lib/crud/form-sections/client-registry')
  return {
    ...original,
    subscribeCrudFormSectionClientRegistry(listener: () => void) {
      mockSubscribe()
      const unsubscribe = original.subscribeCrudFormSectionClientRegistry(listener)
      return () => { mockSubscribe('unsubscribed'); unsubscribe() }
    },
  }
})
jest.mock('../utils/apiCall', () => ({ ...jest.requireActual('../utils/apiCall'), apiCall: jest.fn() }))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))
jest.mock('../fields/registry', () => ({ loadGeneratedFieldRegistrations: async () => {} }))

const address = { hostId: 'test.record', formVariant: 'showcase', formOperation: 'update' } as const
const fingerprint = 'a'.repeat(64)
const ledger = { hosts: [address], fingerprint }
const selection = {
  id: 'test.base', ...address, orderedSectionIds: ['name', 'private'], callerIds: [],
  contributionIds: [], ownershipFacts: [], mutationSurfaceIds: [], dependencies: [],
} satisfies CrudFormSectionSurfaceAlternativeFact
const accepted = {
  ...selection, id: 'test.active', orderedSectionIds: ['extra', 'name'],
  contributionIds: ['test.extra', 'test.hide', 'test.replacement'],
} satisfies CrudFormSectionSurfaceAlternativeFact

const field = (id: string, label: string): CrudField => ({ id, label, type: 'text' })
const baseFields = [field('name', 'Base name'), field('private', 'Base private')]
function descriptor(id: string, groupId: string, definition: string | CrudField) {
  return defineCrudFormSectionRuntime<Record<string, unknown>, null, Record<string, unknown>>({
    id, roundTripId: `${id}@v1`, group: { id: groupId, fields: [definition] }, ownedFieldPaths: [typeof definition === 'string' ? definition : definition.id],
    validate: () => ({ success: true, data: null }), projectPayload: () => ({}),
  })
}
const baseDescriptors = [descriptor('test.name', 'name', 'name'), descriptor('test.private', 'private', 'private')]
const hostRuntime = { id: 'test.host', roundTripId: 'test.host@v1', sectionDescriptors: baseDescriptors }
const replacementRuntime = descriptor('test.replacement', 'name', field('replacement', 'Replacement name'))
const response = { state: 'ready', fingerprint, policyToken: 'Abc', activeSectionIds: ['extra', 'name'], acceptedContributionIds: accepted.contributionIds }

function registry(): CrudFormSectionClientRegistry {
  return {
    hostFacts: [{ id: hostRuntime.id, roundTripId: hostRuntime.roundTripId, hostResourceKind: 'test.record', alternatives: [selection, accepted] }],
    contributedOverrides: {
      'test.record/showcase/update/private': { operation: 'hide', contributionId: 'test.hide' },
      'test.record/showcase/update/name': { operation: 'replace', contributionId: 'test.replacement' },
      'test.record/showcase/update/extra': { operation: 'add', contributionId: 'test.extra', placement: { position: InjectionPosition.First } },
    },
    runtimeEntries: [hostRuntime, { id: 'test.hide', roundTripId: 'test.hide@v1' }, replacementRuntime,
      descriptor('test.extra', 'extra', field('extra', 'Extra field')),
    ].map((runtime) => ({
      id: runtime.id, roundTripId: runtime.roundTripId, kind: runtime === hostRuntime ? 'host' : 'contribution', moduleId: 'test',
      load: async () => ({ crudFormSectionRuntime: runtime }),
    })),
  }
}

function form(resourceId: string | undefined = 'actual-id', formVariant = 'showcase') {
  return (
    <CrudForm fields={baseFields} groups={baseDescriptors.map(({ group }) => group)} entityId="test.record"
      initialValues={{ id: 'inferred-id', name: '', private: '' }}
      formVariant={formVariant} formOperation="update" resourceId={resourceId} sectionDescriptors={baseDescriptors} />
  )
}

function configured(resourceId?: string) {
  return <CrudFormSectionLedgerProvider value={ledger}>{form(resourceId)}</CrudFormSectionLedgerProvider>
}

function apiResponse(result: unknown): Awaited<ReturnType<typeof apiCall>> {
  return { ok: true, status: 200, result, response: new Response(), cacheStatus: null }
}

function publishResponse(result: unknown = response) {
  jest.mocked(apiCall).mockResolvedValue(apiResponse(result))
}

function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(() => new QueryClient())
  return <QueryClientProvider client={queryClient}><I18nProvider locale="en" dict={{}}>{children}</I18nProvider></QueryClientProvider>
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, value: TextEncoder })
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto })
})


beforeEach(() => {
  jest.mocked(apiCall).mockReset()
  mockSubscribe.mockClear()
  registerCoreInjectionWidgets([])
  registerCoreInjectionTables([], [])
  registerEnabledModuleIds(['test'])
  setInjectionRegistryError(null)
  registerCrudFormSectionClientRegistry(registry())
})

afterEach(() => registerComponentOverrides([]))

it('uses the legacy form without a resolver subscription when its tuple is absent from the server ledger', async () => {
  await act(async () => {
    render(<CrudFormSectionLedgerProvider value={ledger}>{form('actual-id', 'default')}</CrudFormSectionLedgerProvider>, { wrapper: Providers })
  })
  expect(screen.getByRole('textbox', { name: 'Base name' })).toBeInTheDocument()
  expect(mockSubscribe).not.toHaveBeenCalled()
  expect(apiCall).not.toHaveBeenCalled()
})

it('hydrates a configured form through its loading state and renders only the accepted ordered groups', async () => {
  publishResponse()
  const view = <React.StrictMode>{configured()}</React.StrictMode>
  const container = document.createElement('div')
  document.body.append(container)
  container.innerHTML = renderToString(<Providers>{view}</Providers>)
  expect(container.querySelector('form')).toBeNull()
  const hydrated = render(view, { hydrate: true, container, wrapper: Providers })
  expect(container.querySelector('form')).toBeNull()
  await screen.findByRole('textbox', { name: 'Replacement name' })
  expect(screen.getAllByRole('textbox').map((input) => input.getAttribute('id'))).toEqual([
    expect.stringContaining('extra'), expect.stringContaining('replacement'),
  ])
  expect(screen.queryByRole('textbox', { name: 'Base private' })).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'Base name' })).not.toBeInTheDocument()
  expect(apiCall).toHaveBeenCalledTimes(1)
  const [url, request] = jest.mocked(apiCall).mock.calls[0]
  expect(url).toBe('/api/extensions/crud-form-sections/resolve')
  expect(JSON.parse(String(request?.body))).toMatchObject({
    ...address, hostResourceId: 'actual-id', clientManifestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    clientRoundTripIds: ['test.extra@v1', 'test.hide@v1', 'test.host@v1', 'test.replacement@v1'],
  })
  hydrated.unmount()
  expect(mockSubscribe.mock.calls.filter(([event]) => event === 'unsubscribed'))
    .toHaveLength(mockSubscribe.mock.calls.filter(([event]) => event === undefined).length)
})

it('unmounts a ready form immediately on resource changes and blocks after any stale bootstrap', async () => {
  publishResponse()
  const { rerender, container } = render(configured('first-id'), { wrapper: Providers })
  await screen.findByRole('textbox', { name: 'Replacement name' })
  let complete: (result: Awaited<ReturnType<typeof apiCall>>) => void = () => {}
  jest.mocked(apiCall).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
  rerender(configured('second-id'))
  expect(container.querySelector('form')).toBeNull()
  await waitFor(() => expect(apiCall).toHaveBeenCalledTimes(2))
  const second = jest.mocked(apiCall).mock.calls[1][1]
  act(() => failCrudFormSectionClientRegistry())
  await screen.findByRole('alert')
  expect(second?.signal?.aborted).toBe(true)
  await act(async () => complete(apiResponse(response)))
  expect(container.querySelector('form')).toBeNull()
  expect(screen.getByRole('alert')).toBeInTheDocument()
})

it('fails before network or editing when variant identity is incomplete', () => {
  const { container } = render(
    <CrudFormSectionLedgerProvider value={ledger}>
      <CrudForm fields={baseFields} groups={baseDescriptors.map(({ group }) => group)} entityId="test.record"
        initialValues={{ id: 'inferred-id' }} formVariant="showcase" formOperation="update" />
    </CrudFormSectionLedgerProvider>, { wrapper: Providers },
  )
  expect(screen.getByRole('alert')).toBeInTheDocument()
  expect(container.querySelector('form')).toBeNull()
  expect(apiCall).not.toHaveBeenCalled()
})

it('rejects a response from a different ledger', async () => {
  publishResponse({ ...response, fingerprint: 'b'.repeat(64) })
  const { container } = render(configured(), { wrapper: Providers })
  await screen.findByRole('alert')
  expect(apiCall).toHaveBeenCalledTimes(1)
  expect(container.querySelector('form')).toBeNull()
})

it('fails closed when a loaded descriptor has a stale round-trip revision', async () => {
  const fixture = registry()
  registerCrudFormSectionClientRegistry({
    ...fixture,
    runtimeEntries: fixture.runtimeEntries.map((entry) => entry.id === replacementRuntime.id ? {
      ...entry, load: async () => ({ crudFormSectionRuntime: { ...replacementRuntime, roundTripId: 'test.replacement@v2' } }),
    } : entry),
  })
  const { container } = render(configured(), { wrapper: Providers })
  await screen.findByRole('alert')
  expect(container.querySelector('form')).toBeNull()
  expect(apiCall).not.toHaveBeenCalled()
})

it('blocks an active registered whole-form replacement before mounting it', async () => {
  const replacement = jest.fn(() => <span>Unsafe replacement</span>)
  const { container } = render(
    <ComponentOverrideProvider overrides={[{
      target: { componentId: 'crud-form:test.record' }, priority: 1, replacement, propsSchema: z.unknown(),
    }]}>
      {configured()}
    </ComponentOverrideProvider>, { wrapper: Providers },
  )
  await screen.findByRole('alert')
  expect(container.querySelector('form')).toBeNull()
  expect(replacement).not.toHaveBeenCalled()
  expect(apiCall).not.toHaveBeenCalled()
})

it('fails when an active widget needs a hidden field and accepts the disabled widget lane', async () => {
  const entries = (enabled: boolean) => [{
    moduleId: 'test', key: 'test/widget', widgetId: 'test.widget', source: 'package' as const,
    loader: async () => ({ metadata: { id: 'test.widget', requiredFields: ['private'], enabled }, fields: [] }),
  }]
  registerCoreInjectionWidgets(entries(true))
  registerCoreInjectionTables([{ moduleId: 'test', table: { 'crud-form:test.record:fields': 'test.widget' } }], entries(true))
  publishResponse()
  const { container } = render(configured(), { wrapper: Providers })
  await screen.findByRole('alert')
  expect(container.querySelector('form')).toBeNull()
  expect(apiCall).not.toHaveBeenCalled()
  act(() => registerCoreInjectionWidgets(entries(false)))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await screen.findByRole('textbox', { name: 'Replacement name' })
  expect(apiCall).toHaveBeenCalledTimes(1)
})

it('resolves accepted group content through its scoped replacement handle', async () => {
  publishResponse()
  render(
    <ComponentOverrideProvider overrides={[{
      target: { componentId: ComponentReplacementHandles.section(crudFormSectionScope(address), 'extra') },
      priority: 1, replacement: () => <span>Scoped section</span>, propsSchema: z.unknown(),
    }]}>
      {configured()}
    </ComponentOverrideProvider>, { wrapper: Providers },
  )
  await screen.findByText('Scoped section')
  expect(screen.queryByRole('textbox', { name: 'Extra field' })).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Replacement name' })).toBeInTheDocument()
})
