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
import { Input } from '@open-mercato/ui/primitives/input'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import {
  fetchAssignableStaffMembers,
  type AssignableStaffMember,
} from '../../../../../components/detail/assignableStaff'

type ChangeOwnerDialogProps = {
  open: boolean
  selectedCount: number
  isSubmitting: boolean
  onClose: () => void
  onConfirm: (userId: string | null) => void
}

export function ChangeOwnerDialog({
  open,
  selectedCount,
  isSubmitting,
  onClose,
  onConfirm,
}: ChangeOwnerDialogProps): React.ReactElement {
  const t = useT()
  const [query, setQuery] = React.useState('')
  const [items, setItems] = React.useState<AssignableStaffMember[]>([])
  const [isLoading, setIsLoading] = React.useState(false)
  const [selectedUserId, setSelectedUserId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedUserId(null)
  }, [open])

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    const controller = new AbortController()
    setIsLoading(true)
    fetchAssignableStaffMembers(query, { pageSize: 50, signal: controller.signal })
      .then((next) => {
        if (cancelled) return
        setItems(next)
        if (!selectedUserId && next.length > 0) setSelectedUserId(next[0].userId)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query])

  const handleConfirm = () => {
    onConfirm(selectedUserId)
  }

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
              'customers.deals.kanban.bulk.changeOwner.title',
              'Change owner for {count} deals',
              { count: selectedCount },
            )}
          </DialogTitle>
          <DialogDescription>
            {translateWithFallback(
              t,
              'customers.deals.kanban.bulk.changeOwner.helper',
              'Pick a staff member who will own all selected deals.',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={translateWithFallback(
              t,
              'customers.deals.kanban.bulk.changeOwner.search',
              'Search by name or email…',
            )}
            autoFocus
          />
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto pr-1">
            {isLoading ? (
              <div className="flex justify-center py-4">
                <Spinner />
              </div>
            ) : items.length === 0 ? (
              <span className="px-3 py-2 text-sm text-muted-foreground">
                {translateWithFallback(
                  t,
                  'customers.deals.kanban.bulk.changeOwner.empty',
                  'No staff members found.',
                )}
              </span>
            ) : (
              items.map((member) => {
                const isSelected = selectedUserId === member.userId
                return (
                  <Button
                    variant="ghost"
                    key={member.teamMemberId}
                    type="button"
                    onClick={() => setSelectedUserId(member.userId)}
                    className={`flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      isSelected ? 'bg-muted' : ''
                    }`}
                  >
                    <Avatar label={member.displayName} size="sm" />
                    <span className="flex flex-col">
                      <span className="text-sm font-medium text-foreground">
                        {member.displayName}
                      </span>
                      {member.email ? (
                        <span className="text-xs text-muted-foreground">{member.email}</span>
                      ) : null}
                    </span>
                  </Button>
                )
              })
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} type="button" disabled={isSubmitting}>
            {translateWithFallback(t, 'customers.deals.kanban.filter.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!selectedUserId || isSubmitting}
          >
            {translateWithFallback(
              t,
              'customers.deals.kanban.bulk.changeOwner.confirm',
              'Reassign {count} deals',
              { count: selectedCount },
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default ChangeOwnerDialog
