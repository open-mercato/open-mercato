"use client"
import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import Link from 'next/link'
import { hasFeature, matchFeature } from '@open-mercato/shared/security/features'

function toTitleCase(value: string): string {
  return value.replace(/[-_.]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function normalizeFeatureArray(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const dedup = new Set<string>()
  for (const value of input) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    dedup.add(trimmed)
  }
  return Array.from(dedup)
}

function isTenantRestrictedFeature(feature: string): boolean {
  if (feature === '*' || feature === 'directory.*') return true
  if (feature.startsWith('directory.tenants')) return true
  return false
}

function formatWildcardLabel(moduleId: string, wildcard: string): string {
  if (!wildcard.endsWith('.*')) return wildcard
  const prefix = `${moduleId}.`
  const suffix = wildcard.startsWith(prefix) ? wildcard.slice(prefix.length, -2) : wildcard.slice(0, -2)
  if (!suffix) return 'All features'
  return `All ${suffix.split('.').map(toTitleCase).join(' / ')}`
}

type Feature = { id: string; title: string; module: string }
type ModuleInfo = { id: string; title: string }
type RoleListItem = { id?: string | null; name?: string | null }
type RoleListResponse = { items?: RoleListItem[] }
type RoleSummary = { id: string; name: string }

function buildRoleSummaries(items: RoleListItem[], allowedNames: string[]): RoleSummary[] {
  const summaries: RoleSummary[] = []
  for (const role of items) {
    const name = typeof role?.name === 'string' ? role.name : ''
    if (!name || !allowedNames.includes(name)) continue
    const hasValidId = typeof role?.id === 'string' && role.id.length > 0
    const id = hasValidId ? (role!.id as string) : name
    summaries.push({ id, name })
  }
  return summaries
}

export type AclData = {
  isSuperAdmin: boolean
  features: string[]
  organizations: string[] | null
}

type FeatureListResponse = { items?: Feature[]; modules?: ModuleInfo[] }
type AclPayload = {
  hasCustomAcl?: boolean
  isSuperAdmin?: boolean
  features?: unknown
  organizations?: unknown
}
type OrganizationListResponse = { items?: Array<{ id?: string; name?: string }> }

function normalizeOrganizationOptions(items: OrganizationListResponse['items']): Array<{ id: string; name: string }> {
  if (!Array.isArray(items)) return []
  return items.reduce<Array<{ id: string; name: string }>>((acc, org) => {
    if (!org) return acc
    const id = typeof org.id === 'string' && org.id.trim().length > 0 ? org.id : null
    if (!id) return acc
    const name = typeof org.name === 'string' && org.name.trim().length > 0 ? org.name : id
    acc.push({ id, name })
    return acc
  }, [])
}

async function readJsonOr<T>(
  url: string,
  init: RequestInit | undefined,
  fallback: T,
): Promise<T> {
  const call = await apiCall<T>(url, init, { fallback })
  if (!call.ok) return fallback
  return call.result ?? fallback
}

export function AclEditor({
  kind,
  targetId,
  canEditOrganizations,
  value,
  onChange,
  userRoles,
  currentUserIsSuperAdmin,
  tenantId,
}: {
  kind: 'user' | 'role'
  targetId: string
  canEditOrganizations: boolean
  value?: AclData
  onChange?: (data: AclData) => void
  userRoles?: string[]
  currentUserIsSuperAdmin?: boolean
  tenantId?: string | null
}) {
  const actorIsSuperAdmin = !!currentUserIsSuperAdmin
  const [loading, setLoading] = React.useState(true)
  const [features, setFeatures] = React.useState<Feature[]>([])
  const [modules, setModules] = React.useState<ModuleInfo[]>([])
  const [granted, setGranted] = React.useState<string[]>(() => {
    const normalized = normalizeFeatureArray(value?.features)
    return actorIsSuperAdmin ? normalized : normalized.filter((feature) => !isTenantRestrictedFeature(feature))
  })
  const [isSuperAdmin, setIsSuperAdmin] = React.useState(value?.isSuperAdmin || false)
  const [organizations, setOrganizations] = React.useState<string[] | null>(value?.organizations ?? null)
  const [orgOptions, setOrgOptions] = React.useState<{ id: string; name: string }[]>([])
  const [hasCustomAcl, setHasCustomAcl] = React.useState(true)
  const [overrideEnabled, setOverrideEnabled] = React.useState(false)
  const [roleDetails, setRoleDetails] = React.useState<RoleSummary[]>([])

  const actorSanitizeFeatures = React.useCallback(
    (list: unknown): string[] => {
      const normalized = normalizeFeatureArray(list)
      if (actorIsSuperAdmin) return normalized
      return normalized.filter((feature) => !isTenantRestrictedFeature(feature))
    },
    [actorIsSuperAdmin],
  )

  const updateGranted = React.useCallback(
    (updater: (prev: string[]) => string[]) => {
      setGranted((prev) => actorSanitizeFeatures(updater(prev)))
    },
    [actorSanitizeFeatures],
  )

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const fJson = await readJsonOr<FeatureListResponse>(
          '/api/auth/features',
          undefined,
          { items: [], modules: [] },
        )
        if (!cancelled) {
          setFeatures(fJson.items || [])
          setModules(fJson.modules || [])
        }
      } catch {}
      try {
        const aclQuery = new URLSearchParams()
        aclQuery.set(kind === 'user' ? 'userId' : 'roleId', targetId)
        if (tenantId) aclQuery.set('tenantId', tenantId)
        const aclQueryString = aclQuery.toString()
        const aclJson = await readJsonOr<AclPayload>(
          `/api/auth/${kind === 'user' ? 'users' : 'roles'}/acl${aclQueryString ? `?${aclQueryString}` : ''}`,
          undefined,
          { hasCustomAcl: true, isSuperAdmin: false, features: [], organizations: null },
        )
        if (!cancelled) {
          const customAclExists = aclJson.hasCustomAcl !== false
          setHasCustomAcl(customAclExists)
          setOverrideEnabled(customAclExists)
          setIsSuperAdmin(!!aclJson.isSuperAdmin)
          setGranted(actorSanitizeFeatures(aclJson.features))
          setOrganizations(aclJson.organizations == null ? null : Array.isArray(aclJson.organizations) ? aclJson.organizations : [])
        }
      } catch {}
      if (canEditOrganizations) {
        try {
          const orgQuery = new URLSearchParams()
          if (tenantId) orgQuery.set('tenantId', tenantId)
          const orgQueryString = orgQuery.toString()
          const oJson = await readJsonOr<OrganizationListResponse>(
            `/api/directory/organizations${orgQueryString ? `?${orgQueryString}` : ''}`,
            undefined,
            { items: [] },
          )
          if (!cancelled) setOrgOptions(normalizeOrganizationOptions(oJson.items))
        } catch {}
      }
      if (kind === 'user' && userRoles && userRoles.length > 0) {
        try {
          const roleQuery = new URLSearchParams({ pageSize: '1000' })
          if (tenantId) roleQuery.set('tenantId', tenantId)
          const roleQueryString = roleQuery.toString()
          const rolesJson = await readJsonOr<RoleListResponse>(
            `/api/auth/roles${roleQueryString ? `?${roleQueryString}` : ''}`,
            undefined,
            { items: [] },
          )
          if (!cancelled) {
            const allRoles = Array.isArray(rolesJson.items) ? rolesJson.items : []
            const userRoleDetails: RoleSummary[] = buildRoleSummaries(allRoles, userRoles)
            setRoleDetails(userRoleDetails)
          }
        } catch {}
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [kind, targetId, canEditOrganizations, userRoles, actorSanitizeFeatures, tenantId])

  // Notify parent of changes
  React.useEffect(() => {
    onChange?.({ isSuperAdmin, features: granted, organizations })
  }, [isSuperAdmin, granted, organizations, onChange])

  const grouped = React.useMemo(() => {
    const moduleMap = new Map<string, string>()
    for (const m of modules) {
      moduleMap.set(m.id, m.title)
    }
    const map = new Map<string, { moduleId: string; moduleTitle: string; features: Feature[] }>()
    for (const f of features) {
      const moduleId = f.module
      const moduleTitle = moduleMap.get(moduleId) || moduleId
      if (!map.has(moduleId)) {
        map.set(moduleId, { moduleId, moduleTitle, features: [] })
      }
      map.get(moduleId)!.features.push(f)
    }
    return Array.from(map.values()).sort((a, b) => a.moduleTitle.localeCompare(b.moduleTitle))
  }, [features, modules])

  const hasGlobalWildcard = granted.includes('*')
  const hasOrganizationRestriction = Array.isArray(organizations) && organizations.length > 0
  const showOrganizationWarning =
    (kind === 'role' || overrideEnabled) &&
    canEditOrganizations &&
    !isSuperAdmin &&
    hasOrganizationRestriction &&
    granted.length === 0

  
  const toggleWildcard = React.useCallback((wildcard: string, enable: boolean) => {
    if (!actorIsSuperAdmin && enable && isTenantRestrictedFeature(wildcard)) return
    updateGranted((prev) => {
      if (enable) {
        if (prev.includes(wildcard)) return prev
        return [...prev, wildcard]
      }
      return prev.filter((feature) => feature !== wildcard)
    })
  }, [actorIsSuperAdmin, updateGranted])

  const toggleModuleWildcard = React.useCallback((moduleId: string, enable: boolean) => {
    toggleWildcard(`${moduleId}.*`, enable)
  }, [toggleWildcard])

  const isModuleWildcardEnabled = (moduleId: string) => {
    return granted.includes(`${moduleId}.*`)
  }

  const isFeatureCoveredByWildcard = (featureId: string) =>
    granted.some((feature) => (feature === '*' || feature.endsWith('.*')) && matchFeature(featureId, feature))

  const isFeatureChecked = (featureId: string) => hasFeature(granted, featureId)

  if (loading) return <div className="text-sm text-muted-foreground">Loading ACL…</div>

  const showRoleBanner = kind === 'user' && !hasCustomAcl && !overrideEnabled

  return (
    <div className="space-y-4">
      {showRoleBanner && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <div className="text-sm font-medium text-blue-900 mb-2">
            Permissions inherited from roles
          </div>
          <div className="text-sm text-blue-700 mb-3">
            This user currently inherits permissions from their assigned roles.
            {roleDetails.length > 0 && (
              <span>
                {' '}Assigned roles:{' '}
                {roleDetails.map((role, idx) => {
                  const roleId = typeof role?.id === 'string' && role.id.length > 0 ? role.id : `role-${idx}`
                  const roleName = typeof role?.name === 'string' && role.name.length > 0 ? role.name : roleId
                  return (
                    <React.Fragment key={roleId}>
                      {idx > 0 && ', '}
                      <Link 
                        href={`/backend/roles/${roleId}/edit`}
                        className="font-semibold text-blue-900 underline hover:text-blue-950 transition-colors"
                      >
                        {roleName}
                      </Link>
                    </React.Fragment>
                  )
                })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input 
              id="overrideAcl" 
              type="checkbox" 
              className="h-4 w-4" 
              checked={overrideEnabled} 
              onChange={(e) => setOverrideEnabled(e.target.checked)} 
            />
            <label htmlFor="overrideAcl" className="text-sm text-blue-900 font-medium">
              Override permissions for this user only
            </label>
          </div>
        </div>
      )}
      {(kind === 'role' || overrideEnabled) && (
        <>
          <div className="flex items-center gap-2">
            <input
              id="isSuperAdmin"
              type="checkbox"
              className="h-4 w-4"
              checked={isSuperAdmin}
              disabled={!actorIsSuperAdmin}
              onChange={(e) => setIsSuperAdmin(!!e.target.checked)}
            />
            <label htmlFor="isSuperAdmin" className="text-sm">Super Admin (all features)</label>
          </div>
          {!actorIsSuperAdmin && (
            <p className="text-xs text-muted-foreground">Only super administrators can change this option.</p>
          )}
      {!isSuperAdmin && (
        <>
          {hasGlobalWildcard && (
            <div className="rounded border border-blue-200 bg-blue-50 p-3">
              <div className="text-sm font-medium text-blue-900">Global wildcard (*) enabled</div>
              <div className="text-xs text-blue-700 mt-1">This grants access to all features in the system.</div>
              <Button 
                variant="outline" 
                size="sm" 
                className="mt-2"
                onClick={() => updateGranted((prev) => prev.filter((x) => x !== '*'))}
              >
                Remove global wildcard
              </Button>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {grouped.map((group) => {
              const moduleWildcard = isModuleWildcardEnabled(group.moduleId)
              const nestedWildcards = Array.from(
                new Set(
                  granted.filter(
                    (feature) =>
                      feature !== '*' &&
                      feature.endsWith('.*') &&
                      feature.startsWith(`${group.moduleId}.`) &&
                      feature !== `${group.moduleId}.*`,
                  ),
                ),
              )
                .map((wildcard) => {
                  const prefix = wildcard.slice(0, -1)
                  const relatedFeatures = group.features.filter((feature) => feature.id.startsWith(prefix))
                  return { wildcard, features: relatedFeatures }
                })
                .sort((a, b) => a.wildcard.localeCompare(b.wildcard))
              const nestedCoveredIds = new Set<string>()
              for (const entry of nestedWildcards) {
                for (const feature of entry.features) nestedCoveredIds.add(feature.id)
              }
              const moduleRestricted = !actorIsSuperAdmin && isTenantRestrictedFeature(`${group.moduleId}.*`)
              const moduleCheckboxDisabled = hasGlobalWildcard || moduleRestricted
              return (
                <div key={group.moduleId} className="rounded border p-3">
                  <div className="flex items-center justify-between mb-3 pb-2 border-b">
                    <div className="text-sm font-medium">{group.moduleTitle}</div>
                    <div className="flex items-center gap-2">
                      <input 
                        id={`module-${group.moduleId}`} 
                        type="checkbox" 
                        className="h-4 w-4" 
                        checked={moduleWildcard || hasGlobalWildcard} 
                        disabled={moduleCheckboxDisabled}
                        onChange={(e) => toggleModuleWildcard(group.moduleId, e.target.checked)} 
                      />
                      <label htmlFor={`module-${group.moduleId}`} className="text-sm text-muted-foreground">
                        All {moduleWildcard && !hasGlobalWildcard ? <span className="font-medium text-blue-600">({group.moduleId}.*)</span> : ''}
                        {moduleRestricted ? <span className="ml-2 text-xs font-medium text-muted-foreground">(manage via super admin)</span> : null}
                      </label>
                    </div>
                  </div>
                {nestedWildcards.length > 0 && (
                  <div className="space-y-3 mb-3">
                    {nestedWildcards.map(({ wildcard, features: wildcardFeatures }) => {
                        const checked = granted.includes(wildcard) || hasGlobalWildcard || moduleWildcard
                        const wildcardRestricted = !actorIsSuperAdmin && isTenantRestrictedFeature(wildcard)
                        const disabled = hasGlobalWildcard || moduleWildcard || wildcardRestricted
                        return (
                          <div key={wildcard} className="space-y-2">
                            <div className="flex items-center gap-2">
                              <input
                                id={`wildcard-${wildcard}`}
                                type="checkbox"
                                className="h-4 w-4"
                                checked={checked}
                                disabled={disabled}
                                onChange={(e) => toggleWildcard(wildcard, !!e.target.checked)}
                              />
                              <label
                                htmlFor={`wildcard-${wildcard}`}
                                className={`text-sm ${disabled ? 'text-muted-foreground' : ''}`}
                              >
                                {formatWildcardLabel(group.moduleId, wildcard)}{' '}
                                <span className="text-muted-foreground text-xs font-mono">({wildcard})</span>
                                {wildcardRestricted ? <span className="ml-2 text-xs font-medium text-muted-foreground">Restricted</span> : null}
                              </label>
                            </div>
                            {wildcardFeatures.length > 0 && (
                              <div className="relative ml-6 pl-4 text-sm text-muted-foreground space-y-1">
                                <div className="absolute left-0 top-1 bottom-1 w-px bg-border" aria-hidden />
                                {wildcardFeatures.map((wf) => (
                                  <div key={`${wildcard}-${wf.id}`} className="pl-2">
                                    <span>
                                      {wf.title}{' '}
                                      <span className="text-xs font-mono text-muted-foreground">({wf.id})</span>
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  <div className="space-y-2">
                    {group.features.map((f) => {
                      if (nestedCoveredIds.has(f.id)) return null
                      const checked = isFeatureChecked(f.id)
                      const isWildcardCovered = isFeatureCoveredByWildcard(f.id)
                      const restricted = !actorIsSuperAdmin && isTenantRestrictedFeature(f.id)
                      const disabled = isWildcardCovered || restricted
                      return (
                        <div key={f.id} className="flex items-center gap-2">
                          <input
                            id={`f-${f.id}`}
                            type="checkbox"
                            className="h-4 w-4"
                            checked={checked}
                            disabled={disabled}
                            onChange={(e) => {
                              const on = !!e.target.checked
                              updateGranted((prev) => {
                                if (on) return [...prev, f.id]
                                return prev.filter((x) => x !== f.id)
                              })
                            }}
                          />
                          <label
                            htmlFor={`f-${f.id}`}
                            className={`text-sm ${disabled ? 'text-muted-foreground' : ''}`}
                          >
                            {f.title} <span className="text-muted-foreground text-xs">({f.id})</span>
                            {restricted ? <span className="ml-2 text-xs font-medium text-muted-foreground">Restricted</span> : null}
                          </label>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </>
          )}
          {canEditOrganizations && (
            <div className="rounded border p-3">
              <div className="text-sm font-medium mb-2">Organizations scope</div>
              <div className="text-xs text-muted-foreground mb-2">Empty = all organizations. Select one or more to restrict.</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {orgOptions.map((o) => {
                  const checked = organizations == null ? false : (organizations || []).includes(o.id)
                  return (
                    <div key={o.id} className="flex items-center gap-2">
                      <input id={`org-${o.id}`} type="checkbox" className="h-4 w-4" checked={checked} onChange={(e) => {
                        const on = !!e.target.checked
                        setOrganizations((prev) => {
                          if (prev == null) return on ? [o.id] : []
                          return on ? Array.from(new Set([...(prev || []), o.id])) : (prev || []).filter((x) => x !== o.id)
                        })
                      }} />
                      <label htmlFor={`org-${o.id}`} className="text-sm">{o.name}</label>
                    </div>
                  )
                })}
              </div>
              <div className="mt-2">
                <Button variant="outline" onClick={() => setOrganizations(null)}>Allow all organizations</Button>
              </div>
              {showOrganizationWarning && (
                <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Organization restrictions are saved only when at least one feature override is selected. Add a feature or enable a module wildcard before saving.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
