"use client"

import * as React from 'react'
import { UserCircle2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { DealOwnerSelect } from '../../../../components/detail/DealOwnerSelect'

export type ReassignOwnerDialogProps = {
  open: boolean
  selectedCount: number
  isSubmitting: boolean
  onClose: () => void
  onConfirm: (userId: string) => void
}

/**
 * Bulk owner reassignment for the deals list. Built on the shared `DealOwnerSelect`, so it
 * inherits the no-unassignment contract: `onConfirm` only ever receives a real user id.
 */
export function ReassignOwnerDialog({
  open,
  selectedCount,
  isSubmitting,
  onClose,
  onConfirm,
}: ReassignOwnerDialogProps): React.ReactElement {
  const t = useT()
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setSelectedUserId(null)
  }, [open])

  const handleConfirm = React.useCallback(() => {
    if (!selectedUserId) return
    onConfirm(selectedUserId)
  }, [onConfirm, selectedUserId])

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      handleConfirm()
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isSubmitting) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCircle2 className="size-4" aria-hidden="true" />
            {translateWithFallback(
              t,
              'customers.deals.list.bulkReassignOwner.title',
              'Reassign owner for {count} deals',
              { count: selectedCount },
            )}
          </DialogTitle>
          <DialogDescription>
            {translateWithFallback(
              t,
              'customers.deals.list.bulkReassignOwner.helper',
              'Pick a staff member who will own all selected deals.',
            )}
          </DialogDescription>
        </DialogHeader>

        <DealOwnerSelect
          value={selectedUserId}
          onChange={(next) => setSelectedUserId(next)}
          disabled={isSubmitting}
        />

        <DialogFooter>
          <Button variant="outline" onClick={onClose} type="button" disabled={isSubmitting}>
            {translateWithFallback(t, 'customers.deals.list.bulkReassignOwner.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!selectedUserId || isSubmitting}>
            {translateWithFallback(
              t,
              'customers.deals.list.bulkReassignOwner.confirm',
              'Reassign {count} deals',
              { count: selectedCount },
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ReassignOwnerDialog
