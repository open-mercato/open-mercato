import '@testing-library/jest-dom'
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { webcrypto } from 'node:crypto'
import { deserialize, serialize } from 'node:v8'
import { TextEncoder } from 'node:util'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { InjectionPosition } from '@open-mercato/shared/modules/widgets/injection-position'
import { z } from 'zod'
import {
  failCrudFormSectionClientRegistry,
  registerCrudFormSectionClientRegistry,
  type CrudFormSectionClientRegistry,
} from '@open-mercato/shared/lib/crud/form-sections/client-registry'
import type { CrudFormSectionClientMutationFact, CrudFormSectionSurfaceAlternativeFact } from '@open-mercato/shared/modules/form-section-facts'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  registerCoreInjectionTables, registerCoreInjectionWidgets, registerEnabledModuleIds, setInjectionRegistryError,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import { registerComponentOverrides, ComponentReplacementHandles, crudFormSectionScope } from '@open-mercato/shared/modules/widgets/component-registry'
import { BackendChromeProvider } from '../BackendChromeProvider'
import { CrudForm, type CrudField, type CrudFormProps } from '../CrudForm'
import { ComponentOverrideProvider } from '../injection/ComponentOverrideProvider'
import { CrudFormSectionLedgerProvider } from '../injection/crud-form-section-ledger'
import { defineCrudFormSectionRuntime, type CrudFormSectionRuntime } from '../injection/crud-form-section-runtime'
import { apiCall } from '../utils/apiCall'
import { fetchCustomFieldDefs, type CustomFieldDefDto } from '../utils/customFieldDefs'
import { fetchCustomFieldFormStructure } from '../utils/customFieldForms'

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
jest.mock('../confirm-dialog', () => ({ useConfirmDialog: () => ({ confirm: async () => true, ConfirmDialogElement: null }) }))
jest.mock('../fields/registry', () => ({
  ...jest.requireActual('../fields/registry'), loadGeneratedFieldRegistrations: async () => {},
}))

jest.mock('../utils/customFieldForms', () => ({
  ...jest.requireActual('../utils/customFieldForms'), fetchCustomFieldFormStructure: jest.fn(),
}))
jest.mock('../utils/customFieldDefs', () => ({ ...jest.requireActual('../utils/customFieldDefs'), fetchCustomFieldDefs: jest.fn() }))

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

type FormProps = Partial<CrudFormProps<Record<string, unknown>>>

function form(resourceId: string | undefined = 'actual-id', formVariant = 'showcase', props?: FormProps) {
  return (
    <CrudForm<Record<string, unknown>> fields={baseFields} groups={baseDescriptors.map(({ group }) => group)} entityId="test.record"
      initialValues={{ id: 'inferred-id', name: '', private: '' }}
      formVariant={formVariant} formOperation="update" resourceId={resourceId} sectionDescriptors={baseDescriptors} {...props} />
  )
}

function configured(resourceId?: string, props?: FormProps) {
  return <CrudFormSectionLedgerProvider value={ledger}>{form(resourceId, 'showcase', props)}</CrudFormSectionLedgerProvider>
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
  Object.defineProperty(globalThis, 'structuredClone', { configurable: true, value: (value: unknown) => deserialize(serialize(value)) })
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto })
})


