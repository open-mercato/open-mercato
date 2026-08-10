'use client'

import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export function Loader() {
  const t = useT()

  return (
    <div className="flex flex-col items-center gap-2 text-muted-foreground">
      <Spinner />
      <p className="text-sm">{t('document_generators.templates.loading', 'Loading data...')}</p>
    </div>
  )
}
