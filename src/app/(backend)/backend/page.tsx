import { detectLocale, loadDictionary } from '@/lib/i18n/server'
import { getAuthFromCookies } from '@/lib/auth/server'
import { redirect } from 'next/navigation'

export default async function BackendIndex() {
  // Only require authentication, no specific roles
  const auth = await getAuthFromCookies()
  if (!auth) redirect('/api/auth/session/refresh?redirect=/backend')
  
  const locale = await detectLocale()
  const dict = await loadDictionary(locale)
  const t = (k: string) => dict[k] ?? k
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-2">{t('backend.title')}</h1>
      <p className="text-muted-foreground">{t('backend.selectModule')}</p>
    </div>
  )
}
