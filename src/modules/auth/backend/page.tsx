"use client"
import { useT } from '@/lib/i18n/context'

export const requireAuth = true
export const pageTitle = 'Users & Roles'
export const pageGroup = 'Auth'
export default function AuthAdminPage() {
  const t = useT()
  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold mb-2">{t('auth.usersRoles')}</h2>
      <p className="text-sm text-muted-foreground">{t('auth.manageAuthSettings')}</p>
    </div>
  )
}
