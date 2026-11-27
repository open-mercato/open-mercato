'use client'

import { useCallback, useMemo } from 'react'
import { z } from 'zod'
import { parseCrudFormSectionClientMutationFacts } from '@open-mercato/shared/lib/crud/form-sections/client-mutation-facts'
import { hasCrudFormSectionWritableLeaves } from '@open-mercato/shared/lib/crud/form-sections/composition'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { buildCrudFormSectionPolicyHeaders, crudFormSectionPolicyHeaderNames } from '@open-mercato/shared/lib/crud/form-sections/policy-headers'
import { resourceIdSchema } from '@open-mercato/shared/lib/crud/form-sections/protocol'
import type { CrudFormSectionClientMutationFact } from '@open-mercato/shared/modules/form-section-facts'
import { matchRoutePattern } from '@open-mercato/shared/modules/registry'
import type { ResolvedCrudFormSectionPolicy } from '../injection/useResolvedCrudFormSections'
import { useGuardedMutation } from '../injection/useGuardedMutation'
import { apiCallOrThrow, type ApiCallOrThrowOptions, type ApiCallResult } from './apiCall'

type Operation = 'create' | 'update' | 'delete'
type CallOptions<Result> = Omit<ApiCallOrThrowOptions<Result>, 'inheritScopedHeaders'>

export type CrudFormMutationBinding = {
  mutationSurfaceId: string
  requestOperation: string
  mutationResourceKind: string
  mutationResourceId?: string
  expectedUpdatedAt?: string
}

export type CrudFormBoundMutation = Readonly<{
  request<Result = Record<string, unknown>>(
    endpoint: string, init?: RequestInit, options?: CallOptions<Result>,
  ): Promise<ApiCallResult<Result>>
  write<Result = Record<string, unknown>>(
    endpoint: string, body?: unknown, init?: Omit<RequestInit, 'body'>, options?: CallOptions<Result>,
  ): Promise<ApiCallResult<Result>>
}>

export type RunCrudFormSectionMutation = <Result = Record<string, unknown>>(
  binding: CrudFormMutationBinding & { operation: Operation },
  endpoint: string,
  init?: RequestInit,
  options?: CallOptions<Result> & { mutationPayload?: Record<string, unknown> },
) => Promise<ApiCallResult<Result>>

const protectedHeaders = new Set<string>(Object.values(crudFormSectionPolicyHeaderNames))
const versionSchema = z.iso.datetime({ offset: true })
const routeOrigin = 'https://open-mercato.invalid'

function invalid(): never {
  throw new Error('[internal] Invalid bound CrudForm section mutation')
}

function versionToken(value: string | null | undefined): string | undefined {
  if (value == null) return undefined
  const parsed = versionSchema.safeParse(value)
  if (!parsed.success) return invalid()
  const date = new Date(parsed.data)
  return Number.isFinite(date.getTime()) ? date.toISOString() : invalid()
}

