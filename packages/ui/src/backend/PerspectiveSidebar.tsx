"use client"
import * as React from 'react'
import { ArrowLeft, Plus } from 'lucide-react'
import { Alert } from '../primitives/alert'
import { Button } from '../primitives/button'
import { Checkbox } from '../primitives/checkbox'
import { Spinner } from '../primitives/spinner'
import { useConfirmDialog } from './confirm-dialog'
import { flash } from './FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type {
  PerspectiveDto,
  PerspectiveSettings,
  RolePerspectiveDto,
} from '@open-mercato/shared/modules/perspectives/types'
import { ViewChip } from './views/ViewChip'
import { NewViewForm } from './views/NewViewForm'
import { ShareForm } from './views/ShareForm'
import { type SidebarMode } from './views/types'
import { ColumnChooserSection, type ColumnChooserField } from './columns/ColumnChooserPanel'

export type { ColumnChooserField } from './columns/ColumnChooserPanel'

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
  onSave: (input: { name: string; isDefault: boolean; applyToRoles: string[]; setRoleDefault: boolean; perspectiveId?: string | null; settings?: PerspectiveSettings }) => Promise<void>
  canApplyToRoles: boolean
  availableColumns: ColumnChooserField[]
  visibleColumnKeys: string[]
  columnOrder: string[]
  onToggleColumn: (key: string) => void
  onReorderColumns: (orderedIds: string[]) => void
  saving: boolean
  deletingIds: string[]
  roleClearingIds: string[]
  apiWarning?: string | null
}

