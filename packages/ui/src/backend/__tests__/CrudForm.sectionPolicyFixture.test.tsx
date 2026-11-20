import '@testing-library/jest-dom'
import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { webcrypto } from 'node:crypto'
import { TextDecoder, TextEncoder } from 'node:util'
import { deserialize, serialize } from 'node:v8'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { buildCrudFormSectionManifest } from '@open-mercato/shared/lib/crud/form-sections/manifest'
import { crudFormSectionHostKey } from '@open-mercato/shared/lib/crud/form-sections/composition'
import { getCrudFormSectionClientRegistryState, registerCrudFormSectionClientRegistry } from '@open-mercato/shared/lib/crud/form-sections/client-registry'
import { encodeCurrentCrudFormSectionPolicyToken } from '@open-mercato/shared/lib/crud/form-sections/policy-token'
import { resolveCrudFormSectionsRequestSchema } from '@open-mercato/shared/lib/crud/form-sections/protocol'
import { projectCrudFormSectionClientMutationFact } from '@open-mercato/shared/lib/crud/form-sections/client-mutation-facts'
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { applyFormSectionOverrides, applyModuleOverridesFromEnabledModules, resetModuleContractOverridesForTests } from '@open-mercato/shared/modules/overrides'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import {
  registerCoreInjectionTables, registerCoreInjectionWidgets, registerEnabledModuleIds, setInjectionRegistryError,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import { crudFormSections } from '../../../../../.ai/qa/fixtures/crudform-section-policy/src/modules/form_policy_fixture/form-sections'
import { guards } from '../../../../../.ai/qa/fixtures/crudform-section-policy/src/modules/form_policy_fixture/data/guards'
import { FixtureForm } from '../../../../../.ai/qa/fixtures/crudform-section-policy/src/modules/form_policy_fixture/runtime/FixtureForm.client'
import dict from '../../../../../.ai/qa/fixtures/crudform-section-policy/src/modules/form_policy_fixture/i18n/en.json'
import { selectCrudFormSectionComposition } from '../injection/crud-form-section-composition'
import { CrudFormSectionLedgerProvider } from '../injection/crud-form-section-ledger'
import { apiCall } from '../utils/apiCall'
import { fetchCustomFieldFormStructure } from '../utils/customFieldForms'

jest.mock('../utils/apiCall', () => ({ ...jest.requireActual('../utils/apiCall'), apiCall: jest.fn() }))
jest.mock('@open-mercato/shared/lib/url-safety', () => ({
  safeOutboundFetch: () => { throw new Error('[internal] Fixture must not call an external provider') },
}))
jest.mock('@open-mercato/shared/lib/db/mikro', () => ({
  getOrmEntities: () => { throw new Error('[internal] Fixture has no ORM entities') },
}))
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))
jest.mock('../confirm-dialog', () => ({ useConfirmDialog: () => ({ confirm: async () => true, ConfirmDialogElement: null }) }))
jest.mock('../fields/registry', () => ({ ...jest.requireActual('../fields/registry'), loadGeneratedFieldRegistrations: async () => {} }))
jest.mock('../utils/customFieldForms', () => ({
  ...jest.requireActual('../utils/customFieldForms'), fetchCustomFieldFormStructure: jest.fn(),
}))

const moduleId = 'form_policy_fixture'
const entityId = 'form_policy_fixture:record'

function response(result: unknown): Awaited<ReturnType<typeof apiCall>> {
  return { ok: true, status: 200, result, response: new Response(), cacheStatus: null }
}

function prepareFixture(additionalFeatures: readonly string[] = []) {
  registerMutationGuards([{ moduleId, guards }])
  const manifest = buildCrudFormSectionManifest([{ moduleId, sections: {
    ...crudFormSections,
    hostProviders: crudFormSections.hostProviders.map((provider) => ({
      ...provider, requireFeatures: [...provider.requireFeatures, ...additionalFeatures],
    })),
  } }])
  registerCrudFormSectionClientRegistry({
    hostFacts: crudFormSections.hostFacts.map(({ id, roundTripId, hostResourceKind, alternatives }) => ({
      id, roundTripId, hostResourceKind,
      alternatives: alternatives.map(({ surface, mutationSurfaces }) => ({
        ...surface,
        ...(mutationSurfaces ? { clientMutationSurfaces: mutationSurfaces.map(projectCrudFormSectionClientMutationFact) } : {}),
      })),
    })),
    contributedOverrides: crudFormSections.contributedOverrides,
    runtimeEntries: crudFormSections.runtimes.map((entry) => ({
      ...entry, moduleId, kind: entry.id === 'form_policy_fixture.record-host' ? 'host' : 'contribution',
    })),
  })
  jest.mocked(apiCall).mockImplementation(async (url, request) => {
    expect(url).toBe('/api/extensions/crud-form-sections/resolve')
    const assertion = resolveCrudFormSectionsRequestSchema.parse(JSON.parse(String(request?.body)))
    const policy = manifest.policies.get(crudFormSectionHostKey(assertion))
    if (!policy) return response({ state: 'failed', code: 'crud_form_section_policy_invalid' })
    expect(assertion.clientManifestFingerprint).toBe(policy.clientFingerprint)
    expect(assertion.clientRoundTripIds).toEqual(policy.roundTripIds)
    const { hostId, formVariant, formOperation, hostResourceKind, hostResourceId } = assertion
    const policyToken = encodeCurrentCrudFormSectionPolicyToken({
      address: { hostId, formVariant, formOperation }, host: { hostResourceKind, hostResourceId },
      policy, fingerprint: manifest.ledger.fingerprint,
    })
    expect(policyToken).not.toBeNull()
    return response({
      state: 'ready',
      fingerprint: manifest.ledger.fingerprint,
      policyToken,
      activeSectionIds: [...policy.surface.orderedSectionIds].sort(),
      acceptedContributionIds: policy.surface.contributionIds,
    })
  })
  return manifest
}

