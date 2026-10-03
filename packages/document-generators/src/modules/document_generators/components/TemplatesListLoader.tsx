"use client"

import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'

export function TemplatesListLoader() {
  const t = useT()
  return <LoadingMessage label={t('document_generators.templates.loading')} />
}