beforeEach(() => {
  jest.mocked(apiCall).mockReset()
  jest.mocked(fetchCustomFieldFormStructure).mockResolvedValue({ definitions: [], metadata: {} })
  jest.mocked(fetchCustomFieldDefs).mockReset().mockResolvedValue([])
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

it('submits the same unlisted form with and without the configured-host ledger', async () => {
  const sample = async (withLedger: boolean) => {
    const onSubmit = jest.fn()
    const view = form('actual-id', 'default', { onSubmit })
    const { container, unmount } = render(withLedger
      ? <CrudFormSectionLedgerProvider value={ledger}>{view}</CrudFormSectionLedgerProvider> : view, { wrapper: Providers })
    fireEvent.change(screen.getByRole('textbox', { name: 'Base name' }), { target: { value: 'unchanged legacy payload' } })
    fireEvent.submit(container.querySelector('form')!)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    const [submission] = onSubmit.mock.calls
    unmount()
    return submission
  }
  expect(await sample(true)).toEqual(await sample(false))
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

type Runtime = CrudFormSectionRuntime<Record<string, unknown>, Record<string, unknown>>

const parentUpdate: CrudFormSectionClientMutationFact = {
  id: 'test.parent-update', kind: 'parent-submit', requestOperation: 'update',
  guardedFacade: { method: 'PUT', routePattern: '/test/section-policy' },
  hostResourceKind: 'test.record', mutationResourceKind: 'test.record', optimisticLock: 'none',
}

function publishWritePolicy(
  customRuntime: Runtime[], ownershipFacts: CrudFormSectionSurfaceAlternativeFact['ownershipFacts'],
  clientMutationSurfaces: CrudFormSectionClientMutationFact[] = [parentUpdate],
  allowNoopSubmit?: boolean,
) {
  const fixture = registry()
  registerCrudFormSectionClientRegistry({
    ...fixture,
    hostFacts: fixture.hostFacts.map((fact) => ({ ...fact, alternatives: [selection, {
      ...accepted, ownershipFacts, clientMutationSurfaces, allowNoopSubmit, mutationSurfaceIds: clientMutationSurfaces.map(({ id }) => id),
    }] })),
    runtimeEntries: fixture.runtimeEntries.map((entry) => {
      const replacement = customRuntime.find(({ id }) => id === entry.id)
      return replacement ? { ...entry, load: async () => ({ crudFormSectionRuntime: replacement }) } : entry
    }),
  })
  publishResponse()
}

function createWriteDescriptor(
  id: string,
  groupId: string,
  formField: CrudField,
  project: (value: string) => Record<string, unknown>,
  validate = jest.fn(({ sectionValues }: { sectionValues: Readonly<Record<string, unknown>> }) => (
    { success: true as const, data: String(sectionValues[formField.id]).trim() }
  )),
) {
  return defineCrudFormSectionRuntime({
    id, roundTripId: `${id}@v1`,
    group: { id: groupId, fields: [formField] },
    ownedFieldPaths: [formField.id],
    validate,
    projectPayload: project,
  })
}

it('mounts hook-bearing section components independently as groups appear and disappear', async () => {
  function Counter() {
    const [count, setCount] = React.useState(0)
    return <button type="button" onClick={() => setCount((current) => current + 1)}>Count {count}</button>
  }
  const extra = defineCrudFormSectionRuntime({
    id: 'test.extra', roundTripId: 'test.extra@v1', group: { id: 'extra', component: Counter },
    ownedFieldPaths: [],
    validate: () => ({ success: true, data: null }),
    projectPayload: () => ({}),
  })
  publishWritePolicy([extra], [], [])
  const { rerender } = render(configured(), { wrapper: Providers })
  fireEvent.click(await screen.findByRole('button', { name: 'Count 0' }))
  await screen.findByRole('button', { name: 'Count 1' })
  rerender(configured('actual-id', { hiddenGroupIds: ['extra'] }))
  expect(screen.queryByRole('button', { name: 'Count 1' })).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Replacement name' })).toBeInTheDocument()
  rerender(configured())
  await screen.findByRole('button', { name: 'Count 0' })
})

it.each([false, true])('exposes and accepts empty parent submit only when explicitly allowed (%s)', async (allowNoopSubmit) => {
  publishWritePolicy([], [], [parentUpdate], allowNoopSubmit)
  const onSubmit = jest.fn()
  const { container } = render(configured('actual-id', { onSubmit }), { wrapper: Providers })
  await screen.findByRole('textbox', { name: 'Replacement name' })
  expect(container.querySelector('button[type="submit"]') !== null).toBe(allowNoopSubmit)
  await act(async () => { fireEvent.submit(container.querySelector('form')!) })
  if (allowNoopSubmit) await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ sectionPayload: {} })))
  else expect(onSubmit).not.toHaveBeenCalled()
})

