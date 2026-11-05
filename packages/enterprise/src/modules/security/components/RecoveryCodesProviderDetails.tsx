'use client'

import * as React from 'react'
import { AlertTriangle, ClipboardCopy, Download, Loader2, Printer } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { useMfaStatus } from './hooks/useMfaStatus'

function splitIntoColumns(codes: string[]): [string[], string[]] {
  const middle = Math.ceil(codes.length / 2)
  return [codes.slice(0, middle), codes.slice(middle)]
}

export default function RecoveryCodesProviderDetails() {
  const t = useT()
  const { saving, recoveryCodes, regenerateRecoveryCodes } = useMfaStatus()

  const [leftCodes, rightCodes] = React.useMemo(() => splitIntoColumns(recoveryCodes), [recoveryCodes])
  const joinedCodes = React.useMemo(() => recoveryCodes.join('\n'), [recoveryCodes])

  const handleGenerate = React.useCallback(async () => {
    await regenerateRecoveryCodes()
    flash(t('security.profile.mfa.recovery.regenerated', 'Recovery codes regenerated.'), 'success')
  }, [regenerateRecoveryCodes, t])

  const handleCopy = React.useCallback(async () => {
    if (!joinedCodes) return
    try {
      await navigator.clipboard.writeText(joinedCodes)
      flash(t('security.profile.mfa.recovery.copySuccess', 'Recovery codes copied.'), 'success')
    } catch {
      flash(t('security.profile.mfa.recovery.copyError', 'Unable to copy recovery codes.'), 'error')
    }
  }, [joinedCodes, t])

  const handleDownload = React.useCallback(() => {
    if (!joinedCodes) return
    const blob = new Blob([joinedCodes], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'open-mercato-recovery-codes.txt'
    anchor.click()
    URL.revokeObjectURL(url)
  }, [joinedCodes])

  const handlePrint = React.useCallback(() => {
    if (!joinedCodes) return
    const printWindow = window.open('', '_blank', 'noopener,noreferrer')
    if (!printWindow) return
    printWindow.document.write(`<pre>${joinedCodes}</pre>`)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
    printWindow.close()
  }, [joinedCodes])

  return (
    <section className="space-y-4 rounded-lg border border-slate-800 bg-slate-950 p-6 text-slate-100">
      <section className="space-y-0 overflow-hidden rounded-lg border border-slate-800">

        <div className="space-y-4 bg-slate-950 p-4">
          {recoveryCodes.length > 0 ? (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <ul className="space-y-2 pl-7">
                  {leftCodes.map((code) => (
                    <li key={`left:${code}`} className="font-mono text-sm text-slate-100">{code}</li>
                  ))}
                </ul>
                <ul className="space-y-2 pl-7">
                  {rightCodes.map((code) => (
                    <li key={`right:${code}`} className="font-mono text-sm text-slate-100">{code}</li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="outline" className="h-10 border-slate-700 bg-slate-800" onClick={handleDownload}>
                  <Download className="mr-2 size-4" aria-hidden />
                  {t('security.profile.mfa.recovery.downloadAction', 'Download')}
                </Button>
                <Button type="button" variant="outline" className="h-10 border-slate-700 bg-slate-800" onClick={handlePrint}>
                  <Printer className="mr-2 size-4" aria-hidden />
                  {t('security.profile.mfa.recovery.print', 'Print')}
                </Button>
                <Button type="button" variant="outline" className="h-10 border-slate-700 bg-slate-800" onClick={handleCopy}>
                  <ClipboardCopy className="mr-2 size-4" aria-hidden />
                  {t('security.profile.mfa.recovery.copyAction', 'Copy')}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-300">
              {t(
                'security.profile.mfa.recovery.emptyState',
                'Generate a new set of recovery codes to view and save them.',
              )}
            </p>
          )}
        </div>
      </section>

      <section className="space-y-2 border-t border-slate-800 pt-4">
        <h3 className="text-base font-semibold">
          {t('security.profile.mfa.recovery.generateTitle', 'Generate new recovery codes')}
        </h3>
        <p className="max-w-3xl text-sm text-slate-300">
          {t(
            'security.profile.mfa.recovery.generateDescription',
            "When you generate new recovery codes, your old codes won't work anymore.",
          )}
        </p>
        <Button type="button" className="mt-3 h-10" onClick={() => void handleGenerate()} disabled={saving}>
          {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {t('security.profile.mfa.recovery.regenerate', 'Generate new recovery codes')}
        </Button>
      </section>
    </section>
  )
}
