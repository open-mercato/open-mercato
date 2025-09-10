"use client"
import { useT } from '@/lib/i18n/context'

export default function ExampleAdminPage() {
  const t = useT()
  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold mb-2">{t('example.adminTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t('example.manageEntities')}</p>
    </div>
  )
}
