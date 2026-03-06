'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'

type RecoveryCodesDisplayProps = {
  codes: string[]
  title?: string
}

export default function RecoveryCodesDisplay({ codes, title }: RecoveryCodesDisplayProps) {
  const t = useT()

  const joinedCodes = React.useMemo(() => codes.join('\n'), [codes])

  const copyCodes = React.useCallback(async () => {
    if (!joinedCodes) return
    try {
      await navigator.clipboard.writeText(joinedCodes)
      flash(t('security.profile.mfa.recovery.copySuccess', 'Recovery codes copied.'), 'success')
    } catch {
      flash(t('security.profile.mfa.recovery.copyError', 'Unable to copy recovery codes.'), 'error')
    }
  }, [joinedCodes, t])

  const downloadCodes = React.useCallback(() => {
    if (!joinedCodes) return
    const blob = new Blob([joinedCodes], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'open-mercato-recovery-codes.txt'
    anchor.click()
    URL.revokeObjectURL(url)
  }, [joinedCodes])

  if (codes.length === 0) return null

  return (
    <section className="space-y-3 rounded-md border border-amber-400/50 bg-amber-50 p-4">
      <h3 className="text-sm font-semibold text-amber-900">
        {title ?? t('security.profile.mfa.recovery.title', 'Recovery codes')}
      </h3>
      <p className="text-xs text-amber-800">
        {t('security.profile.mfa.recovery.warning', 'Store these codes in a safe place. You will not be able to view them again.')}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {codes.map((code) => (
          <code key={code} className="rounded border bg-white px-2 py-1.5 text-sm">
            {code}
          </code>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={copyCodes}>
          {t('security.profile.mfa.recovery.copy', 'Copy all')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={downloadCodes}>
          {t('security.profile.mfa.recovery.download', 'Download .txt')}
        </Button>
      </div>
    </section>
  )
}
