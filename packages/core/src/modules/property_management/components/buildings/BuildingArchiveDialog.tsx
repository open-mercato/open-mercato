"use client"

import * as React from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { isSubmitShortcut, useBuildingUsage } from './useBuildingUsage'
import type { BuildingDeleteTarget } from './BuildingDeleteDialog'
import { formatUsageBlocker } from '../usageBlockers'

export type BuildingArchiveDialogProps = {
  target: BuildingDeleteTarget | null
  onClose: () => void
  onArchived: () => void
}

const CONTEXT_ID = 'property-management-building-archive'

export function BuildingArchiveDialog({ target, onClose, onArchived }: BuildingArchiveDialogProps) {
  const t = useT()
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const locale = useLocale()
  const { usage, loading, failed, retry } = useBuildingUsage(target?.id ?? null, target !== null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('property_management.common.blocked', 'The change was blocked.'),
  })

  React.useEffect(() => setError(null), [target?.id])

  const canConfirm = Boolean(target) && usage?.canArchive === true && !pending

  const confirm = async () => {
    if (!target || !canConfirm) return
    setPending(true)
    setError(null)
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(target.updatedAt), () =>
          apiCallOrThrow(`/api/property_management/buildings/${encodeURIComponent(target.id)}/archive`, { method: 'POST' }, {
            errorMessage: t('property_management.buildings.archive.error', 'Could not archive the building.'),
          }),
        ),
        mutationPayload: { id: target.id },
        context: { formId: CONTEXT_ID, resourceKind: 'property_management.building', resourceId: target.id, retryLastMutation },
      })
      flash(t('property_management.buildings.archive.success', 'Building archived.'), 'success')
      onArchived()
    } catch (err) {
      if (surfaceRecordConflict(err, t)) {
        onClose()
        return
      }
      setError(err instanceof Error ? err.message : t('property_management.buildings.archive.error', 'Could not archive the building.'))
    } finally {
      setPending(false)
    }
  }

  const blockers = usage?.blockers ?? []
  const moreBlockers = Math.max(0, (usage?.blockerCount ?? blockers.length) - blockers.length)

  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent onKeyDown={(event) => { if (isSubmitShortcut(event)) { event.preventDefault(); void confirm() } }}>
        <DialogHeader>
          <DialogTitle>{t('property_management.buildings.archive.title', 'Archive {name}?', { name: target?.name ?? '' })}</DialogTitle>
          <DialogDescription>{t('property_management.buildings.archive.final', 'Archiving is for good — there is no restore.')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm">
            {t(
              'property_management.buildings.archive.kept',
              'An archived building leaves every list and location switcher and takes no new leases or bookings. Its leases, bookings, invoices and history are kept, read-only.',
            )}
          </p>
          {loading ? <LoadingMessage label={t('property_management.common.loading', 'Loading…')} /> : null}
          {failed ? (
            <Alert status="error" data-testid="pm-building-archive-usage-error">
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>{t('property_management.buildings.archive.usageError', 'Could not check whether the building still has active leases or upcoming bookings.')}</span>
                <Button type="button" variant="outline" size="sm" onClick={retry}>{t('property_management.common.retry', 'Try again')}</Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {blockers.length ? (
            <Alert status="warning">
              <AlertTitle>{t('property_management.buildings.archive.blocked', 'It still has active leases or upcoming bookings')}</AlertTitle>
              <ul className="list-disc pl-4 text-sm">
                {blockers.map((blocker) => (
                  <li key={`${blocker.kind}-${blocker.id}`}>{formatUsageBlocker(blocker, locale)}</li>
                ))}
                {moreBlockers > 0 ? (
                  <li data-testid="pm-building-archive-more-blockers">{t('property_management.buildings.archive.moreBlockers', 'and {count} more', { count: moreBlockers })}</li>
                ) : null}
              </ul>
            </Alert>
          ) : null}
          {error ? <Alert status="error">{error}</Alert> : null}
          <p className="text-sm text-muted-foreground">{t('property_management.common.dialogKeys', 'Esc to cancel · ⌘↵ to confirm')}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('property_management.common.cancel', 'Cancel')}</Button>
          <Button type="button" variant="destructive-solid" disabled={!canConfirm} onClick={() => void confirm()}>
            {t('property_management.buildings.archive.confirm', 'Archive building')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