it('submits only active values and an independent deep-merged section payload', async () => {
  const name = createWriteDescriptor('test.replacement', 'name', field('replacement', 'Replacement name'),
    (value) => ({ details: { name: value.toUpperCase() } }))
  const quantity = defineCrudFormSectionRuntime({
    id: 'test.extra', roundTripId: 'test.extra@v1', group: { id: 'extra', fields: [field('extra', 'Quantity')] },
    ownedFieldPaths: ['extra'],
    validate: ({ sectionValues }) => ({ success: true, data: Number(sectionValues.extra) }),
    projectPayload: (count) => ({ details: { count } }),
  })
  publishWritePolicy([name, quantity], [
    { sectionId: 'name', payloadPaths: ['details.name'], customFieldOwnership: { mode: 'none' } },
    { sectionId: 'extra', payloadPaths: ['details.count'], customFieldOwnership: { mode: 'none' } },
  ])
  const onSubmit = jest.fn()
  const { container } = render(configured('actual-id', {
    schema: z.object({ private: z.literal('unreachable legacy required value') }),
    initialValues: { id: 'not-policy-id', private: 'stored', replacement: ' alice ', extra: '2' },
    onSubmit,
    compositionValidator({ activeSectionIds, parsedSections, fullValues, payload }) {
      expect([...activeSectionIds]).toEqual(['extra', 'name'])
      expect([...parsedSections]).toEqual([['extra', 2], ['name', 'alice']])
      expect(fullValues.private).toBe('stored')
      expect(payload).toEqual({ details: { count: 2, name: 'ALICE' } })
      return { success: true, data: { details: { count: 2, name: 'ALICE!' } } }
    },
  }), { wrapper: Providers })
  await screen.findByRole('textbox', { name: 'Replacement name' })
  fireEvent.submit(container.querySelector('form')!)
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(
    { extra: '2', replacement: ' alice ' }, expect.objectContaining({ sectionPayload: { details: { count: 2, name: 'ALICE!' } } }),
  ))
  expect(name.validate).toHaveBeenCalledWith(expect.objectContaining({ sectionValues: { replacement: ' alice ' } }))
  expect(fetchCustomFieldDefs).not.toHaveBeenCalled()
})

it.each([
  { fragment: { details: null }, path: 'details' },
  { fragment: { details: { count: 4 } }, path: 'details.count' },
  { fragment: { hiddenWrite: true }, path: 'other' },
  { fragment: { details: Object.fromEntries([['constructor', 4]]) }, path: 'details.constructor' },
])('blocks invalid or colliding payloads before calling the host callback', async ({ fragment, path }) => {
  const name = createWriteDescriptor('test.replacement', 'name', field('replacement', 'Replacement name'), () => fragment)
  const quantity = createWriteDescriptor('test.extra', 'extra', field('extra', 'Quantity'), () => ({ details: { count: 2 } }))
  publishWritePolicy([name, quantity], [
    { sectionId: 'name', payloadPaths: [path], customFieldOwnership: { mode: 'none' } },
    { sectionId: 'extra', payloadPaths: ['details.count'], customFieldOwnership: { mode: 'none' } },
  ])
  const onSubmit = jest.fn()
  const { container } = render(configured('actual-id', { onSubmit }), { wrapper: Providers })
  await screen.findByRole('textbox', { name: 'Replacement name' })
  fireEvent.submit(container.querySelector('form')!)
  await screen.findByText('ui.forms.flash.saveError')
  expect(onSubmit).not.toHaveBeenCalled()
})

const requiredDefinition = (key: string): CustomFieldDefDto => ({
  key, entityId: 'test.record', label: key, kind: 'text',
  validation: [{ rule: 'required', message: `test.required.${key}` }],
})

