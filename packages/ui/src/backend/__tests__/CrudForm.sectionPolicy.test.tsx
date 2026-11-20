import '@testing-library/jest-dom'
import * as React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { webcrypto } from 'node:crypto'
import { deserialize, serialize } from 'node:v8'
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

function publishWritePolicy(customRuntime: Runtime[], ownershipFacts: CrudFormSectionSurfaceAlternativeFact['ownershipFacts']) {
  const fixture = registry()
  registerCrudFormSectionClientRegistry({
    ...fixture,
    hostFacts: fixture.hostFacts.map((fact) => ({ ...fact, alternatives: [selection, { ...accepted, ownershipFacts }] })),
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
  publishResponse()
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
