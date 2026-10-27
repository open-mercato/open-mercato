"use client"

import * as React from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { isSubmitShortcut, useBuildingUsage } from './useBuildingUsage'

export type BuildingDeleteTarget = { id: string; name: string; updatedAt: string | null }

export type BuildingDeleteDialogProps = {
  target: BuildingDeleteTarget | null
  onClose: () => void
  onDeleted: () => void
  onArchiveInstead?: () => void
}

const CONTEXT_ID = 'property-management-building-delete'

export function BuildingDeleteDialog({ target, onClose, onDeleted, onArchiveInstead }: BuildingDeleteDialogProps) {
  const t = useT()
  const [typed, setTyped] = React.useState('')
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const { usage, loading } = useBuildingUsage(target?.id ?? null, target !== null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: CONTEXT_ID,
  })

  React.useEffect(() => {
    setTyped('')
    setError(null)
  }, [target?.id])

  const canConfirm = Boolean(target) && typed.trim() === target?.name.trim() && usage?.canDelete !== false && !pending && !loading

  const confirm = async () => {
    if (!target || !canConfirm) return
    setPending(true)
    setError(null)
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(target.updatedAt), () =>
          deleteCrud('property_management/buildings', target.id, {
            errorMessage: t('property_management.buildings.delete.error', 'Could not delete the building.'),
          }),
        ),
        mutationPayload: { id: target.id },
        context: { formId: CONTEXT_ID, resourceKind: 'property_management.building', resourceId: target.id, retryLastMutation },
      })
      flash(t('property_management.buildings.delete.success', 'Building deleted.'), 'success')
      onDeleted()
    } catch (err) {
      if (surfaceRecordConflict(err, t)) {
        onClose()
        return
      }
      setError(err instanceof Error ? err.message : t('property_management.buildings.delete.error', 'Could not delete the building.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent onKeyDown={(event) => { if (isSubmitShortcut(event)) { event.preventDefault(); void confirm() } }}>
        <DialogHeader>
          <DialogTitle>{t('property_management.buildings.delete.title', 'Delete {name}?', { name: target?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('property_management.buildings.delete.irreversible', 'This cannot be undone.')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {loading ? <LoadingMessage label={t('property_management.common.loading', 'Loading…')} /> : null}
          {usage ? (
            <Alert status="warning">
              <AlertTitle>
                {t('property_management.buildings.delete.counts', '{floors} floors, {spaces} spaces and {units} units belong to this building', {
                  floors: usage.floorCount,
                  spaces: usage.spaceCount,
                  units: usage.unitCount,
                })}
              </AlertTitle>
              <AlertDescription>
                {t('property_management.buildings.delete.consequence', 'Deleting it removes their floor plans too. Leases and bookings are never deleted with it.')}
              </AlertDescription>
            </Alert>
          ) : null}
          {usage?.canDelete === false ? (
            <Alert status="error">
              {t('property_management.buildings.delete.used', 'This building has had leases or bookings, so it cannot be deleted. Archive it instead.')}
            </Alert>
          ) : null}
          {onArchiveInstead ? (
            <p className="text-sm text-muted-foreground">
              {t('property_management.buildings.delete.archiveHint', 'Closing this location for good?')}{' '}
              <Button type="button" variant="link" className="h-auto p-0" onClick={onArchiveInstead}>
                {t('property_management.buildings.delete.archiveInstead', 'Archive it instead — it keeps its leases, bookings, invoices and history.')}
              </Button>
            </p>
          ) : null}
          <div className="space-y-1">
            <Label htmlFor="pm-delete-confirm">{t('property_management.buildings.delete.typeName', 'Type the building name to confirm')}</Label>
            <Input id="pm-delete-confirm" value={typed} placeholder={target?.name ?? ''} onChange={(event) => setTyped(event.target.value)} autoFocus />
          </div>
          {error ? <Alert status="error">{error}</Alert> : null}
          <p className="text-sm text-muted-foreground">{t('property_management.common.dialogKeys', 'Esc to cancel · ⌘↵ to confirm')}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('property_management.common.cancel', 'Cancel')}</Button>
          <Button type="button" variant="destructive-solid" disabled={!canConfirm} onClick={() => void confirm()}>
            {t('property_management.buildings.delete.confirm', 'Delete building')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
