"use client"
import * as React from 'react'
import { Button } from '../primitives/button'
import { Spinner } from '../primitives/spinner'
import type {
  PerspectiveDto,
  RolePerspectiveDto,
} from '@open-mercato/shared/modules/perspectives/types'

type ColumnOption = {
  id: string
  label: string
  visible: boolean
  canHide: boolean
}

export type PerspectiveSidebarProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  loading: boolean
  perspectives: PerspectiveDto[]
  rolePerspectives: RolePerspectiveDto[]
  roles: Array<{ id: string; name: string; hasPerspective: boolean; hasDefault: boolean }>
  activePerspectiveId: string | null
  onActivatePerspective: (perspective: PerspectiveDto | RolePerspectiveDto, source: 'personal' | 'role') => void
  onDeletePerspective: (perspectiveId: string) => Promise<void>
  onClearRole: (roleId: string) => Promise<void>
  onSave: (input: { name: string; isDefault: boolean; applyToRoles: string[]; setRoleDefault: boolean }) => Promise<void>
  canApplyToRoles: boolean
  columnOptions: ColumnOption[]
  onToggleColumn: (id: string, visible: boolean) => void
  onMoveColumn: (id: string, direction: 'up' | 'down') => void
  saving: boolean
  deletingIds: string[]
  roleClearingIds: string[]
}

const emptyArray: any[] = []

function perspectiveLabel(p: PerspectiveDto | RolePerspectiveDto) {
  return p.name.trim().length ? p.name : 'Untitled perspective'
}