function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(() => new QueryClient())
  return <QueryClientProvider client={queryClient}><I18nProvider locale="en" dict={dict}>{children}</I18nProvider></QueryClientProvider>
}

beforeAll(() => {
  Object.defineProperties(globalThis, {
    TextEncoder: { configurable: true, value: TextEncoder },
    TextDecoder: { configurable: true, value: TextDecoder },
    structuredClone: { configurable: true, value: (value: unknown) => deserialize(serialize(value)) },
  })
  Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: webcrypto.subtle })
})

beforeEach(() => {
  jest.mocked(apiCall).mockReset()
  jest.mocked(fetchCustomFieldFormStructure).mockResolvedValue({
    definitions: [{ key: 'region', kind: 'text', formEditable: true, entityId }],
    metadata: {},
  })
  registerCoreInjectionWidgets([])
  registerCoreInjectionTables([], [])
  registerEnabledModuleIds([moduleId])
  setInjectionRegistryError(null)
})

afterEach(() => {
  registerMutationGuards([])
  resetModuleContractOverridesForTests()
})

it('selects the same finite alternative on both sides after modules.ts and programmatic dispatch', () => {
  const identity = {
    hostId: 'form_policy_fixture.record', formVariant: 'showcase', formOperation: 'update', resourceId: 'fixture-record',
  } as const
  const display = 'form_policy_fixture.record/showcase/update/display'
  const key = crudFormSectionHostKey(identity)
  const entries = [{ id: moduleId, overrides: { forms: { sections: { [display]: null } } } }]

  applyModuleOverridesFromEnabledModules(entries)
  const rejected = prepareFixture()
  resetModuleContractOverridesForTests()
  applyModuleOverridesFromEnabledModules(entries, { domains: ['forms'] })
  const registry = getCrudFormSectionClientRegistryState()
  expect(registry.state).toBe('ready')
  if (registry.state !== 'ready') throw new Error('[internal] Expected fixture registry')
  expect(rejected.ledger.hosts).toContainEqual(expect.objectContaining({ hostId: identity.hostId }))
  expect(rejected.policies.has(key)).toBe(false)
  expect(selectCrudFormSectionComposition(registry.registry, identity)).toBeNull()

  resetModuleContractOverridesForTests()
  const programmatic = { [display]: crudFormSections.contributedOverrides[display]! }
  applyModuleOverridesFromEnabledModules(entries)
  applyFormSectionOverrides(programmatic)
  const accepted = prepareFixture()
  resetModuleContractOverridesForTests()
  applyModuleOverridesFromEnabledModules(entries, { domains: ['forms'] })
  applyFormSectionOverrides(programmatic)
  const selection = selectCrudFormSectionComposition(registry.registry, identity)
  expect(selection?.surface.id).toBeDefined()
  expect(selection?.surface.id).toBe(accepted.policies.get(key)?.surface.id)
})

it('renders the fixture’s accepted add, hide and replace and projects a normalized submission', async () => {
  const manifest = prepareFixture()
  const onSubmit = jest.fn()
  const { container } = render(
    <CrudFormSectionLedgerProvider value={manifest.ledger}>
      <FixtureForm scenario="showcase" onSubmit={onSubmit} />
    </CrudFormSectionLedgerProvider>, { wrapper: Providers },
  )
  await screen.findByText('Section policy display fixture')
  const replacement = await screen.findByRole('textbox', { name: 'Replacement name' })
  expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'Private code' })).not.toBeInTheDocument()
  fireEvent.change(replacement, { target: { value: '  replacement  ' } })
  fireEvent.submit(container.querySelector('form')!)
  await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ displayName: expect.any(String), cf_region: 'north' }),
    expect.objectContaining({ sectionPayload: { name: 'replacement', customFields: { region: 'north' } } }),
  ))
})

it('renders C3 pending and then blocked from the real manifest without exposing a mutation-capable form', async () => {
  const manifest = prepareFixture()
  const onSubmit = jest.fn()
  const view = (
    <CrudFormSectionLedgerProvider value={manifest.ledger}>
      <FixtureForm scenario="c3" onSubmit={onSubmit} />
    </CrudFormSectionLedgerProvider>
  )
  expect(renderToString(<Providers>{view}</Providers>)).not.toContain('<form')
  const { container } = render(view, { wrapper: Providers })
  await screen.findByRole('alert')
  expect(container.querySelector('form')).toBeNull()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(onSubmit).not.toHaveBeenCalled()
})

it('blocks hydration when the resolved policy requires different features than the server-rendered ledger', async () => {
  const rendered = prepareFixture()
  const resolved = prepareFixture(['form_policy_fixture.restricted'])
  expect(resolved.ledger.fingerprint).not.toBe(rendered.ledger.fingerprint)
  const onSubmit = jest.fn()
  const { container } = render(
    <CrudFormSectionLedgerProvider value={rendered.ledger}>
      <FixtureForm scenario="showcase" onSubmit={onSubmit} />
    </CrudFormSectionLedgerProvider>, { wrapper: Providers },
  )
  await screen.findByRole('alert')
  expect(apiCall).toHaveBeenCalled()
  expect(container.querySelector('form')).toBeNull()
  expect(onSubmit).not.toHaveBeenCalled()
})
