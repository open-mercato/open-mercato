import Link from 'next/link'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export default async function Home() {
  const { t } = await resolveTranslations()

  return (
    <main className="relative min-h-svh w-full overflow-hidden bg-gradient-to-br from-blue-50 via-white to-blue-100/50">
      {/* Blue gradient blob */}
      <div
        className="pointer-events-none absolute right-[5%] top-[10%] h-[600px] w-[600px] rounded-full opacity-70"
        style={{
          background: 'radial-gradient(circle, rgba(59, 130, 246, 0.5) 0%, rgba(147, 197, 253, 0.4) 40%, rgba(191, 219, 254, 0.2) 60%, transparent 70%)',
          filter: 'blur(40px)',
        }}
        aria-hidden="true"
      />

      {/* Secondary accent blob */}
      <div
        className="pointer-events-none absolute right-[10%] top-[25%] h-[400px] w-[400px] rounded-full opacity-60"
        style={{
          background: 'radial-gradient(circle, rgba(99, 102, 241, 0.4) 0%, rgba(165, 180, 252, 0.3) 50%, transparent 70%)',
          filter: 'blur(50px)',
        }}
        aria-hidden="true"
      />

      <div className="relative z-10 mx-auto max-w-7xl px-6 py-8 lg:px-8">
        {/* Header */}
        <header className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <img
              src="https://images.prismic.io/freight-tech-cms/aMEwrWGNHVfTO9Qd_FreightTech.orgsygnet.png?auto=format,compress"
              alt={t('app.page.logoAlt', 'FTO')}
              className="h-12 w-auto"
            />
            <span className="text-xl font-bold tracking-tight text-gray-900">FreightTech.org</span>
          </Link>

          <Link
            href="/login"
            className="rounded-full bg-gray-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800"
          >
            {t('app.landing.signIn', 'Sign in')}
          </Link>
        </header>

        {/* Hero Section */}
        <section className="mt-24 max-w-2xl lg:mt-32">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
            {t('app.landing.headline', 'AI-powered, open source freight management system.')}
          </h1>

          <p className="mt-6 text-lg leading-relaxed text-gray-600 sm:text-xl">
            {t('app.landing.subheadline', 'We help logistics teams streamline their operations and gain full visibility. One centralized platform powering shipment tracking, carrier management, route optimization, and beyond.')}
          </p>

          <div className="mt-10">
            <Link
              href="/onboarding"
              className="inline-flex items-center rounded-full border-2 border-gray-900 bg-transparent px-6 py-3 text-base font-semibold text-gray-900 transition-colors hover:bg-gray-900 hover:text-white"
            >
              {t('app.landing.cta', 'Get Started')}
            </Link>
          </div>
        </section>

        {/* Trusted By / Partners Section */}
        <section className="mt-24 lg:mt-32">
          <div className="flex flex-wrap items-center gap-x-12 gap-y-6 opacity-60">
            <span className="text-sm font-medium uppercase tracking-wider text-gray-500">
              {t('app.landing.builtWith', 'Built with')}
            </span>
            <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
              <span className="text-lg font-semibold text-gray-700">Open Mercato</span>
              <span className="text-lg font-semibold text-gray-700">Next.js</span>
              <span className="text-lg font-semibold text-gray-700">MikroORM</span>
              <span className="text-lg font-semibold text-gray-700">TypeScript</span>
            </div>
          </div>
        </section>

        {/* Quick Links - subtle footer */}
        <footer className="mt-auto pt-24 lg:pt-32">
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
            <Link href="/login" className="hover:text-gray-700 hover:underline">
              {t('app.page.quickLinks.login', 'Login')}
            </Link>
            <span className="text-gray-300">|</span>
            <Link href="/backend" className="hover:text-gray-700 hover:underline">
              {t('app.landing.adminPanel', 'Admin Panel')}
            </Link>
            <span className="text-gray-300">|</span>
            <Link href="/docs/api" className="hover:text-gray-700 hover:underline">
              {t('app.landing.apiDocs', 'API Docs')}
            </Link>
          </div>
        </footer>
      </div>
    </main>
  )
}
