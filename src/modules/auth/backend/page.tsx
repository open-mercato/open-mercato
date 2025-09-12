"use client"
import { useT } from '@/lib/i18n/context'
export default function AuthAdminPage() {
  const t = useT()
  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold mb-2">{t('auth.usersRoles')}</h2>
      <p className="text-sm text-muted-foreground">{t('auth.manageAuthSettings')}</p>
    </div>
  )
}
