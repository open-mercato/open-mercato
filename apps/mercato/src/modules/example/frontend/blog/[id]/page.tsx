import { Suspense } from 'react'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export async function generateMetadata() {
  const { t } = await resolveTranslations()
  return {
    title: t('example.blog.overriddenTitle', 'Overridden Blog Post'),
  }
}

export default async function OverriddenBlogPost({ params }: { params: { id: string } }) {
  const { t } = await resolveTranslations()
  return (
    <section className="p-6">
      <h1 className="text-2xl font-semibold mb-2">{t('example.blog.customTitle', 'Custom Blog Post Override')}</h1>
      <p className="text-sm text-muted-foreground mb-4">{t('example.blog.overrideDescription', 'This page comes from src/modules and overrides the example package.')}</p>
      <Suspense>
        <article className="prose dark:prose-invert">
          <p>{t('example.blog.postId', 'Post id:')} <span className="font-mono">{params.id}</span></p>
          <p>{t('example.blog.removeHint', 'You can remove this file to fall back to the package implementation.')}</p>
        </article>
      </Suspense>
    </section>
  )
}

