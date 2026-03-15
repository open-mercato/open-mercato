"use client"
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { PortalShell } from '@open-mercato/ui/portal/PortalShell'
import { useTenantContext } from '@open-mercato/ui/portal/hooks/useTenantContext'
import { PortalFeatureCard } from '@open-mercato/ui/portal/components/PortalFeatureCard'

type Props = { params: { orgSlug: string } }

function ShoppingBagIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><line x1="3" x2="21" y1="6" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  )
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </svg>
  )
}

export default function PortalLandingPage({ params }: Props) {
  const t = useT()
  const orgSlug = params.orgSlug
  const { organizationName, loading, error } = useTenantContext(orgSlug)

  if (loading) {
    return (
      <PortalShell orgSlug={orgSlug}>
        <div className="flex items-center justify-center py-20">
          <Spinner />
        </div>
      </PortalShell>
    )
  }

  if (error) {
    return (
      <PortalShell orgSlug={orgSlug}>
        <div className="mx-auto w-full max-w-md py-12">
          <Notice variant="error">{t('portal.org.invalid', 'Organization not found.')}</Notice>
        </div>
      </PortalShell>
    )
  }

  return (
    <PortalShell orgSlug={orgSlug} organizationName={organizationName}>
      {/* Hero */}
      <section className="flex flex-col items-center gap-5 py-8 text-center sm:py-16">
        <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-muted-foreground/60">
          {t('portal.nav.home', 'Customer Portal')}
        </p>
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
          {t('portal.landing.hero.title', 'Welcome to your portal')}
        </h1>
        <p className="max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">
          {t('portal.landing.hero.description', 'Access your account, manage orders, and stay up to date.')}
        </p>
        <div className="mt-2 flex items-center gap-3">
          <Button asChild size="lg" className="rounded-lg px-6 text-[14px]">
            <Link href={`/${orgSlug}/portal/login`}>{t('portal.landing.cta.login', 'Sign In')}</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="rounded-lg px-6 text-[14px]">
            <Link href={`/${orgSlug}/portal/signup`}>{t('portal.landing.cta.signup', 'Create Account')}</Link>
          </Button>
        </div>
      </section>

      {/* Feature cards — matching landing page 3-column grid */}
      <section className="grid gap-4 sm:grid-cols-3">
        <PortalFeatureCard
          icon={<ShoppingBagIcon className="size-5" />}
          title={t('portal.landing.feature.orders', 'Orders & Invoices')}
          description={t('portal.landing.feature.orders.description', 'Track your orders, download invoices, and view delivery status in real time.')}
        />
        <PortalFeatureCard
          icon={<UserIcon className="size-5" />}
          title={t('portal.landing.feature.account', 'Account Management')}
          description={t('portal.landing.feature.account.description', 'Update your profile, manage team members, and configure your preferences.')}
        />
        <PortalFeatureCard
          icon={<ShieldIcon className="size-5" />}
          title={t('portal.landing.feature.security', 'Secure Access')}
          description={t('portal.landing.feature.security.description', 'Role-based permissions, session management, and full audit trail.')}
        />
      </section>
    </PortalShell>
  )
}