it('validates only accepted custom-field definitions before producing the policy payload', async () => {
  const customRuntime = defineCrudFormSectionRuntime({
    id: 'test.replacement', roundTripId: 'test.replacement@v1',
    group: { id: 'name', kind: 'customFields' }, ownedFieldPaths: [],
    ownedCustomFieldIds: ['published'], customFieldDefinitionSetId: 'test.allowed',
    validate: ({ sectionValues }) => ({ success: true, data: String(sectionValues.cf_published) }),
    projectPayload: (published) => ({ customFields: { published } }),
  })
  publishWritePolicy([customRuntime], [
    { sectionId: 'name', payloadPaths: [], customFieldOwnership: { mode: 'ids', ids: ['published'], definitionSetId: 'test.allowed' } },
  ])
  jest.mocked(fetchCustomFieldFormStructure).mockResolvedValue({
    definitions: [requiredDefinition('published'), requiredDefinition('private')], metadata: {},
  })
  const onSubmit = jest.fn()
  const { container } = render(configured('actual-id', {
    onSubmit, sectionCustomFieldDefinitionSets: { 'test.allowed': ['test.record'] },
  }), { wrapper: Providers })
  const published = await screen.findByRole('textbox', { name: /published/ })
  expect(screen.queryByRole('textbox', { name: /private/ })).not.toBeInTheDocument()
  fireEvent.submit(container.querySelector('form')!)
  await screen.findByText('test.required.published')
  expect(onSubmit).not.toHaveBeenCalled()
  fireEvent.change(published, { target: { value: 'Selected' } })
  fireEvent.submit(container.querySelector('form')!)
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ cf_published: 'Selected' }),
    expect.objectContaining({ sectionPayload: { customFields: { published: 'Selected' } } }),
  ))
  expect(fetchCustomFieldDefs).not.toHaveBeenCalled()
})

it('keeps the legacy custom-field gate independent of configured section ownership', async () => {
  jest.mocked(fetchCustomFieldFormStructure).mockResolvedValue({ definitions: [], metadata: {} })
  jest.mocked(fetchCustomFieldDefs).mockResolvedValue([requiredDefinition('private')])
  const onSubmit = jest.fn()
  const { container } = render(form('legacy-id', 'default', { onSubmit }), { wrapper: Providers })
  fireEvent.submit(container.querySelector('form')!)
  await waitFor(() => expect(fetchCustomFieldDefs).toHaveBeenCalledWith(['test.record']))
  expect(onSubmit).not.toHaveBeenCalled()
})

it('blocks composition from adding a path that bypassed section validation', async () => {
  const name = createWriteDescriptor('test.replacement', 'name', field('replacement', 'Replacement name'), () => ({ name: 'valid' }))
  publishWritePolicy([name], [
    { sectionId: 'name', payloadPaths: ['name', 'unvalidated'], customFieldOwnership: { mode: 'none' } },
  ])
  const onSubmit = jest.fn()
  const { container } = render(configured('actual-id', {
    onSubmit, compositionValidator: ({ payload }) => ({ success: true, data: { ...payload, unvalidated: true } }),
  }), { wrapper: Providers })
  await screen.findByRole('textbox', { name: 'Replacement name' })
  fireEvent.submit(container.querySelector('form')!)
  await screen.findByText('ui.forms.flash.saveError')
  expect(onSubmit).not.toHaveBeenCalled()
})

it('keeps active field errors and does not render a hidden composition error', async () => {
  const onSubmit = jest.fn()
  publishWritePolicy([], [], [parentUpdate], true)
  const { container } = render(configured('actual-id', {
    onSubmit,
    compositionValidator: () => ({ success: false, fieldErrors: { replacement: 'test.active', private: 'test.hidden' } }),
  }), { wrapper: Providers })
  await screen.findByRole('textbox', { name: 'Replacement name' })
  fireEvent.submit(container.querySelector('form')!)
  await screen.findByText('test.active')
  expect(screen.queryByText('test.hidden')).not.toBeInTheDocument()
  expect(onSubmit).not.toHaveBeenCalled()
})

