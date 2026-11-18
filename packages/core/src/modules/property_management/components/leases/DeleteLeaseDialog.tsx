"use client"

import * as React from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { isSubmitShortcut, readErrorCode, readErrorMessage, type LeaseSummary } from './leaseModel'
import { useLeaseMutation } from './useLeaseMutation'

type DeleteLeaseDialogProps = {
  lease: LeaseSummary | null
  onClose: () => void
  onDeleted: () => void
  onEndInstead?: () => void
}

export function DeleteLeaseDialog({ lease, onClose, onDeleted, onEndInstead }: DeleteLeaseDialogProps) {
  const t = useT()
  const { send } = useLeaseMutation('property-management-lease-delete')
  const [pending, setPending] = React.useState(false)
  const [refused, setRefused] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    setRefused(false)
    setError(null)
  }, [lease?.id])

  const canEnd = lease?.status === 'active' && Boolean(onEndInstead)

  const confirm = async () => {
    if (!lease || pending) return
    if (refused) {
      if (canEnd) onEndInstead?.()
      return
    }
    setPending(true)
    setError(null)
    try {
      await send({
        leaseId: lease.id,
        optimisticLockUpdatedAt: lease.updatedAt,
        url: `/api/property_management/leases?id=${encodeURIComponent(lease.id)}`,
        method: 'DELETE',
        errorMessage: t('property_management.leases.delete.error', 'Could not delete the lease.'),
      })
      flash(t('property_management.leases.delete.success', 'Lease deleted.'), 'success')
      onDeleted()
    } catch (err) {
      if (surfaceRecordConflict(err, t)) {
        onClose()
        return
      }
      if (readErrorCode(err) === 'lease_invoiced') {
        setRefused(true)
        return
      }
      setError(readErrorMessage(err, t('property_management.leases.delete.error', 'Could not delete the lease.')))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={lease !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent onKeyDown={(event) => { if (isSubmitShortcut(event)) { event.preventDefault(); void confirm() } }}>
        <DialogHeader>
          <DialogTitle>
            {refused
              ? t('property_management.leases.delete.refusedTitle', 'Lease {reference} can’t be deleted', { reference: lease?.reference ?? '' })
              : t('property_management.leases.delete.title', 'Delete lease {reference}?', { reference: lease?.reference ?? '' })}
          </DialogTitle>
          <DialogDescription>
            {refused
              ? t('property_management.leases.delete.refusedLead', 'Invoices were already issued under it.')
              : t('property_management.leases.delete.lead', 'Delete is only for a lease entered by mistake. Its open proposals are withdrawn and its recurring orders are cancelled from their start — nothing is billed.')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {refused ? (
            <Alert status="warning" data-testid="pm-lease-delete-refused">
              <AlertTitle>{t('property_management.leases.delete.refusedHintTitle', 'Delete is only for a lease entered by mistake')}</AlertTitle>
              <AlertDescription>
                {t('property_management.leases.delete.refusedHint', 'Once anything has been invoiced, the lease stays on record with its sales order and invoices. To finish a tenancy, end the lease and choose how the month already invoiced is settled.')}
              </AlertDescription>
            </Alert>
          ) : null}
          {error ? <Alert status="error">{error}</Alert> : null}
          <p className="text-sm text-muted-foreground">{t('property_management.common.dialogKeys', 'Esc to cancel · ⌘↵ to confirm')}</p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {refused ? t('property_management.common.close', 'Close') : t('property_management.common.cancel', 'Cancel')}
          </Button>
          {refused ? (
            canEnd ? (
              <Button type="button" onClick={onEndInstead}>{t('property_management.leases.delete.endInstead', 'End lease instead')}</Button>
            ) : null
          ) : (
            <Button type="button" variant="destructive-solid" disabled={pending} onClick={() => void confirm()}>
              {t('property_management.leases.delete.confirm', 'Delete lease')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default DeleteLeaseDialog