const emptyArray: any[] = []

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
  availableColumns,
  visibleColumnKeys,
  columnOrder,
  onToggleColumn,
  onReorderColumns,
  saving,
  deletingIds,
  roleClearingIds,
  apiWarning,
}: PerspectiveSidebarProps) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  React.useEffect(() => {
    if (!open) return
    if (typeof document === 'undefined') return
    document.body.dataset.columnChooserOpen = 'true'
    return () => {
      delete document.body.dataset.columnChooserOpen
    }
  }, [open])

  function perspectiveLabel(p: PerspectiveDto | RolePerspectiveDto) {
    return p.name.trim().length ? p.name : t('ui.perspectives.untitled', 'Untitled view')
  }

  const [name, setName] = React.useState('')
  const [isDefault, setIsDefault] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [mode, setMode] = React.useState<SidebarMode>({ type: 'idle' })
  const [renamingId, setRenamingId] = React.useState<string | null>(null)
  const [renameValue, setRenameValue] = React.useState('')
  const [shareRoles, setShareRoles] = React.useState<string[]>([])
  const [shareSetDefault, setShareSetDefault] = React.useState(false)
  const [sharedIds, setSharedIds] = React.useState<Set<string>>(new Set())
  const [pendingCloneBaselineIds, setPendingCloneBaselineIds] = React.useState<Set<string> | null>(null)

  const autosaveRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDefaultUserChangeRef = React.useRef(false)
  const isDefaultRef = React.useRef(isDefault)
  isDefaultRef.current = isDefault

  const onSaveRef = React.useRef(onSave)
  onSaveRef.current = onSave

  const perspectivesRef = React.useRef(perspectives)
  perspectivesRef.current = perspectives

  const flushAutosave = React.useCallback(() => {
    if (autosaveRef.current) {
      clearTimeout(autosaveRef.current)
      autosaveRef.current = null
    }
  }, [])

  const scheduleAutosave = React.useCallback(() => {
    if (!activePerspectiveId || mode.type === 'new') return
    const activePersonal = perspectivesRef.current.find((p) => p.id === activePerspectiveId)
    if (!activePersonal) return
    flushAutosave()
    const targetId = activePersonal.id
    const targetName = activePersonal.name
    autosaveRef.current = setTimeout(async () => {
      autosaveRef.current = null
      try {
        await onSaveRef.current({
          name: targetName,
          isDefault: isDefaultRef.current,
          applyToRoles: [],
          setRoleDefault: false,
          perspectiveId: targetId,
        })
        flash(t('ui.perspectives.autosave.success', 'View saved'), 'success')
      } catch {
        flash(t('ui.perspectives.autosave.error', 'Failed to save view'), 'error')
      }
    }, 400)
  }, [activePerspectiveId, mode.type, flushAutosave, t])

  React.useEffect(() => {
    return () => { flushAutosave() }
  }, [flushAutosave])

  const resetMode = () => {
    setMode({ type: 'idle' })
    setName('')
    setShareRoles([])
    setShareSetDefault(false)
  }

  const startNewMode = () => {
    setMode({ type: 'new' })
    setName('')
    setIsDefault(false)
    setRenamingId(null)
    setShareRoles([])
    setShareSetDefault(false)
  }

  const startShareMode = (p: PerspectiveDto) => {
    setMode({ type: 'share', perspectiveId: p.id, perspectiveName: p.name, perspectiveIsDefault: p.isDefault })
    setName('')
    setRenamingId(null)
    setShareRoles([])
    setShareSetDefault(false)
  }

  React.useEffect(() => {
    if (!open) {
      flushAutosave()
      setError(null)
      resetMode()
      setRenamingId(null)
      setSharedIds(new Set())
      setPendingCloneBaselineIds(null)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const active = perspectives.find((p) => p.id === activePerspectiveId)
      ?? rolePerspectives.find((p) => p.id === activePerspectiveId)
    isDefaultUserChangeRef.current = false
    if (active) {
      setIsDefault(active.isDefault)
    } else {
      setIsDefault(false)
    }
    requestAnimationFrame(() => { isDefaultUserChangeRef.current = true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activePerspectiveId])

  const handleSaveNew = async () => {
    setError(null)
    try {
      await onSave({ name: name.trim(), isDefault, applyToRoles: [], setRoleDefault: false, perspectiveId: null })
      resetMode()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save view')
    }
  }

  const handleToggleColumnWithAutosave = React.useCallback((key: string) => {
    onToggleColumn(key)
    scheduleAutosave()
  }, [onToggleColumn, scheduleAutosave])

  const handleReorderColumnsWithAutosave = React.useCallback((orderedIds: string[]) => {
    onReorderColumns(orderedIds)
    scheduleAutosave()
  }, [onReorderColumns, scheduleAutosave])

  const handleRename = async (p: PerspectiveDto | RolePerspectiveDto) => {
    const trimmed = renameValue.trim()
    if (!trimmed) {
      setRenamingId(null)
      return
    }
    const conflict = perspectivesRef.current.some(
      (item) => item.id !== p.id && item.name.trim() === trimmed,
    )
    if (conflict) {
      flash(t('ui.perspectives.error.nameExists', 'View with this name already exists'), 'error')
      return
    }
    setError(null)
    try {
      await onSave({
        name: trimmed,
        isDefault: p.isDefault,
        applyToRoles: [],
        setRoleDefault: false,
        perspectiveId: p.id,
      })
      setRenamingId(null)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to rename view')
    }
  }

  const handleClone = async (p: PerspectiveDto | RolePerspectiveDto) => {
    const originalName = perspectiveLabel(p)
    setError(null)
    const baseline = new Set(perspectivesRef.current.map((item) => item.id))
    const originalSettingsKey = JSON.stringify(p.settings ?? {})
    const sharedRoleIds = Array.from(
      new Set(
        rolePerspectives
          .filter((rp) => JSON.stringify(rp.settings ?? {}) === originalSettingsKey)
          .map((rp) => rp.roleId),
      ),
    )
    const buildCloneName = (n: number) =>
      n <= 1 ? `${originalName} (copy)` : `${originalName} (copy ${n})`
    const existingNames = new Set(
      perspectivesRef.current.map((item) => item.name.trim()),
    )
    let counter = 1
    while (existingNames.has(buildCloneName(counter))) {
      counter += 1
    }
    const clonedSettings = structuredClone(p.settings)
    const MAX_ATTEMPTS = 50
    let lastErr: unknown = null
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        await onSave({
          name: buildCloneName(counter),
          isDefault: false,
          applyToRoles: sharedRoleIds,
          setRoleDefault: false,
          perspectiveId: null,
          settings: clonedSettings,
        })
        setPendingCloneBaselineIds(baseline)
        return
      } catch (err: unknown) {
        const errMessage = err instanceof Error ? err.message : ''
        const msg = errMessage.toLowerCase()
        const isDuplicate = msg.includes('duplicate key') || msg.includes('unique constraint')
        if (!isDuplicate) {
          setError(errMessage || 'Failed to clone view')
          return
        }
        lastErr = err
        counter += 1
      }
    }
    setError(lastErr instanceof Error ? lastErr.message : 'Failed to clone view')
  }

  React.useEffect(() => {
    if (!pendingCloneBaselineIds) return
    const created = perspectives.find((item) => !pendingCloneBaselineIds.has(item.id))
    if (!created) return
    setRenamingId(created.id)
    setRenameValue(created.name)
    setPendingCloneBaselineIds(null)
  }, [perspectives, pendingCloneBaselineIds])

  const handleDelete = async (p: PerspectiveDto) => {
    const confirmed = await confirm({
      title: t('ui.perspectives.delete.title', 'Delete "{name}"?', { name: perspectiveLabel(p) }),
      text: t('ui.perspectives.delete.text', 'This view will be removed for you and all shared roles. This cannot be undone.'),
      confirmText: t('common.delete', 'Delete'),
      variant: 'destructive',
    })
    if (confirmed) {
      await onDeletePerspective(p.id)
    }
  }

  const handleDeleteRole = async (p: RolePerspectiveDto) => {
    const confirmed = await confirm({
      title: t('ui.perspectives.delete.title', 'Delete "{name}"?', { name: perspectiveLabel(p) }),
      text: t('ui.perspectives.deleteRole.text', 'This shared view will be removed for the role. This cannot be undone.'),
      confirmText: t('common.delete', 'Delete'),
      variant: 'destructive',
    })
    if (confirmed) {
      await onClearRole(p.roleId)
    }
  }

  const handleShareApply = async () => {
    if (mode.type !== 'share') return
    setError(null)
    try {
      await onSave({ name: mode.perspectiveName, isDefault: mode.perspectiveIsDefault, applyToRoles: shareRoles, setRoleDefault: shareSetDefault, perspectiveId: mode.perspectiveId })
      setSharedIds((prev) => new Set([...prev, mode.perspectiveId]))
      resetMode()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to share view')
    }
  }

  const toggleShareRole = (roleId: string) => {
    setShareRoles((prev) => {
      const next = new Set(prev)
      if (next.has(roleId)) next.delete(roleId)
      else next.add(roleId)
      return Array.from(next)
    })
  }

  if (!open) return null

  const isNew = mode.type === 'new'
  const isShare = mode.type === 'share'

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={() => onOpenChange(false)} role="presentation" />
      <div className="fixed right-0 top-0 h-full w-full sm:w-80 bg-background shadow-xl border-l flex flex-col">
        <div className="flex items-center p-4 border-b">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="h-auto -ml-2 gap-2 px-2 text-lg font-semibold hover:bg-transparent"
            aria-label={t('ui.perspectives.close', 'Close')}
          >
            <ArrowLeft className="size-5" />
            {t('ui.perspectives.title', 'Views')}
          </Button>
        </div>
        <div className="flex-1 overflow-auto">
          {/* Saved views as chips */}
          <section className="p-4 space-y-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('ui.perspectives.savedViews.title', 'Saved views')}</h3>
            {loading ? <Spinner size="sm" /> : null}
            <div className="flex flex-wrap gap-1.5">
              {/* + New chip */}
              <Button
                type="button"
                variant={isNew ? 'secondary' : 'outline'}
                size="sm"
                className={`h-8 px-3 py-1.5 text-sm ${!isNew ? 'border-dashed' : ''}`}
                onClick={startNewMode}
              >
                <Plus className="size-3 mr-1" />
                {t('ui.perspectives.savedViews.new', 'New')}
              </Button>
              {(perspectives ?? emptyArray).map((p) => {
                const isActive = activePerspectiveId === p.id
                const deleting = deletingIds.includes(p.id)
                const isShared = sharedIds.has(p.id)
                return (
                  <ViewChip
                    key={p.id}
                    id={p.id}
                    label={perspectiveLabel(p)}
                    kind="personal"
                    isActive={isActive}
                    disabled={deleting}
                    isShared={isShared}
                    isRenaming={renamingId === p.id}
                    renameValue={renameValue}
                    canApplyToRoles={canApplyToRoles}
                    deleting={deleting}
                    onActivate={() => { onActivatePerspective(p, 'personal'); resetMode() }}
                    onRenameValueChange={setRenameValue}
                    onRenameConfirm={() => void handleRename(p)}
                    onRenameCancel={() => setRenamingId(null)}
                    onRenameStart={() => { setRenamingId(p.id); setRenameValue(p.name) }}
                    onClone={() => void handleClone(p)}
                    onShareStart={() => startShareMode(p)}
                    onDelete={() => void handleDelete(p)}
                  />
                )
              })}
              {rolePerspectives
                .filter((rp) => {
                  const rpName = rp.name.trim()
                  return !perspectives.some((pp) => pp.name.trim() === rpName)
                })
                .map((p) => {
                const isActive = activePerspectiveId === p.id
                const clearing = roleClearingIds.includes(p.roleId)
                return (
                  <ViewChip
                    key={p.id}
                    id={p.id}
                    label={perspectiveLabel(p)}
                    kind="role"
                    isActive={isActive}
                    disabled={clearing}
                    isShared={false}
                    isRenaming={renamingId === p.id}
                    renameValue={renameValue}
                    canApplyToRoles={canApplyToRoles}
                    deleting={clearing}
                    onActivate={() => { onActivatePerspective(p, 'role'); resetMode() }}
                    onRenameValueChange={setRenameValue}
                    onRenameConfirm={() => void handleRename(p)}
                    onRenameCancel={() => setRenamingId(null)}
                    onClone={() => void handleClone(p)}
                    onDelete={() => void handleDeleteRole(p)}
                  />
                )
              })}
            </div>

            {/* Inline form slot — shared between New and Share modes */}
            {isNew ? (
              <NewViewForm
                name={name}
                onNameChange={setName}
                onSubmit={() => void handleSaveNew()}
                onCancel={resetMode}
                saving={saving}
              />
            ) : null}

            {isShare ? (
              <ShareForm
                roles={roles}
                shareRoles={shareRoles}
                shareSetDefault={shareSetDefault}
                onToggleRole={toggleShareRole}
                onToggleSetDefault={setShareSetDefault}
                onApply={() => void handleShareApply()}
                onCancel={resetMode}
              />
            ) : null}

            {apiWarning ? (
              <Alert variant="warning" className="text-xs">{apiWarning}</Alert>
            ) : null}
            {error ? <div className="text-sm text-status-error-text">{error}</div> : null}
          </section>

          {/* Set as default — separated from chips (border-t) and from columns (ColumnList owns border-t) */}
          <div className="flex items-center px-4 mt-2 pt-2 pb-2">
            <label className="inline-flex items-center gap-2 text-sm leading-none">
              <Checkbox
                checked={isDefault}
                onCheckedChange={(checked) => {
                  setIsDefault(checked === true)
                  if (isDefaultUserChangeRef.current) {
                    scheduleAutosave()
                  }
                }}
              />
              {t('ui.perspectives.form.makeDefault', 'Set as default')}
            </label>
          </div>

          <ColumnChooserSection
            availableColumns={availableColumns}
            visibleColumnKeys={visibleColumnKeys}
            columnOrder={columnOrder}
            onToggleColumn={handleToggleColumnWithAutosave}
            onReorderColumns={handleReorderColumnsWithAutosave}
            dndContextId="perspective-columns"
          />
        </div>
      </div>
      {ConfirmDialogElement}
    </div>
  )
}