it.each([
  ['mutation_guard_rejected', { details: { fieldErrors: { replacement: 'test.active' } } }],
  ['validation_failed', { fieldErrors: { replacement: 'test.active' } }],
])('summarizes a configured %s rejection beside its field error', async (code, body) => {
  publishWritePolicy([], [], [parentUpdate], true)
  const onSubmit = jest.fn().mockRejectedValue({ error: code, code, ...body })
  const { container } = render(configured('actual-id', { onSubmit }), { wrapper: Providers })

  await screen.findByRole('textbox', { name: 'Replacement name' })
  fireEvent.submit(container.querySelector('form')!)

  expect(await screen.findByText('test.active')).toBeInTheDocument()
  expect(screen.getByText('ui.forms.errors.highlighted')).toBeInTheDocument()
  expect(screen.queryByText(code)).not.toBeInTheDocument()
})

it('explains when a configured external delivery is unavailable', async () => {
  publishWritePolicy([], [], [parentUpdate], true)
  const code = 'crud_form_section_external_unavailable'
  const onSubmit = jest.fn().mockRejectedValue({ status: 503, error: code, code })
  const { container } = render(configured('actual-id', { onSubmit }), { wrapper: Providers })

  await screen.findByRole('textbox', { name: 'Replacement name' })
  fireEvent.submit(container.querySelector('form')!)

  expect(await screen.findByText('External delivery is unavailable. Try again later.')).toBeInTheDocument()
  expect(screen.queryByText(code)).not.toBeInTheDocument()
})

it('does not mount controls for a configured all custom-field definition set without a scoped binding', async () => {
  const customRuntime = defineCrudFormSectionRuntime({
    id: 'test.replacement', roundTripId: 'test.replacement@v1',
    group: { id: 'name', kind: 'customFields' }, ownedFieldPaths: [],
    ownedCustomFieldIds: 'all', customFieldDefinitionSetId: 'test.allowed',
    validate: () => ({ success: true, data: null }), projectPayload: () => ({}),
  })
  publishWritePolicy([customRuntime], [
    { sectionId: 'name', payloadPaths: [], customFieldOwnership: { mode: 'all', definitionSetId: 'test.allowed' } },
  ])
  jest.mocked(fetchCustomFieldFormStructure).mockResolvedValue({ definitions: [requiredDefinition('published')], metadata: {} })
  const { container } = render(configured(), { wrapper: Providers })
  await screen.findByRole('alert')
  expect(container.querySelector('form')).toBeNull()
  expect(fetchCustomFieldDefs).not.toHaveBeenCalled()
})

it('does not run parent controls or programmatic form submission for display-only policies', async () => {
  publishResponse()
  const onSubmit = jest.fn()
  const onDelete = jest.fn()
  const { container } = render(configured('actual-id', { onSubmit, onDelete, deleteVisible: true }), { wrapper: Providers })
  await screen.findByRole('textbox', { name: 'Replacement name' })
  expect(container.querySelector('button[type="submit"]')).toBeNull()
  expect(screen.queryByRole('button', { name: 'ui.forms.actions.delete' })).not.toBeInTheDocument()
  fireEvent.submit(container.querySelector('form')!)
  expect(onSubmit).not.toHaveBeenCalled()
  expect(onDelete).not.toHaveBeenCalled()
})

