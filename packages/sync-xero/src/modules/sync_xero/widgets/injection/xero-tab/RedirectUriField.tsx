"use client"

import * as React from 'react'
import { Copy } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ButtonInput } from '@open-mercato/ui/primitives/button-input'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Label } from '@open-mercato/ui/primitives/label'

export function RedirectUriField({ redirectUri }: { redirectUri: string | null }) {
  const t = useT()
  const inputId = React.useId()

  const copy = React.useCallback(async () => {
    if (!redirectUri) return
    try {
      await navigator.clipboard.writeText(redirectUri)
      flash(t('sync_xero.tab.redirectUri.copied'), 'success')
    } catch {
      flash(t('sync_xero.tab.redirectUri.copyFailed'), 'error')
    }
  }, [redirectUri, t])

  return (
    <div className="space-y-1.5">
      <Label htmlFor={inputId}>{t('sync_xero.tab.redirectUri.label')}</Label>
      <ButtonInput
        id={inputId}
        readOnly
        value={redirectUri ?? t('sync_xero.tab.redirectUri.unavailable')}
        trailingAction={
          <IconButton
            type="button"
            variant="ghost"
            size="default"
            aria-label={t('sync_xero.tab.redirectUri.copy')}
            disabled={!redirectUri}
            onClick={() => void copy()}
          >
            <Copy />
          </IconButton>
        }
      />
      <p className="text-xs text-muted-foreground">{t('sync_xero.tab.redirectUri.help')}</p>
    </div>
  )
}
