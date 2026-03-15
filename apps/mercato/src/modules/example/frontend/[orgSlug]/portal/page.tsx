"use client"
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { PortalLayout } from '../../portal/components/PortalLayout'
import { useTenantContext } from '../../portal/components/useTenantContext'

type Props = { params: { orgSlug: string } }

export default function OrgPortalLandingPage({ params }: Props) {
  const t = useT()
  const orgSlug = params.orgSlug
  const { organizationName, loading, error } = useTenantContext(orgSlug)

  if (loading) {
    return (
      <PortalLayout orgSlug={orgSlug}>
        <div className="flex items-center justify-center py-20">
          <Spinner />
        </div>
      </PortalLayout>
    )
  }

  if (error) {
    return (
      <PortalLayout orgSlug={orgSlug}>
        <div className="mx-auto w-full max-w-md py-12">
          <Notice variant="error">{t('example.portal.org.invalid')}</Notice>
        </div>
      </PortalLayout>
    )
  }

  return (
    <PortalLayout orgSlug={orgSlug} organizationName={organizationName}>
      <section className="flex flex-col items-center gap-6 py-12 text-center sm:py-20">
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          {t('example.portal.landing.hero.title')}
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          {t('example.portal.landing.hero.description')}
        </p>
        <div className="flex gap-3">
          <Button asChild size="lg">
            <Link href={`/${orgSlug}/portal/login`}>{t('example.portal.landing.cta.login')}</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href={`/${orgSlug}/portal/signup`}>{t('example.portal.landing.cta.signup')}</Link>
          </Button>
        </div>
      </section>
    </PortalLayout>
  )
}