it('binds parent delete after its own hook with explicit version and domain headers', async () => {
  const deleteSurface: CrudFormSectionClientMutationFact = {
    ...parentUpdate, id: 'test.parent-delete', kind: 'parent-delete', requestOperation: 'delete',
    guardedFacade: { ...parentUpdate.guardedFacade, method: 'DELETE' }, optimisticLock: 'target-required',
  }
  publishWritePolicy([], [], [deleteSurface])
  const originalFetch = globalThis.fetch
  const fetch = jest.fn(async () => new Response('{}', { status: 200 }))
  globalThis.fetch = fetch
  const hookVersion = '2026-11-20T01:35:02.000Z'
  const onBeforeDelete = jest.fn(async () => ({
    ok: true, requestHeaders: { 'x-sudo-token': 'delete-only', [OPTIMISTIC_LOCK_HEADER_NAME]: hookVersion },
  }))
  const onLoad = jest.fn()
  const widgets = [{
    moduleId: 'test', key: 'test.delete', widgetId: 'test.delete', source: 'package' as const,
    loader: async () => ({
      metadata: { id: 'test.delete' }, fields: [{ id: 'deleteHint', label: 'Delete hint', type: 'text', group: 'name' }],
      eventHandlers: { onBeforeDelete, onLoad },
    }),
  }]
  registerCoreInjectionWidgets(widgets)
  registerCoreInjectionTables([{ moduleId: 'test', table: { 'crud-form:test.record:fields': 'test.delete' } }], widgets)
  try {
    const onDelete: NonNullable<FormProps['onDelete']> = async (context) => {
      await context?.mutation.request('/api/test/section-policy?id=actual-id')
    }
    render(configured('actual-id', { onDelete, deleteVisible: true, optimisticLockUpdatedAt: '2026-11-20T01:30:00.000Z' }), { wrapper: Providers })
    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1))
    const remove = screen.getAllByRole('button', { name: 'ui.forms.actions.delete' })[0]
    fireEvent.click(remove)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(onBeforeDelete).toHaveBeenCalledTimes(1)
    const [, init] = (fetch.mock.calls as unknown as [string, RequestInit][])[0]
    expect(init.method).toBe('DELETE')
    const headers = new Headers(init.headers)
    expect(headers.get('x-sudo-token')).toBe('delete-only')
    expect(headers.get(OPTIMISTIC_LOCK_HEADER_NAME)).toBe(hookVersion)
  } finally { globalThis.fetch = originalFetch }
})

