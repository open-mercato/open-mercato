"use client"

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import {
  SHARE_PERMISSIONS,
  readPermission,
  type DocumentSharePermission,
  type ShareRow,
} from './shareDialogModel'

type ShareDialogListProps = {
  shares: ShareRow[]
  isLoading: boolean
  error: string | null
  canManage: boolean
  pendingShareIds: ReadonlySet<string>
  onRetry?: () => void
  onPermissionChange: (share: ShareRow, permission: DocumentSharePermission) => Promise<void>
  onRemove: (share: ShareRow) => Promise<void>
}

export function ShareDialogList({
  shares,
  isLoading,
  error,
  canManage,
  pendingShareIds,
  onRetry,
  onPermissionChange,
  onRemove,
}: ShareDialogListProps) {
  const t = useT()

  return (
    <div className="space-y-4">
      {!canManage ? (
        <Alert status="information" size="sm">
          {t('documents.share.dialog.readOnly')}
        </Alert>
      ) : null}

      {isLoading ? (
        <LoadingMessage label={t('documents.share.dialog.loading')} />
      ) : error ? (
        <ErrorMessage
          label={error}
          action={onRetry ? <Button type="button" size="sm" variant="outline" onClick={onRetry}>{t('documents.actions.retry')}</Button> : undefined}
        />
      ) : shares.length === 0 ? (
        <p className="rounded border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
          {t('documents.share.dialog.empty')}
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium">{t('documents.share.dialog.current')}</p>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {shares.map((share) => {
              const isPending = pendingShareIds.has(share.id)
              const principalTypeLabel = t(`documents.share.principalTypes.${share.principalType}`)
              const permissionLabel = t('documents.share.dialog.permission')
              const removeLabel = t('documents.actions.unshare')
              return (
                <div
                  key={share.id}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 md:flex-row md:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={share.principalLabel}>
                      {share.principalLabel}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {share.principalSecondary
                        ? `${principalTypeLabel} — ${share.principalSecondary}`
                        : principalTypeLabel}
                    </p>
                  </div>
                  <div className="shrink-0 md:w-48">
                    <Select
                      value={share.permission}
                      onValueChange={(value) => void onPermissionChange(share, readPermission(value))}
                      disabled={!canManage || isPending}
                    >
                      <SelectTrigger aria-label={`${permissionLabel}: ${share.principalLabel}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SHARE_PERMISSIONS.map((tier) => (
                          <SelectItem key={tier} value={tier}>
                            {t(`documents.permissions.${tier}`)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="destructive-outline"
                    className="shrink-0"
                    aria-label={`${removeLabel}: ${share.principalLabel}`}
                    onClick={() => void onRemove(share)}
                    disabled={!canManage || isPending}
                  >
                    {removeLabel}
                  </Button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
