'use client'

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  compareSectionIds,
  computeCrudFormSectionClientFingerprint,
  type CrudFormSectionConfiguredHostLedger,
} from '@open-mercato/shared/lib/crud/form-sections/composition'
import {
  getCrudFormSectionClientRegistryState, subscribeCrudFormSectionClientRegistry,
  type CrudFormSectionClientRegistry,
} from '@open-mercato/shared/lib/crud/form-sections/client-registry'
import {
  crudFormSectionsResolveMaxBytes, crudFormSectionsResolvePath,
  resolveCrudFormSectionsRequestSchema, resolveCrudFormSectionsResponseSchema,
} from '@open-mercato/shared/lib/crud/form-sections/protocol'
import {
  getInjectionRegistryError, getInjectionRegistryVersion, isInjectionRegistryReady, subscribeToInjectionRegistryChanges,
} from '@open-mercato/shared/modules/widgets/injection-loader'
import { getCurrentOrganizationScopeVersion, subscribeOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { getComponentEntry, getComponentOverrides } from '@open-mercato/shared/modules/widgets/component-registry'
import type { CrudFormSectionSurfaceAlternativeFact } from '@open-mercato/shared/modules/form-section-facts'
import { parseCrudFormSectionClientMutationFacts } from '@open-mercato/shared/lib/crud/form-sections/client-mutation-facts'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { useBackendChromePolicy } from '../BackendChromeProvider'
import { apiCall } from '../utils/apiCall'
import {
  useComponentOverridesReadiness, useOverrideRegistryRevision, useOverrideUserFeatures,
} from './ComponentOverrideProvider'
import type { CrudFormSectionIdentity } from './crud-form-section-identity'
import type { CrudFormSectionRuntime } from './crud-form-section-runtime'
import { loadCrudFormSectionComposition, sameCrudFormSectionIds, selectCrudFormSectionComposition } from './crud-form-section-composition'
import { checkCrudFormSectionDependencies } from './crud-form-section-dependencies'

const logger = createLogger('ui').child({ component: 'crud-form-sections' })
const pending = { state: 'pending', diagnostics: [], policyToken: null } as const
const serverRegistryState = () => pending
const zero = () => 0

export type ResolvedCrudFormSectionPolicy<TValues, TPayload> = {
  state: 'ready'
  diagnostics: readonly string[]
  identity: CrudFormSectionIdentity
  hostResourceKind: string
  surface: CrudFormSectionSurfaceAlternativeFact
  descriptors: readonly CrudFormSectionRuntime<TValues, TPayload>[]
  policyToken: string
  fingerprint: string
}

type FailedPolicy = { state: 'failed'; diagnostics: readonly string[]; policyToken: null }
type Resolution<TValues, TPayload> = ResolvedCrudFormSectionPolicy<TValues, TPayload> | FailedPolicy

function failed(reason: string): FailedPolicy {
  return { state: 'failed', diagnostics: [reason], policyToken: null }
}

type Inputs = {
  ledger: CrudFormSectionConfiguredHostLedger
  identity: CrudFormSectionIdentity
  baseGroupIds: readonly string[]
  authoredDescriptorKeys: readonly string[] | undefined
  hostResourceKind?: string
  primarySpot: string
  legacySpot?: string
  formHandle: string
}

async function resolvePolicy<TValues, TPayload>(
  inputs: Inputs, registry: CrudFormSectionClientRegistry, features: readonly string[] | undefined, signal: AbortSignal,
): Promise<Resolution<TValues, TPayload>> {
  const { identity, baseGroupIds, authoredDescriptorKeys } = inputs
  const selection = selectCrudFormSectionComposition(registry, identity)
  if (!selection || (inputs.hostResourceKind !== undefined && inputs.hostResourceKind !== selection.host.hostResourceKind)) {
    return failed('client_manifest_mismatch')
  }
  const composition = await loadCrudFormSectionComposition<TValues, TPayload>(selection, baseGroupIds, authoredDescriptorKeys)
  if (!composition) return failed('runtime_descriptor_mismatch')
  if (signal.aborted) return failed('cancelled')
  const { surface, overrides } = selection
  const hostResourceKind = selection.host.hostResourceKind
  if (!hostResourceKind) return failed('invalid_host_resource_kind')
  const clientMutationSurfaces = parseCrudFormSectionClientMutationFacts(surface.mutationSurfaceIds, surface.clientMutationSurfaces)
  if (!clientMutationSurfaces || clientMutationSurfaces.some((fact) => fact.hostResourceKind !== hostResourceKind)) {
    return failed('invalid_client_mutation_surface')
  }
  const canonicalSurface = { ...surface, clientMutationSurfaces }
  const { descriptors, identities } = composition
  const spots = inputs.legacySpot && inputs.legacySpot !== inputs.primarySpot ? [inputs.primarySpot, inputs.legacySpot] : [inputs.primarySpot]
  const [validDependencies, clientManifestFingerprint] = await Promise.all([
    checkCrudFormSectionDependencies({ surface, descriptors, spots, grantedFeatures: features }),
    computeCrudFormSectionClientFingerprint(canonicalSurface, identities, overrides),
  ])
  if (!validDependencies) return failed('section_dependency_unavailable')
  if (signal.aborted) return failed('cancelled')

  const request = resolveCrudFormSectionsRequestSchema.safeParse({
    hostId: identity.hostId, formVariant: identity.formVariant, formOperation: identity.formOperation,
    hostResourceKind, hostResourceId: identity.resourceId, clientManifestFingerprint,
    clientRoundTripIds: identities.map(({ roundTripId }) => roundTripId).sort(compareSectionIds),
  })
  if (!request.success) return failed('invalid_client_assertion')
  const body = JSON.stringify(request.data)
  if (new TextEncoder().encode(body).length > crudFormSectionsResolveMaxBytes) return failed('client_assertion_too_large')
  const response = await apiCall<unknown>('/api' + crudFormSectionsResolvePath, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body, signal,
  }, { inheritScopedHeaders: false })
  const result = resolveCrudFormSectionsResponseSchema.safeParse(response.result)
  if (!response.ok || !result.success || result.data.state !== 'ready'
      || result.data.fingerprint !== inputs.ledger.fingerprint
      || !sameCrudFormSectionIds(result.data.activeSectionIds, [...surface.orderedSectionIds].sort(compareSectionIds))
      || !sameCrudFormSectionIds(result.data.acceptedContributionIds, [...surface.contributionIds].sort(compareSectionIds))) {
    return failed('server_manifest_mismatch')
  }
  return { ...result.data, identity, hostResourceKind, surface: canonicalSurface, descriptors, diagnostics: [] }
}

