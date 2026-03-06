import type { Metadata } from 'next'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export async function resolveLocalizedAppMetadata(): Promise<Metadata> {
  const { t } = await resolveTranslations()
  return {
    title: t('app.metadata.title', 'Open Mercato'),
    description: t(
      'app.metadata.description',
      'AI-supportive, modular ERP foundation for product & service companies',
    ),
  }
}

export async function resolveLocalizedTitleMetadata(input: {
  title?: string | null
  titleKey?: string | null
  fallback?: string
}): Promise<Metadata> {
  const { t } = await resolveTranslations()
  const fallbackTitle = input.title || input.fallback || 'Open Mercato'
  return {
    title: input.titleKey ? t(input.titleKey, fallbackTitle) : fallbackTitle,
  }
}
