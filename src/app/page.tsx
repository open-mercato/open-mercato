import { Button } from '@/components/ui/button'
import { getDb } from '@/db'
import { users } from '@/db/schema'
import { detectLocale, loadDictionary } from '@/lib/i18n/server'

export default async function Home() {
  const locale = detectLocale()
  const dict = await loadDictionary(locale)
  const t = (k: string, params?: Record<string,string|number>) => {
    const s = dict[k] ?? k
    return s.replace(/\{(\w+)\}/g, (_, kk) => String(params?.[kk] ?? `{${kk}}`))
  }
  let status: string;
  try {
    // Simple query to validate DB connectivity
    const db = getDb();
    const result = await db.select({ count: users.id }).from(users).limit(1);
    status = `Połączenie z DB OK. Tabela users gotowa.`;
  } catch (e: any) {
    status = `DB niegotowa: ${e?.message ?? 'brak połączenia'}`;
  }

  return (
    <main className="min-h-svh w-full p-8 flex flex-col items-start gap-6">
      <h1 className="text-2xl font-semibold">{t('app.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('app.status', { status })}</p>
      <div className="flex gap-3">
        <Button>Przycisk shadcn</Button>
        <Button variant="secondary">Secondary</Button>
      </div>
      <div className="text-sm mt-6">
        <a className="underline" href="/login">{t('app.goToLogin')}</a>
        <span className="mx-2">·</span>
        <a className="underline" href="/example">{t('app.examplePage')}</a>
        <span className="mx-2">·</span>
        <a className="underline" href="/backend/example">{t('app.exampleAdmin')}</a>
        <span className="mx-2">·</span>
        <a className="underline" href="/blog/123">{t('app.exampleBlogPost')}</a>
      </div>
    </main>
  );
}
