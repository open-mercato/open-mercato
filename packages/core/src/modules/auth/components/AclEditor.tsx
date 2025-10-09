"use client"
import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import Link from 'next/link'

type Feature = { id: string; title: string; module: string }
type ModuleInfo = { id: string; title: string }
type RoleListItem = { id?: string | null; name?: string | null }
type RoleListResponse = { items?: RoleListItem[] }

export type AclData = {
  isSuperAdmin: boolean
  features: string[]
  organizations: string[] | null
}

export function AclEditor({
  kind,
  targetId,
  canEditOrganizations,
  value,
  onChange,
  userRoles,
}: {
  kind: 'user' | 'role'
  targetId: string
  canEditOrganizations: boolean
  value?: AclData
  onChange?: (data: AclData) => void
  userRoles?: string[]
}) {
  const [loading, setLoading] = React.useState(true)
  const [features, setFeatures] = React.useState<Feature[]>([])
  const [modules, setModules] = React.useState<ModuleInfo[]>([])
  const [granted, setGranted] = React.useState<string[]>(value?.features || [])
  const [isSuperAdmin, setIsSuperAdmin] = React.useState(value?.isSuperAdmin || false)
  const [organizations, setOrganizations] = React.useState<string[] | null>(value?.organizations ?? null)
  const [orgOptions, setOrgOptions] = React.useState<{ id: string; name: string }[]>([])
  const [hasCustomAcl, setHasCustomAcl] = React.useState(true)
  const [overrideEnabled, setOverrideEnabled] = React.useState(false)
  const [roleDetails, setRoleDetails] = React.useState<Array<{ id: string; name: string }>>([])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const fRes = await apiFetch('/api/auth/features')
        const fJson = await fRes.json()
        if (!cancelled) {
          setFeatures(fJson.items || [])
          setModules(fJson.modules || [])
        }
      } catch {}
      try {
        const aclRes = await apiFetch(`/api/auth/${kind === 'user' ? 'users' : 'roles'}/acl?${kind === 'user' ? 'userId' : 'roleId'}=${encodeURIComponent(targetId)}`)
        const aclJson = await aclRes.json()
        if (!cancelled) {
          const customAclExists = aclJson.hasCustomAcl !== false
          setHasCustomAcl(customAclExists)
          setOverrideEnabled(customAclExists)
          setIsSuperAdmin(!!aclJson.isSuperAdmin)
          setGranted(Array.isArray(aclJson.features) ? aclJson.features : [])
          setOrganizations(aclJson.organizations == null ? null : Array.isArray(aclJson.organizations) ? aclJson.organizations : [])
        }
      } catch {}
      if (canEditOrganizations) {
        try {
          const oRes = await apiFetch('/api/directory/organizations')
          const oJson = await oRes.json()
          if (!cancelled) setOrgOptions(oJson.items || [])
        } catch {}
      }
      if (kind === 'user' && userRoles && userRoles.length > 0) {
        try {
          const rolesRes = await apiFetch('/api/auth/roles?pageSize=1000')
          const rolesJson: RoleListResponse = await rolesRes.json().catch(() => ({}))
          if (!cancelled) {
            const allRoles = Array.isArray(rolesJson.items) ? rolesJson.items : []
            const userRoleDetails = allRoles
              .map((role) => {
                const name = typeof role?.name === 'string' ? role.name : ''
                if (!name || !userRoles.includes(name)) return null
                const id = role?.id ? String(role.id) : name
                return { id, name }
              })
              .filter((role): role is { id: string; name: string } => !!role)
            setRoleDetails(userRoleDetails)
          }
        } catch {}
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [kind, targetId, canEditOrganizations, userRoles])

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

  
  const toggleModuleWildcard = (moduleId: string, enable: boolean) => {
    const wildcard = `${moduleId}.*`
    if (enable) {
      setGranted((prev) => Array.from(new Set([...prev, wildcard])))
    } else {
      setGranted((prev) => prev.filter((x) => x !== wildcard))
    }
  }

  const isModuleWildcardEnabled = (moduleId: string) => {
    return granted.includes(`${moduleId}.*`)
  }

  const isFeatureChecked = (featureId: string, moduleId: string) => {
    if (hasGlobalWildcard) return true
    if (isModuleWildcardEnabled(moduleId)) return true
    return granted.includes(featureId)
  }

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
                {roleDetails.map((role, idx) => (
                  <React.Fragment key={role.id}>
                    {idx > 0 && ', '}
                    <Link 
                      href={`/backend/roles/${role.id}/edit`}
                      className="font-semibold text-blue-900 underline hover:text-blue-950 transition-colors"
                    >
                      {role.name}
                    </Link>
                  </React.Fragment>
                ))}
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
            <input id="isSuperAdmin" type="checkbox" className="h-4 w-4" checked={isSuperAdmin} onChange={(e) => setIsSuperAdmin(!!e.target.checked)} />
            <label htmlFor="isSuperAdmin" className="text-sm">Super Admin (all features)</label>
          </div>
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
                onClick={() => setGranted((prev) => prev.filter((x) => x !== '*'))}
              >
                Remove global wildcard
              </Button>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {grouped.map((group) => {
              const moduleWildcard = isModuleWildcardEnabled(group.moduleId)
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
                        disabled={hasGlobalWildcard}
                        onChange={(e) => toggleModuleWildcard(group.moduleId, e.target.checked)} 
                      />
                      <label htmlFor={`module-${group.moduleId}`} className="text-xs text-muted-foreground">
                        All {moduleWildcard && !hasGlobalWildcard ? <span className="font-medium text-blue-600">({group.moduleId}.*)</span> : ''}
                      </label>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {group.features.map((f) => {
                      const checked = isFeatureChecked(f.id, group.moduleId)
                      const isWildcardCovered = hasGlobalWildcard || moduleWildcard
                      return (
                        <div key={f.id} className="flex items-center gap-2">
                          <input 
                            id={`f-${f.id}`} 
                            type="checkbox" 
                            className="h-4 w-4" 
                            checked={checked} 
                            disabled={isWildcardCovered}
                            onChange={(e) => {
                              const on = !!e.target.checked
                              setGranted((prev) => on ? Array.from(new Set([...prev, f.id])) : prev.filter((x) => x !== f.id))
                            }} 
                          />
                          <label 
                            htmlFor={`f-${f.id}`} 
                            className={`text-sm ${isWildcardCovered ? 'text-muted-foreground' : ''}`}
                          >
                            {f.title} <span className="text-muted-foreground text-xs">({f.id})</span>
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