export function PerspectiveSidebar({
  open,
  onOpenChange,
  loading,
  perspectives,
  rolePerspectives,
  roles,
  activePerspectiveId,
  onActivatePerspective,
  onDeletePerspective,
  onClearRole,
  onSave,
  canApplyToRoles,
  columnOptions,
  onToggleColumn,
  onMoveColumn,
  saving,
  deletingIds,
  roleClearingIds,
}: PerspectiveSidebarProps) {
  const [name, setName] = React.useState('')
  const [isDefault, setIsDefault] = React.useState(false)
  const [applyToRoles, setApplyToRoles] = React.useState<string[]>([])
  const [setRoleDefault, setSetRoleDefault] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) {
      setError(null)
    }
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const active = perspectives.find((p) => p.id === activePerspectiveId)
      ?? rolePerspectives.find((p) => p.id === activePerspectiveId)
    if (active) {
      setName(active.name)
      setIsDefault(active.isDefault)
    } else if (!name) {
      setName('')
      setIsDefault(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activePerspectiveId])

  const groupedRolePerspectives = React.useMemo(() => {
    const map = new Map<string, RolePerspectiveDto[]>()
    for (const rp of rolePerspectives) {
      if (!map.has(rp.roleId)) map.set(rp.roleId, [])
      map.get(rp.roleId)!.push(rp)
    }
    return map
  }, [rolePerspectives])

  const toggleRoleSelection = (roleId: string) => {
    setApplyToRoles((prev) => {
      const next = new Set(prev)
      if (next.has(roleId)) next.delete(roleId)
      else next.add(roleId)
      return Array.from(next)
    })
  }

  const handleSave = async () => {
    setError(null)
    try {
      await onSave({ name: name.trim(), isDefault, applyToRoles, setRoleDefault })
      if (!isDefault) setIsDefault(false)
      setApplyToRoles([])
      setSetRoleDefault(false)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save perspective')
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={() => onOpenChange(false)} />
      <div className="absolute left-0 top-0 h-full w-full sm:w-[420px] bg-background shadow-xl border-r flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-base font-semibold">Perspectives</h2>
          <button className="text-sm text-muted-foreground" onClick={() => onOpenChange(false)}>Close</button>
        </div>
        <div className="flex-1 overflow-auto divide-y">
          <section className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase text-muted-foreground">My perspectives</h3>
              {loading ? <Spinner size="sm" /> : null}
            </div>
            {(perspectives ?? emptyArray).length === 0 ? (
              <p className="text-sm text-muted-foreground">No saved perspectives yet. Adjust columns or filters and save your first perspective.</p>
            ) : (
              <div className="space-y-2">
                {perspectives.map((p) => {
                  const isActive = activePerspectiveId === p.id
                  const deleting = deletingIds.includes(p.id)
                  return (
                    <div key={p.id} className={`rounded border px-3 py-2 flex items-start justify-between gap-3 ${isActive ? 'border-primary/80 bg-primary/5' : 'border-border bg-card'}`}>
                      <div className="space-y-1">
                        <div className="text-sm font-medium">{perspectiveLabel(p)}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          {p.isDefault ? <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-primary text-[11px] uppercase tracking-wide">Default</span> : null}
                          <span>Updated {new Date(p.updatedAt ?? p.createdAt).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <Button
                          size="sm"
                          variant={isActive ? 'secondary' : 'outline'}
                          onClick={() => onActivatePerspective(p, 'personal')}
                          disabled={isActive || deleting}
                        >
                          {isActive ? 'Active' : 'Use'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void onDeletePerspective(p.id)}
                          disabled={deleting}
                        >
                          {deleting ? 'Removing…' : 'Delete'}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
          <section className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase text-muted-foreground">Role perspectives</h3>
              {rolePerspectives.length === 0 ? null : <span className="text-xs text-muted-foreground">{rolePerspectives.length}</span>}
            </div>
            {rolePerspectives.length === 0 ? (
              <p className="text-sm text-muted-foreground">No shared role perspectives available.</p>
            ) : (
              <div className="space-y-3">
                {Array.from(groupedRolePerspectives.entries()).map(([roleId, items]) => {
                  const role = roles.find((r) => r.id === roleId)
                  const clearing = roleClearingIds.includes(roleId)
                  return (
                    <div key={roleId} className="rounded border px-3 py-2 space-y-2 bg-muted/40">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold">{role?.name ?? 'Role'}</div>
                          {role?.hasDefault ? <div className="text-xs text-muted-foreground">Default perspective configured</div> : null}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void onClearRole(roleId)}
                          disabled={clearing}
                        >
                          {clearing ? 'Clearing…' : 'Clear role'}
                        </Button>
                      </div>
                      <div className="space-y-2">
                        {items.map((item) => {
                          const isActive = activePerspectiveId === item.id
                          return (
                            <div key={item.id} className={`rounded border px-3 py-2 flex items-start justify-between gap-3 ${isActive ? 'border-primary/80 bg-primary/5' : 'border-border bg-background'}`}>
                              <div className="space-y-1">
                                <div className="text-sm font-medium">{perspectiveLabel(item)}</div>
                                <div className="text-xs text-muted-foreground flex items-center gap-2">
                                  {item.isDefault ? <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-primary text-[11px] uppercase tracking-wide">Role default</span> : null}
                                  <span>Updated {new Date(item.updatedAt ?? item.createdAt).toLocaleString()}</span>
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant={isActive ? 'secondary' : 'outline'}
                                onClick={() => onActivatePerspective(item, 'role')}
                                disabled={isActive}
                              >
                                {isActive ? 'Active' : 'Use'}
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
          <section className="p-4 space-y-3">
            <h3 className="text-sm font-semibold uppercase text-muted-foreground">Save current view</h3>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. My condensed view"
                className="w-full h-9 rounded border px-2 text-sm"
              />
            </div>
            <div className="space-y-2">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                />
                Make this my default perspective
              </label>
            </div>
            {canApplyToRoles ? (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground uppercase">Share with roles</div>
                <div className="max-h-32 overflow-auto border rounded p-2 space-y-1">
                  {roles.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No roles available.</div>
                  ) : roles.map((role) => (
                    <label key={role.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={applyToRoles.includes(role.id)}
                        onChange={() => toggleRoleSelection(role.id)}
                      />
                      <span>{role.name}</span>
                    </label>
                  ))}
                </div>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={setRoleDefault}
                    onChange={(e) => setSetRoleDefault(e.target.checked)}
                    disabled={applyToRoles.length === 0}
                  />
                  Set as default for selected roles
                </label>
              </div>
            ) : null}
            {error ? <div className="text-sm text-red-600">{error}</div> : null}
            <Button size="sm" onClick={() => void handleSave()} disabled={saving || !name.trim()}>
              {saving ? 'Saving…' : 'Save perspective'}
            </Button>
          </section>
          <section className="p-4 space-y-3">
            <h3 className="text-sm font-semibold uppercase text-muted-foreground">Columns</h3>
            <div className="space-y-2">
              {columnOptions.map((col, index) => (
                <div key={col.id} className="flex items-center justify-between gap-2 rounded border px-3 py-2 bg-card">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={col.visible}
                      onChange={(e) => onToggleColumn(col.id, e.target.checked)}
                      disabled={!col.canHide}
                    />
                    <span>{col.label}</span>
                  </label>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onMoveColumn(col.id, 'up')}
                      disabled={index === 0}
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onMoveColumn(col.id, 'down')}
                      disabled={index === columnOptions.length - 1}
                    >
                      ↓
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
