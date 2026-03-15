"use client"
import type { ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'

type PortalLayoutProps = {
  children: ReactNode
  orgSlug?: string
  organizationName?: string
  authenticated?: boolean
  onLogout?: () => void
}

export function PortalLayout({ children, orgSlug, organizationName, authenticated, onLogout }: PortalLayoutProps) {
  const t = useT()

  const portalHome = orgSlug ? `/${orgSlug}/portal` : '/portal'
  const loginHref = orgSlug ? `/${orgSlug}/portal/login` : '/portal/login'
  const signupHref = orgSlug ? `/${orgSlug}/portal/signup` : '/portal/signup'
  const dashboardHref = orgSlug ? `/${orgSlug}/portal/dashboard` : '/portal/dashboard'
  const headerTitle = organizationName || t('example.portal.title')

  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <header className="border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex w-full max-w-screen-lg items-center justify-between px-6 py-4">
          <Link
            href={portalHome}
            className="flex items-center gap-3 text-foreground transition hover:text-primary"
            aria-label={headerTitle}
          >
            <Image
              src="/open-mercato.svg"
              alt="Open Mercato logo"
              width={32}
              height={32}
              className="dark:invert"
              priority
            />
            <span className="text-base font-semibold tracking-tight">
              {headerTitle}
            </span>
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-2">
            {authenticated ? (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link href={dashboardHref}>{t('example.portal.nav.dashboard')}</Link>
                </Button>
                <Button variant="ghost" size="sm" onClick={onLogout}>
                  {t('example.portal.nav.logout')}
                </Button>
              </>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link href={loginHref}>{t('example.portal.nav.login')}</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href={signupHref}>{t('example.portal.nav.signup')}</Link>
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto flex w-full max-w-screen-lg flex-col gap-6 px-6 py-10 sm:py-16">
          {children}
        </div>
      </main>

      <footer className="border-t bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex w-full max-w-screen-lg flex-col gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <Link
            href={portalHome}
            className="flex items-center gap-2 text-muted-foreground transition hover:text-foreground"
            aria-label="Open Mercato"
          >
            <Image src="/open-mercato.svg" alt="Open Mercato logo" width={28} height={28} className="dark:invert" />
            <span className="font-medium text-foreground">Open Mercato</span>
          </Link>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link className="transition hover:text-foreground" href={portalHome}>
              {t('example.portal.nav.home')}
            </Link>
            <Link className="transition hover:text-foreground" href={loginHref}>
              {t('example.portal.nav.login')}
            </Link>
            <Link className="transition hover:text-foreground" href="/terms">
              Terms
            </Link>
            <Link className="transition hover:text-foreground" href="/privacy">
              Privacy
            </Link>
          </div>
          <p className="text-xs text-muted-foreground/80 sm:text-right">
            {t('example.portal.footer.copyright', { year: new Date().getFullYear().toString() })}
          </p>
        </div>
      </footer>
    </div>
  )
}

export default PortalLayout
