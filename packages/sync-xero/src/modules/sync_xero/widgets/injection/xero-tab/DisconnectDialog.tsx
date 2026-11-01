"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import type { XeroOrganisationsView } from './types'

type DisconnectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedOrganisationId: string | null
  isWorking: boolean
  onConfirm: (input: { removeClientCredentials: boolean }) => Promise<void>
}

export function DisconnectDialog({ open, onOpenChange, selectedOrganisationId, isWorking, onConfirm }: DisconnectDialogProps) {
  const t = useT()
  const [otherOrganisations, setOtherOrganisations] = React.useState<string[]>([])
  const [removeClientCredentials, setRemoveClientCredentials] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setOtherOrganisations([])
    setRemoveClientCredentials(false)
    void apiCall<XeroOrganisationsView>('/api/sync_xero/organisations?scope=all', undefined, { fallback: null }).then((call) => {
      if (cancelled || !call.ok || !call.result) return
      setOtherOrganisations(
        call.result.organisations
          .filter((organisation) => organisation.xeroOrganisationId !== selectedOrganisationId)
          .map((organisation) => organisation.name),
      )
    }).catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [open, selectedOrganisationId])

  const submit = React.useCallback(() => {
    if (isWorking) return
    void onConfirm({ removeClientCredentials })
  }, [isWorking, onConfirm, removeClientCredentials])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={onKeyDown} data-testid="sync-xero-disconnect-dialog">
        <DialogHeader>
          <DialogTitle>{t('sync_xero.disconnect.title')}</DialogTitle>
          <DialogDescription>{t('sync_xero.disconnect.description')}</DialogDescription>
        </DialogHeader>
        <Alert status="warning">
          <AlertDescription>{t('sync_xero.disconnect.revokeReach')}</AlertDescription>
        </Alert>
        {otherOrganisations.length > 0 ? (
          <Alert status="warning">
            <AlertDescription>
              {t('sync_xero.disconnect.otherOrganisations', { names: otherOrganisations.join(', ') })}
            </AlertDescription>
          </Alert>
        ) : null}
        <CheckboxField
          label={t('sync_xero.disconnect.removeClientCredentials')}
          description={t('sync_xero.disconnect.removeClientCredentialsHelp')}
          checked={removeClientCredentials}
          onCheckedChange={(checked) => setRemoveClientCredentials(checked === true)}
        />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('sync_xero.disconnect.cancel')}
          </Button>
          <Button type="button" variant="destructive-solid" onClick={submit} disabled={isWorking}>
            {t('sync_xero.disconnect.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
