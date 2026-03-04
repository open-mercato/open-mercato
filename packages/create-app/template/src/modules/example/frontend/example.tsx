"use client"
import { useT } from '@open-mercato/shared/lib/i18n/context'

export default function ExampleFrontPage() {
  const t = useT()
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold mb-2">{t('example.moduleTitle')}</h1>
      <p className="text-muted-foreground">{t('example.publicPage')}</p>
    </div>
  )
}
