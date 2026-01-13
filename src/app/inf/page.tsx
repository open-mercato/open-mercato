import Link from 'next/link'
import Image from 'next/image'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export default async function INFHome() {
  const { t } = await resolveTranslations()

  return (
    <main className="relative min-h-svh w-full overflow-hidden bg-[#0f0f0f]">
      {/* Primary gradient blob */}
      <div
        className="pointer-events-none absolute right-[5%] top-[10%] h-[600px] w-[600px] rounded-full opacity-40"
        style={{
          background: 'radial-gradient(circle, rgba(230, 126, 94, 0.4) 0%, rgba(230, 126, 94, 0.2) 40%, rgba(230, 126, 94, 0.1) 60%, transparent 70%)',
          filter: 'blur(60px)',
        }}
        aria-hidden="true"
      />

      {/* Secondary accent blob */}
      <div
        className="pointer-events-none absolute left-[10%] bottom-[20%] h-[400px] w-[400px] rounded-full opacity-30"
        style={{
          background: 'radial-gradient(circle, rgba(59, 130, 180, 0.3) 0%, rgba(59, 130, 180, 0.15) 50%, transparent 70%)',
          filter: 'blur(50px)',
        }}
        aria-hidden="true"
      />

      <div className="relative z-10 mx-auto max-w-7xl px-6 py-8 lg:px-8">
        {/* Header */}
        <header className="flex items-center justify-between">
          <Link href="/">
            <Image
              src="/fms/inf-logo.svg"
              alt="INF Shipping Solutions"
              width={120}
              height={40}
            />
          </Link>

          <Link
            href="/login"
            className="rounded-full bg-[#E67E5E] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#d9705a]"
          >
            {t('app.landing.signIn', 'Sign in')}
          </Link>
        </header>

        {/* Hero Section */}
        <section className="mt-24 max-w-2xl lg:mt-32">
          <h1 className="text-4xl tracking-tight text-white sm:text-5xl lg:text-6xl">
            <span className="font-bold">Transport services</span>
            <br />
            infinite possibilities at the lowest prices
          </h1>

          <p className="mt-6 text-lg leading-relaxed text-gray-400 sm:text-xl">
            We deliver logistics solutions that strengthen your business. You grow your business – we'll handle the logistics. Send, track and manage orders in an easy and accessible way!
          </p>

          <div className="mt-10 flex flex-wrap gap-4">
            <Link
              href="/onboarding"
              className="inline-flex items-center rounded-full border-2 border-[#E67E5E] bg-transparent px-6 py-3 text-base font-semibold text-[#E67E5E] transition-colors hover:bg-[#E67E5E] hover:text-white"
            >
              Get Started
            </Link>
            <Link
              href="/free-quote"
              className="inline-flex items-center rounded-full bg-[#E67E5E] px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-[#d9705a]"
            >
              Get a free quote
            </Link>
          </div>
        </section>

        {/* Trusted By / Partners Section */}
        <section className="mt-24 lg:mt-32">
          <div className="flex flex-wrap items-center gap-x-12 gap-y-6 opacity-60">
            <span className="text-sm font-medium uppercase tracking-wider text-gray-500">
              Built with
            </span>
            <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
              <span className="text-lg font-semibold text-gray-400">Open Mercato</span>
              <span className="text-lg font-semibold text-gray-400">Next.js</span>
              <span className="text-lg font-semibold text-gray-400">MikroORM</span>
              <span className="text-lg font-semibold text-gray-400">TypeScript</span>
            </div>
          </div>
        </section>

        {/* Quick Links - subtle footer */}
        <footer className="mt-auto pt-24 lg:pt-32">
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
            <Link href="/login" className="hover:text-gray-300 hover:underline">
              Login
            </Link>
            <span className="text-gray-600">|</span>
            <Link href="/backend" className="hover:text-gray-300 hover:underline">
              Admin Panel
            </Link>
            <span className="text-gray-600">|</span>
            <Link href="/docs/api" className="hover:text-gray-300 hover:underline">
              API Docs
            </Link>
          </div>
        </footer>
      </div>
    </main>
  )
}
