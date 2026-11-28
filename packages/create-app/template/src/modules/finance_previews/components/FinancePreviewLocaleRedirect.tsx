'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'

export function FinancePreviewLocaleRedirect({ children }: { children: React.ReactNode }) {
  const t = useT()
  const started = React.useRef(false)
  const [failed, setFailed] = React.useState(false)
  const contextId = 'finance-preview-locale'
  const errorLabel = t('finance_previews.page.localeError')
  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId,
    blockedMessage: errorLabel,
  })

  React.useEffect(() => {
    if (started.current) return
    started.current = true
    const applyLocale = async () => {
      try {
        await runMutation({
          context: {
            formId: contextId,
            resourceKind: 'auth.locale',
            retryLastMutation,
          },
          mutationPayload: { locale: 'pl' },
          operation: async () => {
            const result = await apiCall('/api/auth/locale', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ locale: 'pl' }),
            })
            if (!result.ok) throw new Error(errorLabel)
          },
        })
        window.location.reload()
      } catch {
        setFailed(true)
      }
    }
    void applyLocale()
  }, [errorLabel, retryLastMutation, runMutation])

  if (failed) {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <Alert
          status="warning"
          style="stroke"
          action={
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
              {t('finance_previews.page.retry')}
            </Button>
          }
        >
          {errorLabel}
        </Alert>
        {children}
      </div>
    )
  }
  return <LoadingMessage label={t('finance_previews.page.loading')} />
}
