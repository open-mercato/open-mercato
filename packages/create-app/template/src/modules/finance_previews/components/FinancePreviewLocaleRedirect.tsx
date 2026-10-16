'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'

export function FinancePreviewLocaleRedirect() {
  const t = useT()
  const started = React.useRef(false)
  React.useEffect(() => {
    if (started.current) return
    started.current = true
    const { pathname, search, hash } = window.location
    const query = new URLSearchParams({
      locale: 'pl',
      redirect: pathname + search + hash,
    })
    window.location.replace(`/api/auth/locale?${query}`)
  }, [])

  return <LoadingMessage label={t('finance_previews.page.loading')} />
}
