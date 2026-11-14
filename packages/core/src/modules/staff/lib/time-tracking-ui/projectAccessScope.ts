"use client"

import * as React from 'react'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import {
  parseSelectedOrganizationCookie,
  parseSelectedTenantCookie,
} from '@open-mercato/core/modules/directory/utils/scopeCookies'
import type { ResolvedProjectAccessScope } from './projectAccessScopeHeaders'

export type ProjectAccessScope = {
  projectId: string | null
  tenantId: string | null
  organizationId: string | null
}

export type ProjectAccessScopeState = {
  /** Stable while the scope stays the same; changes when the project, tenant or organization changes. */
  scopeKey: string
  /** Reads the scope cookies again, so it also catches a change that has not been rendered yet. */
  isCurrentScope: () => boolean
  resolvedScope: ResolvedProjectAccessScope | null
  resolveScope: (scope: ResolvedProjectAccessScope | null) => void
}

type ProjectAccessScopeBinding = {
  scope: ProjectAccessScope
  generation: number
  resolvedScope: ResolvedProjectAccessScope | null
}

export function readProjectAccessScope(timeProjectId?: string | null): ProjectAccessScope {
  const cookieHeader = typeof document === 'undefined' ? null : document.cookie
  return {
    projectId: timeProjectId ?? null,
    tenantId: parseSelectedTenantCookie(cookieHeader),
    organizationId: parseSelectedOrganizationCookie(cookieHeader),
  }
}

export function bindProjectAccessScope(
  bound: ProjectAccessScope,
  current: ProjectAccessScope,
  resolvedScope?: ResolvedProjectAccessScope | null,
): ProjectAccessScope | null {
  const continues = (boundValue: string | null, currentValue: string | null, resolvedValue?: string) =>
    boundValue === currentValue || (boundValue === null && currentValue === resolvedValue)
  if (bound.projectId !== current.projectId) return null
  if (!continues(bound.tenantId, current.tenantId, resolvedScope?.tenantId)) return null
  if (!continues(bound.organizationId, current.organizationId, resolvedScope?.organizationId)) return null
  return current
}

function isSameProjectAccessScope(left: ProjectAccessScope, right: ProjectAccessScope): boolean {
  return left.projectId === right.projectId
    && left.tenantId === right.tenantId
    && left.organizationId === right.organizationId
}

function rebindProjectAccessScope(
  binding: ProjectAccessScopeBinding,
  current: ProjectAccessScope,
): ProjectAccessScopeBinding {
  const continued = bindProjectAccessScope(binding.scope, current, binding.resolvedScope)
  if (!continued) return { scope: current, generation: binding.generation + 1, resolvedScope: null }
  if (isSameProjectAccessScope(continued, binding.scope)) return binding
  return { ...binding, scope: continued }
}

export function useProjectAccessScope(
  timeProjectId?: string | null,
  initialResolvedScope?: ResolvedProjectAccessScope | null,
): ProjectAccessScopeState {
  useOrganizationScopeVersion()
  const current = readProjectAccessScope(timeProjectId)
  const [binding, setBinding] = React.useState<ProjectAccessScopeBinding>(() => ({
    scope: current,
    generation: 0,
    resolvedScope: initialResolvedScope ?? null,
  }))
  const nextBinding = rebindProjectAccessScope(binding, current)
  if (nextBinding !== binding) setBinding(nextBinding)
  const boundScope = React.useRef(nextBinding)
  boundScope.current = nextBinding
  const generation = nextBinding.generation
  const isCurrentScope = React.useCallback(() => {
    const active = boundScope.current
    return active.generation === generation
      && bindProjectAccessScope(active.scope, readProjectAccessScope(timeProjectId), active.resolvedScope) !== null
  }, [generation, timeProjectId])
  const resolveScope = React.useCallback((resolvedScope: ResolvedProjectAccessScope | null) => {
    setBinding((previous) => {
      if (previous.generation !== generation) return previous
      if (!bindProjectAccessScope(previous.scope, readProjectAccessScope(timeProjectId), resolvedScope)) return previous
      const changed = previous.resolvedScope !== null && resolvedScope !== null
        && (previous.resolvedScope.tenantId !== resolvedScope.tenantId
          || previous.resolvedScope.organizationId !== resolvedScope.organizationId)
      return { ...previous, resolvedScope, generation: previous.generation + (changed ? 1 : 0) }
    })
  }, [generation, timeProjectId])
  return { scopeKey: String(generation), isCurrentScope, resolvedScope: nextBinding.resolvedScope, resolveScope }
}