it('exposes a section action to a rendered group without enabling parent controls', async () => {
  const action: CrudFormSectionClientMutationFact = {
    ...parentUpdate, id: 'test.retry', kind: 'section-action', requestOperation: 'retry',
    guardedFacade: { method: 'POST', routePattern: '/test/[id]/retry' },
  }
  const custom = defineCrudFormSectionRuntime({
    id: 'test.extra', roundTripId: 'test.extra@v1', ownedFieldPaths: [],
    group: {
      id: 'extra', bare: true,
      component: ({ runSectionMutation }) => <button type="button" onClick={() => {
        void runSectionMutation?.({
          mutationSurfaceId: action.id, requestOperation: 'retry', operation: 'update',
          mutationResourceKind: 'test.record', mutationResourceId: 'actual-id',
        }, '/api/test/actual-id/retry')
      }}>Retry section</button>,
    },
    validate: () => ({ success: true, data: null }), projectPayload: () => ({}),
  })
  publishWritePolicy([custom], [], [action])
  const originalFetch = globalThis.fetch
  const fetch = jest.fn(async (_input: string, _init: RequestInit) => new Response('{}', { status: 200 }))
  globalThis.fetch = fetch
  try {
    const { container } = render(configured(), { wrapper: Providers })
    fireEvent.click(await screen.findByRole('button', { name: 'Retry section' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(container.querySelector('button[type="submit"]')).toBeNull()
    const [, init] = fetch.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('x-om-ext-crud-form-sections-mutation-surface')).toBe(action.id)
  } finally { globalThis.fetch = originalFetch }
})

function chromePayload(grantedFeatures: string[]) {
  return {
    groups: [], settingsSections: [], settingsPathPrefixes: [], profileSections: [], profilePathPrefixes: [],
    grantedFeatures, roles: [], currentOrganization: null,
  }
}

it('keeps user edits and request count when focus refresh returns the same grant set', async () => {
  let chromeRequests = 0
  let policyRequests = 0
  jest.mocked(apiCall).mockImplementation(async (url) => {
    if (String(url) === '/api/nav?test=focus-preservation') {
      return apiResponse(chromePayload(chromeRequests++ ? ['feature.b', 'feature.a', 'feature.b'] : ['feature.a', 'feature.b']))
    }
    policyRequests++
    return apiResponse(response)
  })
  render(<BackendChromeProvider adminNavApi="/api/nav?test=focus-preservation">{configured()}</BackendChromeProvider>,
    { wrapper: Providers })
  const input = await screen.findByRole('textbox', { name: 'Replacement name' })
  fireEvent.change(input, { target: { value: 'draft' } })
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(chromeRequests).toBe(2)
  expect(policyRequests).toBe(1)
  expect(screen.getByRole('textbox', { name: 'Replacement name' })).toBe(input)
  expect(input).toHaveValue('draft')
})

it.each([false, true])('waits for current registry grants on a scope change, failed chrome=%s', async (chromeFailed) => {
  let navCalls = 0
  let featureCalls = 0
  let policyCalls = 0
  let settleNav: (result: Awaited<ReturnType<typeof apiCall>>) => void = () => {}
  let settleFeatures: (result: Awaited<ReturnType<typeof apiCall>>) => void = () => {}
  const nav = `/api/nav?test=scope-change-${chromeFailed}`
  jest.mocked(apiCall).mockImplementation(async (url) => {
    if (String(url) === nav) {
      return navCalls++ ? new Promise((resolve) => { settleNav = resolve }) : apiResponse(chromePayload([]))
    }
    if (String(url) === '/api/auth/feature-check') {
      return featureCalls++ ? new Promise((resolve) => { settleFeatures = resolve }) : apiResponse({ granted: [] })
    }
    policyCalls++
    return apiResponse(response)
  })
  const component = jest.fn(() => <div>Unavailable replacement</div>)
  const { container } = render(
    <BackendChromeProvider adminNavApi={nav}>
      <ComponentOverrideProvider overrides={[{
        target: { componentId: 'crud-form:test.record' }, priority: 1, features: ['scope.b'],
        replacement: component, propsSchema: z.unknown(),
      }]}>
        {configured()}
      </ComponentOverrideProvider>
    </BackendChromeProvider>,
    { wrapper: Providers },
  )
  await screen.findByRole('textbox', { name: 'Replacement name' })
  expect(policyCalls).toBe(1)
  act(() => emitOrganizationScopeChanged({ organizationId: `scope-b-${chromeFailed}`, tenantId: 'same-tenant' }))
  expect(container.querySelector('form')).toBeNull()
  await waitFor(() => expect([navCalls, featureCalls]).toEqual([2, 2]))
  await act(async () => settleNav(chromeFailed ? { ...apiResponse(null), ok: false, status: 503 } : apiResponse(chromePayload(['scope.b']))))
  expect(container.querySelector('form')).toBeNull()
  await act(async () => settleFeatures(apiResponse({ granted: ['scope.b'] })))
  await screen.findByRole('alert')
  expect(container.querySelector('form')).toBeNull()
  expect(component).not.toHaveBeenCalled()
  expect(policyCalls).toBe(1)
})

it.each(['crud-form:test.record', 'crud-form:test.legacy'])('fails closed for a broken registered header at %s', async (spot) => {
  const entries = [{
    moduleId: 'test', key: 'test/broken-header', widgetId: 'test.broken-header', source: 'package' as const,
    loader: async () => { throw new Error('Fixture import rejected') },
  }]
  registerCoreInjectionWidgets(entries)
  registerCoreInjectionTables([{ moduleId: 'test', table: { [`${spot}:header`]: 'test.broken-header' } }], entries)
  publishResponse()
  const { container } = render(configured('actual-id', { legacyInjectionSpotId: 'crud-form:test.legacy' }), { wrapper: Providers })
  await screen.findByRole('alert')
  expect(container.querySelector('form')).toBeNull()
  expect(apiCall).not.toHaveBeenCalled()
})
