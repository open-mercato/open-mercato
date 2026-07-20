import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { MockupShareView } from '../../../mockups/components/MockupShareView'

/**
 * Public share page (spec 2026-07-05-ds-live-mockup-composer.md, Phase 2):
 * minimal frontend route with NO backend shell and NO session use — the
 * signed token in the URL is the only credential, and only the public API
 * route ever evaluates it. `noindex` via the robots meta (the API responses
 * additionally send X-Robots-Tag).
 */
export default async function MockupSharePage({
  params,
}: {
  params: Promise<{ token: string }> | { token: string }
}) {
  const { token } = await params
  const { locale, dict } = await resolveTranslations()
  return (
    <I18nProvider locale={locale} dict={dict}>
      <meta name="robots" content="noindex, nofollow" />
      <MockupShareView token={token} />
    </I18nProvider>
  )
}