export function useResolvedCrudFormSections<TValues, TPayload>(inputs: Inputs) {
  const registry = useSyncExternalStore(subscribeCrudFormSectionClientRegistry, getCrudFormSectionClientRegistryState, serverRegistryState)
  const widgetVersion = useSyncExternalStore(subscribeToInjectionRegistryChanges, getInjectionRegistryVersion, zero)
  const orgVersion = useSyncExternalStore(subscribeOrganizationScopeChanged, getCurrentOrganizationScopeVersion, zero)
  const overrideRevision = useOverrideRegistryRevision()
  const overrideFeatures = useOverrideUserFeatures()
  const componentReadiness = useComponentOverridesReadiness()
  const { state: chromeState, features } = useBackendChromePolicy()
  const request = useMemo(() => ({
    inputs, registry, features, overrideFeatures,
    widgetError: getInjectionRegistryError(), widgetsReady: isInjectionRegistryReady(),
    componentReadiness, chromeState,
  }), [inputs, registry, widgetVersion, orgVersion, overrideRevision, overrideFeatures, componentReadiness, chromeState, features])
  const [settled, setSettled] = useState<{ request: typeof request; result: Resolution<TValues, TPayload> } | null>(null)

  useEffect(() => {
    const { inputs, registry } = request
    const controller = new AbortController()
    const abort = () => controller.abort()
    const settle = (result: Resolution<TValues, TPayload>) => {
      if (controller.signal.aborted) return
      if (result.state === 'failed') {
        const { hostId, formVariant, formOperation } = inputs.identity
        logger.warn('CrudForm section resolution failed', { hostId, formVariant, formOperation, reason: result.diagnostics[0] })
      }
      setSettled({ request, result })
    }
    if (registry.state === 'failed' || request.widgetError || request.componentReadiness === 'failed' || request.chromeState === 'failed') {
      settle(failed('registry_registration_failed'))
    } else if (registry.state === 'ready' && request.widgetsReady && request.componentReadiness === 'ready' && request.chromeState === 'ready') {
      if (getComponentEntry(inputs.formHandle) || getComponentOverrides(inputs.formHandle, request.overrideFeatures).length) {
        settle(failed('unsupported_form_replacement'))
      } else {
        void resolvePolicy<TValues, TPayload>(inputs, registry.registry, request.features, controller.signal)
          .then(settle, () => settle(failed('section_resolution_failed')))
      }
    }
    return abort
  }, [request])

  return settled?.request === request ? settled.result : pending
}
