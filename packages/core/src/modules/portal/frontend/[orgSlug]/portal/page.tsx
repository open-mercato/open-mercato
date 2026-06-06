"use client"
import { useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { SearchX, ShoppingBag, User, Shield } from 'lucide-react'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { PortalFeatureCard } from '@open-mercato/ui/portal/components/PortalFeatureCard'
import { InjectionSpot } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { PortalInjectionSpots } from '@open-mercato/ui/backend/injection/spotIds'

type Props = { params: { orgSlug: string } }

export default function PortalLandingPage({ params }: Props) {
  const t = useT()
  const router = useRouter()
  const orgSlug = params.orgSlug
  const { auth, tenant } = usePortalContext()

  // Redirect authenticated users to dashboard
  useEffect(() => {
    if (!auth.loading && auth.user) {
      router.replace(`/${orgSlug}/portal/dashboard`)
    }
  }, [auth.loading, auth.user, router, orgSlug])

  const injectionContext = useMemo(
    () => ({ orgSlug }),
    [orgSlug],
  )

  if (auth.loading || tenant.loading) {
    return <div className="flex items-center justify-center py-20"><Spinner /></div>
  }

  if (tenant.error) {
    return (
      <div className="mx-auto w-full max-w-md py-12">
        <EmptyState
          variant="subtle"
          size="lg"
          icon={<SearchX className="h-6 w-6" aria-hidden />}
          title={t('portal.org.invalid', 'Organization not found.')}
        />
      </div>
    )
  }

  // Authenticated user — redirect is in progress
  if (auth.user) return null

  return (
    <>
      <InjectionSpot spotId={PortalInjectionSpots.pageBefore('home')} context={injectionContext} />

      <section className="flex flex-col items-center gap-5 py-8 text-center sm:py-16">
        <p className="text-overline font-semibold uppercase tracking-widest text-muted-foreground/60">
          {t('portal.nav.home', 'Customer Portal')}
        </p>
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
          {t('portal.landing.hero.title', 'Welcome to your portal')}
        </h1>
        <p className="max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">
          {t('portal.landing.hero.description', 'Access your account, manage orders, and stay up to date.')}
        </p>
        <div className="mt-2 flex items-center gap-3">
          <Button asChild size="lg" className="rounded-lg px-6 text-sm">
            <Link href={`/${orgSlug}/portal/login`}>{t('portal.landing.cta.login', 'Sign In')}</Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="rounded-lg px-6 text-sm">
            <Link href={`/${orgSlug}/portal/signup`}>{t('portal.landing.cta.signup', 'Create Account')}</Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <PortalFeatureCard
          icon={<ShoppingBag className="size-5" />}
          title={t('portal.landing.feature.orders', 'Orders & Invoices')}
          description={t('portal.landing.feature.orders.description', 'Track your orders, download invoices, and view delivery status in real time.')}
        />
        <PortalFeatureCard
          icon={<User className="size-5" />}
          title={t('portal.landing.feature.account', 'Account Management')}
          description={t('portal.landing.feature.account.description', 'Update your profile, manage team members, and configure your preferences.')}
        />
        <PortalFeatureCard
          icon={<Shield className="size-5" />}
          title={t('portal.landing.feature.security', 'Secure Access')}
          description={t('portal.landing.feature.security.description', 'Role-based permissions, session management, and full audit trail.')}
        />
      </section>

      <InjectionSpot spotId={PortalInjectionSpots.pageAfter('home')} context={injectionContext} />
    </>
  )
}
