"use client"

import * as React from 'react'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import {
  parseSelectedOrganizationCookie,
  parseSelectedTenantCookie,
} from '@open-mercato/core/modules/directory/utils/scopeCookies'

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
}

type ProjectAccessScopeBinding = {
  scope: ProjectAccessScope
  generation: number
}

export function readProjectAccessScope(timeProjectId?: string | null): ProjectAccessScope {
  const cookieHeader = typeof document === 'undefined' ? null : document.cookie
  return {
    projectId: timeProjectId ?? null,
    tenantId: parseSelectedTenantCookie(cookieHeader),
    organizationId: parseSelectedOrganizationCookie(cookieHeader),
  }
}

/**
 * Returns the scope `current` continues, or `null` when it is a different scope.
 *
 * A fresh session has no scope cookies: the server resolves each request from the session, and
 * the organization switcher then persists that resolved scope. An absent cookie therefore takes
 * the first value written over it. Any other difference is a new scope — another project, or an
 * explicit value that is replaced or cleared.
 */
export function bindProjectAccessScope(
  bound: ProjectAccessScope,
  current: ProjectAccessScope,
): ProjectAccessScope | null {
  const continues = (boundValue: string | null, currentValue: string | null) =>
    boundValue === null || boundValue === currentValue
  if (bound.projectId !== current.projectId) return null
  if (!continues(bound.tenantId, current.tenantId)) return null
  if (!continues(bound.organizationId, current.organizationId)) return null
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
  const continued = bindProjectAccessScope(binding.scope, current)
  if (!continued) return { scope: current, generation: binding.generation + 1 }
  if (isSameProjectAccessScope(continued, binding.scope)) return binding
  return { scope: continued, generation: binding.generation }
}

export function useProjectAccessScope(timeProjectId?: string | null): ProjectAccessScopeState {
  useOrganizationScopeVersion()
  const current = readProjectAccessScope(timeProjectId)
  const [binding, setBinding] = React.useState<ProjectAccessScopeBinding>(() => ({ scope: current, generation: 0 }))
  const nextBinding = rebindProjectAccessScope(binding, current)
  if (nextBinding !== binding) setBinding(nextBinding)
  const boundScope = React.useRef(nextBinding.scope)
  boundScope.current = nextBinding.scope
  const isCurrentScope = React.useCallback(
    () => bindProjectAccessScope(boundScope.current, readProjectAccessScope(timeProjectId)) !== null,
    [timeProjectId],
  )
  return { scopeKey: String(nextBinding.generation), isCurrentScope }
}