function checkEndpoint(endpoint: string, routePattern: string, targetResourceId?: string): void {
  if (!endpoint.startsWith('/api/') || /[\\#\s]/u.test(endpoint)) return invalid()
  const url = new URL(endpoint, routeOrigin)
  if (url.origin !== routeOrigin || url.pathname !== endpoint.split('?')[0]
      || /%(?:2f|5c)/i.test(url.pathname) || url.pathname.replace(/\/+$/, '').includes('//')
      || !matchRoutePattern(routePattern, url.pathname.slice(4))) return invalid()
  const queryIds = url.searchParams.getAll('id')
  if (queryIds.length && (queryIds.length !== 1 || queryIds[0] !== targetResourceId)) return invalid()
}

export function createCrudFormSectionMutationClient(
  policy: Pick<ResolvedCrudFormSectionPolicy<unknown, unknown>, 'identity' | 'hostResourceKind' | 'surface' | 'policyToken' | 'fingerprint'>,
  parentUpdatedAt?: string | null,
) {
  const { policyToken, fingerprint, hostResourceKind } = policy
  const { resourceId: hostResourceId, formOperation } = policy.identity
  const routeFacts = parseCrudFormSectionClientMutationFacts(policy.surface.mutationSurfaceIds, policy.surface.clientMutationSurfaces)
  if (!routeFacts) return invalid()
  const surfaces = new Map(routeFacts.map((fact) => [fact.id, fact] as const))

  function bind(
    surface: CrudFormSectionClientMutationFact,
    binding: CrudFormMutationBinding,
    operation: Operation,
    domainHeaders?: HeadersInit,
  ): CrudFormBoundMutation {
    const { mutationResourceId, expectedUpdatedAt } = binding
    const { kind, guardedFacade } = surface
    if (!['create', 'update', 'delete'].includes(operation)
        || surface.hostResourceKind !== hostResourceKind || surface.requestOperation !== binding.requestOperation
        || surface.mutationResourceKind !== binding.mutationResourceKind
        || (['create', 'update', 'delete'].includes(surface.requestOperation) && surface.requestOperation !== operation)
        || (operation === 'create' ? mutationResourceId !== undefined : !resourceIdSchema.safeParse(mutationResourceId).success)
        || (kind !== 'section-action' && (mutationResourceId !== hostResourceId || binding.mutationResourceKind !== hostResourceKind))) {
      return invalid()
    }
    if (operation === 'create' && expectedUpdatedAt !== undefined) return invalid()
    const version = versionToken(expectedUpdatedAt)
    const childEdit = kind === 'section-action' && (binding.mutationResourceKind !== hostResourceKind || mutationResourceId !== hostResourceId)
      && ['update', 'delete'].includes(binding.requestOperation)
    if (operation !== 'create' && (surface.optimisticLock === 'target-required' || childEdit) && !version) return invalid()
    const defaults = new Headers(domainHeaders)
    const policyHeaders = {
      policyToken, fingerprint, hostResourceKind, hostResourceId, mutationResourceId,
      mutationSurfaceId: surface.id, requestOperation: surface.requestOperation, mutationResourceKind: surface.mutationResourceKind,
    }
    const request: CrudFormBoundMutation['request'] = async (endpoint, init, options) => {
      if (init?.method !== undefined && init.method.toUpperCase() !== guardedFacade.method) return invalid()
      checkEndpoint(endpoint, guardedFacade.routePattern, mutationResourceId)
      const headers = new Headers(defaults)
      for (const source of [defaults, new Headers(init?.headers)]) {
        for (const [name, value] of source.entries()) {
          if (protectedHeaders.has(name) || (name === OPTIMISTIC_LOCK_HEADER_NAME && (!version || versionToken(value) !== version))) {
            return invalid()
          }
          headers.set(name, value)
        }
      }
      if (version) headers.set(OPTIMISTIC_LOCK_HEADER_NAME, version)
      return apiCallOrThrow(endpoint, {
        ...init, headers: buildCrudFormSectionPolicyHeaders(policyHeaders, headers),
        method: guardedFacade.method, mode: 'same-origin', redirect: 'error',
      }, { ...options, inheritScopedHeaders: false })
    }
    const write: CrudFormBoundMutation['write'] = async (endpoint, body, init, options) => {
      const headers = new Headers(init?.headers)
      if (body !== undefined) headers.set('content-type', 'application/json')
      return request(endpoint, { ...init, headers, body: body === undefined ? undefined : JSON.stringify(body) }, options)
    }
    return Object.freeze({ request, write })
  }

  function parent(operation: Operation, headers?: HeadersInit): CrudFormBoundMutation | undefined {
    const kind = operation === 'delete' ? 'parent-delete' : 'parent-submit'
    if ((operation !== 'delete' && operation !== formOperation) || (operation === 'delete' && formOperation !== 'update')) {
      return invalid()
    }
    const targets = [...surfaces.values()].filter((surface) => surface.kind === kind && surface.requestOperation === operation)
    if (!targets.length) return undefined
    if (targets.length !== 1) return invalid()
    const [target] = targets
    const explicitVersion = new Headers(headers).get(OPTIMISTIC_LOCK_HEADER_NAME)
    if (operation === 'create' && (parentUpdatedAt != null || explicitVersion !== null)) return invalid()
    return bind(target, {
      mutationSurfaceId: target.id, requestOperation: operation, mutationResourceKind: hostResourceKind,
      mutationResourceId: hostResourceId,
      expectedUpdatedAt: operation === 'create' || target.optimisticLock === 'none'
        ? undefined : explicitVersion ?? parentUpdatedAt ?? undefined,
    }, operation, headers)
  }

  function section(binding: Parameters<RunCrudFormSectionMutation>[0], headers?: HeadersInit) {
    const surface = surfaces.get(binding.mutationSurfaceId)
    if (!surface || surface.kind !== 'section-action') return invalid()
    return bind(surface, binding, binding.operation, headers)
  }

  return Object.freeze({ parent, section })
}

export function useCrudFormSectionMutation(
  policy: Parameters<typeof createCrudFormSectionMutationClient>[0] | undefined,
  parentUpdatedAt: string | null | undefined,
  formId: string,
  readOnly: boolean,
) {
  const surfaces = policy?.surface.clientMutationSurfaces ?? []
  const canSubmit = !policy || ((hasCrudFormSectionWritableLeaves(policy.surface) || policy.surface.allowNoopSubmit === true)
    && surfaces.filter(({ kind, requestOperation }) =>
      kind === 'parent-submit' && requestOperation === policy.identity.formOperation).length === 1)
  const canDelete = !policy || (policy.identity.formOperation === 'update' && surfaces.filter(({ kind, requestOperation }) =>
    kind === 'parent-delete' && requestOperation === 'delete').length === 1)
  const hasSectionActions = !readOnly && surfaces.some(({ kind }) => kind === 'section-action')
  const sectionMutationClient = useMemo(() => policy
    ? createCrudFormSectionMutationClient(policy, parentUpdatedAt) : null, [policy, parentUpdatedAt])
  const { runMutation: guardSectionMutation } = useGuardedMutation({ contextId: formId, enabled: hasSectionActions })
  const runSectionMutation = useCallback<RunCrudFormSectionMutation>(async (binding, endpoint, init, options) => {
    if (!sectionMutationClient || !hasSectionActions) return invalid()
    const requestBinding = { ...binding }
    const request = { ...init, headers: new Headers(init?.headers) }
    const { mutationPayload, ...callOptions } = options ?? {}
    return guardSectionMutation({
      headerMode: 'request-local',
      context: { formId, operation: binding.operation, resourceKind: binding.mutationResourceKind, resourceId: binding.mutationResourceId },
      mutationPayload,
      operation: (headers) => sectionMutationClient.section(requestBinding, headers).request(endpoint, request, callOptions),
    })
  }, [formId, guardSectionMutation, hasSectionActions, sectionMutationClient])
  return { sectionMutationClient, canSubmit, canDelete, runSectionMutation: hasSectionActions ? runSectionMutation : undefined }
}
