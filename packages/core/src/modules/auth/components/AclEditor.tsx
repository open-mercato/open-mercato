"use client"
import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'

type Feature = { id: string; title: string; module: string }

export function AclEditor({
  kind,
  targetId,
  canEditOrganizations,
}: {
  kind: 'user' | 'role'
  targetId: string
  canEditOrganizations: boolean
}) {
  const [loading, setLoading] = React.useState(true)
  const [features, setFeatures] = React.useState<Feature[]>([])
  const [granted, setGranted] = React.useState<string[]>([])
  const [isSuperAdmin, setIsSuperAdmin] = React.useState(false)
  const [organizations, setOrganizations] = React.useState<string[] | null>(null)
  const [orgOptions, setOrgOptions] = React.useState<{ id: string; name: string }[]>([])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const fRes = await apiFetch('/api/auth/features')
        const fJson = await fRes.json()
        if (!cancelled) setFeatures(fJson.items || [])
      } catch {}
      try {
        const aclRes = await apiFetch(`/api/${kind === 'user' ? 'users' : 'roles'}/acl?${kind === 'user' ? 'userId' : 'roleId'}=${encodeURIComponent(targetId)}`)
        const aclJson = await aclRes.json()
        if (!cancelled) {
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
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [kind, targetId, canEditOrganizations])

  const grouped = React.useMemo(() => {
    const map = new Map<string, Feature[]>()
    for (const f of features) {
      const list = map.get(f.module) || []
      list.push(f)
      map.set(f.module, list)
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [features])

  if (loading) return <div className="text-sm text-muted-foreground">Loading ACL…</div>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input id="isSuperAdmin" type="checkbox" className="h-4 w-4" checked={isSuperAdmin} onChange={(e) => setIsSuperAdmin(!!e.target.checked)} />
        <label htmlFor="isSuperAdmin" className="text-sm">Super Admin (all features)</label>
      </div>
      {!isSuperAdmin && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {grouped.map(([mod, list]) => (
            <div key={mod} className="rounded border p-3">
              <div className="text-sm font-medium mb-2">{mod}</div>
              <div className="space-y-2">
                {list.map((f) => {
                  const checked = granted.includes(f.id)
                  return (
                    <div key={f.id} className="flex items-center gap-2">
                      <input id={`f-${f.id}`} type="checkbox" className="h-4 w-4" checked={checked} onChange={(e) => {
                        const on = !!e.target.checked
                        setGranted((prev) => on ? Array.from(new Set([...prev, f.id])) : prev.filter((x) => x !== f.id))
                      }} />
                      <label htmlFor={`f-${f.id}`} className="text-sm">{f.title} <span className="text-muted-foreground">({f.id})</span></label>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
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
        </div>
      )}
      <div className="flex justify-end">
        <Button onClick={async () => {
          const payload = { isSuperAdmin, features: granted, organizations }
          await apiFetch(`/api/${kind === 'user' ? 'users' : 'roles'}/acl`, { method: 'PUT', body: JSON.stringify({ ...(kind === 'user' ? { userId: targetId } : { roleId: targetId }), ...payload }) })
        }}>Save ACL</Button>
      </div>
    </div>
  )
}


