'use client'

import React, { useEffect, useState, type ReactNode } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { ArrowRight, ArrowUpRight, Check, Copy, Cpu, Mail, SquareTerminal } from 'lucide-react'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import Image from 'next/image'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const DOCS_URL = 'https://docs.openmercato.com'
const MODULES_URL = 'https://modules.openmercato.com'
const COMMUNITY_URL = 'https://discord.gg/f4qwPtJ3qA'
const CONTACT_EMAIL = 'info@openmercato.com'
const VIDEOS_URL = 'https://www.youtube.com/@openmercato'
const heroLinkClass = 'inline-flex min-h-11 w-fit items-center gap-2 border border-white/40 bg-start-action px-5 py-2 text-sm font-medium text-start-action-foreground hover:underline focus-visible:outline-offset-4'
const DEMO_PASSWORD = 'secret'
const AGENT_COMMAND = 'npx cezar-run'
const NEW_MODULE_COMMAND = 'npx create-mercato-module init visits'

export type StartPageDemoRole = 'superadmin' | 'admin' | 'employee'

export type StartPageDemoAccount = {
  role: StartPageDemoRole
  email?: string
}

export type StartPageSetupItem = 'email' | 'ai'

interface StartPageContentProps {
  showStartPage: boolean
  showOnboardingCta?: boolean
  demoAccounts?: StartPageDemoAccount[]
  signedIn?: boolean
  databaseReachable?: boolean
  pendingSetup?: StartPageSetupItem[]
}

type RoleDefinition = {
  descriptionKey: string
  descriptionFallback: string
  titleKey: string
  titleFallback: string
}

const ROLE_DEFINITIONS: Record<StartPageDemoRole, RoleDefinition> = {
  superadmin: {
    descriptionKey: 'startPage.roles.superAdmin.description',
    descriptionFallback: 'You see every organization, role and module.',
    titleKey: 'startPage.roles.superAdmin.title',
    titleFallback: 'Super Admin',
  },
  admin: {
    descriptionKey: 'startPage.roles.admin.description',
    descriptionFallback: 'You run one organization: its users, settings and reports.',
    titleKey: 'startPage.roles.admin.title',
    titleFallback: 'Admin',
  },
  employee: {
    descriptionKey: 'startPage.roles.employee.description',
    descriptionFallback: 'You see everyday work: your tasks and your dashboard.',
    titleKey: 'startPage.roles.employee.title',
    titleFallback: 'Employee',
  },
}

type SetupDefinition = {
  icon: typeof Mail
  docsPath: string
  titleKey: string
  titleFallback: string
  descriptionKey: string
  descriptionFallback: string
}

const SETUP_DEFINITIONS: Record<StartPageSetupItem, SetupDefinition> = {
  email: {
    icon: Mail,
    docsPath: '/installation/setup',
    titleKey: 'startPage.setup.email.title',
    titleFallback: 'Outgoing email',
    descriptionKey: 'startPage.setup.email.description',
    descriptionFallback: 'Connect an email provider to send invitations and password reset links.',
  },
  ai: {
    icon: Cpu,
    docsPath: '/user-guide/ai-assistant',
    titleKey: 'startPage.setup.ai.title',
    titleFallback: 'AI provider',
    descriptionKey: 'startPage.setup.ai.description',
    descriptionFallback: 'Add your provider’s API key to enable the AI assistant.',
  },
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timeout)
  }, [copied])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <IconButton
      className="rounded-none bg-start-action text-start-action-foreground inset-ring inset-ring-start-control-ring hover:bg-start-action hover:text-start-action-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      variant="ghost"
      size="xs"
      onClick={handleCopy}
      aria-label={copied ? t('startPage.copy.copied', 'Copied') : label}
    >
      {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
    </IconButton>
  )
}

function TerminalCommand({ value, title, description }: { value: string; title: string; description: string }) {
  const t = useT()
  return (
    <article className="grid min-w-0 gap-3">
      <h3 className="font-mono text-sm font-medium text-white"><span aria-hidden="true" className="text-white/55"># </span>{title}</h3>
      <p className="max-w-prose text-sm leading-relaxed text-white/75">{description}</p>
      <div className="mt-1 flex min-h-12 items-center gap-3 border border-white/25 bg-white/5 py-2 pl-3 pr-2 sm:pl-4 sm:pr-3">
        <span aria-hidden="true" className="select-none font-mono text-brand-lime">$</span>
        <code className="min-w-0 flex-1 break-words font-mono text-sm leading-relaxed text-white">{value}</code>
        <CopyButton value={value} label={t('startPage.copy.command', 'Copy command')} />
      </div>
    </article>
  )
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex w-fit items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
    >
      {children}
      <ArrowUpRight className="size-4" aria-hidden />
    </a>
  )
}

function demoLoginUrl(account: StartPageDemoAccount) {
  if (!account.email) return `/login?role=${account.role}`
  return `/login?role=${account.role}&email=${encodeURIComponent(account.email)}`
}

function DemoGuide({ emailPrefilled }: { emailPrefilled: boolean }) {
  const t = useT()
  return (
    <section aria-labelledby="start-title" className="isolate grid items-center gap-4 lg:grid-cols-5 overflow-hidden border-x border-b border-start-panel-border bg-start-panel p-5 text-white sm:gap-x-6 sm:p-8">
      <h1 id="start-title" className="text-3xl font-medium tracking-tight lg:col-span-3 lg:self-end sm:text-4xl">{t('startPage.guide.begin', 'Getting started')}</h1>
      <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-white/90 marker:font-medium lg:col-span-3 lg:row-start-2 lg:self-start sm:text-base">
        <li className="pl-1">
          {emailPrefilled
            ? t('startPage.guide.chooseHint', 'Choose a role below. The sign-in form opens with the email already filled in.')
            : t('startPage.guide.chooseHintNoEmail', 'Choose a role below and sign in with the email of that account.')}
        </li>
        <li className="pl-1">
          {t('startPage.guide.passwordStep', 'Sign in with the default demo password.')}
          {' '}<span className="inline-flex items-center gap-1 bg-white py-0.5 pl-3 pr-1 align-middle text-start-graphite">
            <code className="select-all font-mono text-sm">{DEMO_PASSWORD}</code>
            <CopyButton value={DEMO_PASSWORD} label={t('startPage.accounts.copyPassword', 'Copy password')} />
          </span>
        </li>
        <li className="pl-1">{t('startPage.guide.dashboardStep', 'On the dashboard, use the menu to explore the modules available to your role.')}</li>
      </ol>
      <picture className="start-logo-grid pointer-events-none w-full max-w-48 justify-self-center lg:col-span-2 lg:col-start-4 lg:row-span-2 lg:row-start-1 lg:max-w-64">
        <source media="(prefers-reduced-motion: reduce)" srcSet="/start/wire-3x3-mark.webp" />
        <Image src="/start/wire-3x3-loop.webp" alt="" width={480} height={384} loading="eager" unoptimized className="block h-auto w-full" />
      </picture>
    </section>
  )
}

function AccountCell({ account, disabled }: { account: StartPageDemoAccount; disabled: boolean }) {
  const t = useT()
  const definition = ROLE_DEFINITIONS[account.role]
  const title = t(definition.titleKey, definition.titleFallback)
  const description = disabled
    ? t('startPage.roles.superAdmin.disabledMessage', 'Not available on this instance. Install Open Mercato locally for full access.')
    : t(definition.descriptionKey, definition.descriptionFallback)

  const layout = 'flex h-full min-w-0 flex-col items-start bg-start-cell p-5 lg:p-6'
  const descriptionId = `start-role-${account.role}-description`
  const content = (
    <>
      <h3 className="text-xl font-medium leading-tight tracking-tight">{title}</h3>
      <p id={descriptionId} className="mt-2 grow text-sm leading-relaxed text-muted-foreground">{description}</p>
      {!disabled && (
        <span aria-hidden="true" className="mt-5 inline-flex min-h-9 items-center gap-2 bg-start-action px-3 py-2 text-sm font-medium text-start-action-foreground group-hover:underline">
          {t('startPage.accounts.login', 'Log in')}
          <ArrowRight className="size-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" />
        </span>
      )}
    </>
  )

  return (
    <article className="min-w-0 border-r border-b border-foreground/20">
      {disabled ? (
        <div className={layout}>{content}</div>
      ) : (
        <Link
          href={demoLoginUrl(account)}
          aria-label={t('startPage.roleTile.loginAs', 'Log in as {title}', { title })}
          aria-describedby={descriptionId}
          className={`${layout} group cursor-pointer hover:inset-ring hover:inset-ring-foreground/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground active:inset-shadow-sm`}
        >
          {content}
        </Link>
      )}
    </article>
  )
}

function getStartAction(t: ReturnType<typeof useT>, signedIn: boolean, databaseReachable: boolean, onboarding: boolean) {
  if (!databaseReachable) {
    return {
      title: t('startPage.guide.offline', 'Connect the database'),
      description: t('startPage.databaseError', 'The database is not reachable. Check DATABASE_URL and restart the app.'),
      label: t('startPage.help.documentation', 'Documentation'),
      href: `${DOCS_URL}/installation/setup`,
    }
  }
  if (signedIn) {
    return {
      title: t('startPage.guide.return', 'Return to your workspace'),
      description: t('startPage.guide.returnHint', 'You are already signed in. Open your dashboard to pick up where you left off.'),
      label: t('startPage.signedIn.cta', 'Go to the app'),
      href: '/backend',
    }
  }
  if (onboarding) {
    return {
      title: t('startPage.onboarding.title', 'Launch your own workspace'),
      description: t('startPage.guide.workspaceHint', 'Fill in the form and confirm your email within 24 hours. You’ll get an administrator account and a workspace with sample data.'),
      label: t('startPage.guide.create', 'Create a workspace'),
      href: '/onboarding',
    }
  }
  return {
    title: t('startPage.guide.signIn', 'Open your workspace'),
    description: t('startPage.guide.signInHint', 'Sign in with your work email and password to open your dashboard.'),
    label: t('startPage.accounts.login', 'Log in'),
    href: '/login',
  }
}

export function StartPageContent({
  showStartPage: initialShowStartPage,
  showOnboardingCta = false,
  demoAccounts = [],
  signedIn = false,
  databaseReachable = true,
  pendingSetup = [],
}: StartPageContentProps) {
  const t = useT()
  const [showStartPage, setShowStartPage] = useState(initialShowStartPage)

  const showAccounts = !signedIn && databaseReachable
  const hasDemoLogin = showAccounts && demoAccounts.some(({ role }) => role !== 'superadmin' || !showOnboardingCta)
  const action = getStartAction(t, signedIn, databaseReachable, showOnboardingCta)

  const handleCheckboxChange = (checked: boolean) => {
    setShowStartPage(checked)
    if (checked) {
      // Re-enable: clear the dismissal so `/` routes back here.
      document.cookie = 'start_page_dismissed=; path=/; max-age=0; SameSite=Lax'
    } else {
      // Dismiss and leave now — `/` routes to the backend (authenticated) or
      // login from here on. The `/` router reads this cookie server-side.
      document.cookie = `start_page_dismissed=1; path=/; max-age=${365 * 24 * 60 * 60}; SameSite=Lax`
      window.location.assign('/')
    }
  }

  return (
    <main className="start-page min-h-svh bg-start-page px-2 py-3 text-foreground sm:px-6 sm:py-10 lg:py-10">
      <div className="mx-auto max-w-6xl bg-background p-3 sm:p-7 lg:p-10">
        <div>
          <header className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border border-foreground/20 bg-start-surface px-4 py-2.5">
            <div className="flex items-center gap-2 text-lg font-medium tracking-tight">
              <Image src="/open-mercato.svg" alt="" width={28} height={28} priority />
              {t('app.page.title', 'Open Mercato')}
            </div>
            <nav aria-label={t('startPage.help.title', 'Help')} className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <ExternalLink href={VIDEOS_URL}>{t('startPage.help.videos', 'Video tutorials')}</ExternalLink>
              <a href={DOCS_URL} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 bg-start-action px-4 text-sm font-medium text-start-action-foreground underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
                {t('startPage.help.documentation', 'Documentation')} <ArrowUpRight aria-hidden className="size-4" />
              </a>
            </nav>
          </header>

          <div>
            {hasDemoLogin ? (
              <DemoGuide emailPrefilled={demoAccounts.every((account) => Boolean(account.email))} />
            ) : (
              <section aria-labelledby="start-title" className="space-y-4 border-x border-b border-start-panel-border bg-start-panel p-6 text-white sm:p-8">
                <h1 id="start-title" className="text-balance text-3xl font-medium tracking-tight sm:text-4xl">{action.title}</h1>
                <p role={databaseReachable ? undefined : 'alert'} className="max-w-prose leading-relaxed text-white/85">{action.description}</p>
                <Link href={action.href} className={heroLinkClass}>
                  {action.label} <ArrowRight aria-hidden className="size-4" />
                </Link>
              </section>
            )}

            {showAccounts && demoAccounts.length > 0 && (
              <section id="accounts" aria-labelledby="accounts-title">
                <h2 id="accounts-title" className="sr-only">{t('startPage.guide.choose', 'Choose a role')}</h2>
                <div className="grid border-l border-foreground/20 sm:auto-cols-fr sm:grid-flow-col">
                  {demoAccounts.map((account) => (
                    <AccountCell key={account.role} account={account} disabled={showOnboardingCta && account.role === 'superadmin'} />
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

        {hasDemoLogin && showOnboardingCta && (
          <section className="flex flex-wrap items-center justify-between gap-4 border-x border-b border-foreground/20 p-5 lg:p-6">
            <div className="max-w-prose space-y-1">
              <h2 className="text-lg font-medium tracking-tight">{action.title}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{action.description}</p>
            </div>
            <Link href={action.href} className="inline-flex min-h-10 items-center gap-2 bg-start-action px-4 text-sm font-medium text-start-action-foreground">
              {action.label} <ArrowRight aria-hidden className="size-4" />
            </Link>
          </section>
        )}

        <section aria-labelledby="next">
          <div className="space-y-2 border-x border-b border-foreground/20 p-5 sm:px-8 lg:py-6">
            <h2 id="next" className="text-2xl font-medium tracking-tight">{t('startPage.guide.build', 'Extend your local installation')}</h2>
            <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{t('startPage.guide.terminal', 'Working on the code? Run these commands in a terminal from your app folder.')}</p>
          </div>
          <div className="grid border-x border-b border-foreground/20 lg:grid-cols-12">
            <div className="min-w-0 bg-start-terminal text-white lg:col-span-7">
              <div className="flex items-center gap-2 border-b border-white/20 bg-start-terminal-bar px-5 py-3.5 font-mono text-xs sm:px-8">
                <SquareTerminal aria-hidden className="size-4" />
                {t('startPage.guide.terminalLabel', 'Terminal')}
              </div>
              <div className="grid gap-9 px-5 py-7 sm:gap-12 sm:p-8">
                <TerminalCommand value={AGENT_COMMAND}
                  title={t('startPage.next.agent.title', 'Start the coding agent')}
                  description={t('startPage.guide.agentHint', 'Open Cezar, describe one change, and let the agent work on a separate branch.')}
                />
                <TerminalCommand value={NEW_MODULE_COMMAND}
                  title={t('startPage.next.module.title', 'Build your own module')}
                  description={t('startPage.guide.moduleHint', 'This example creates a module called visits. Choose your module name, run the command, then restart the dev server.')}
                />
              </div>
            </div>
            <article className="flex min-w-0 flex-col items-start gap-4 bg-muted p-5 sm:grid sm:grid-cols-2 sm:content-center sm:items-center sm:gap-x-8 sm:p-8 lg:col-span-5 lg:flex lg:items-start">
              <div className="space-y-2">
                <h3 className="text-lg font-medium leading-tight tracking-tight">{t('startPage.next.catalog.title', 'Add a ready-made module')}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{t('startPage.next.catalog.description', 'Find one in the catalog and run its install command.')}</p>
              </div>
              <Image src="/start/catalog.svg" alt="" width={320} height={200} unoptimized className="my-auto h-auto w-full max-w-80 self-center justify-self-center start-illustration sm:col-start-2 sm:row-span-2 sm:row-start-1" />
              <ExternalLink href={MODULES_URL}>{t('startPage.next.catalog.link', 'Open the module catalog')}</ExternalLink>
            </article>
          </div>
        </section>

        {pendingSetup.length ? (
          <section aria-labelledby="setup" className="grid border-x border-b border-foreground/20 md:grid-cols-3">
            <h2 id="setup" className="grid place-items-center border-b border-foreground/20 bg-muted p-5 text-center text-2xl font-medium tracking-tight md:border-r md:border-b-0 lg:p-6">
              {t('startPage.setup.title', 'Still to set up')}
            </h2>
            <ul className="min-w-0 divide-y divide-foreground/20 md:col-span-2">
              {pendingSetup.map((item) => {
                const definition = SETUP_DEFINITIONS[item]
                const Icon = definition.icon
                return (
                  <li key={item}>
                    <a href={`${DOCS_URL}${definition.docsPath}`} target="_blank" rel="noreferrer"
                      className="group flex items-center gap-3 p-5 hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-foreground sm:gap-4 lg:p-6">
                      <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center border border-foreground/20 bg-muted">
                        <Icon className="size-5" strokeWidth={1.5} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-base font-semibold leading-tight">{t(definition.titleKey, definition.titleFallback)}</h3>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{t(definition.descriptionKey, definition.descriptionFallback)}</p>
                      </div>
                      <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium underline-offset-4 group-hover:underline">
                        <span className="sr-only lg:not-sr-only">{t('startPage.setup.link', 'Setup guide')}</span>
                        <ArrowUpRight aria-hidden className="size-4" />
                      </span>
                    </a>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="start-support-title" className="grid items-center gap-4 border-x border-b border-foreground/20 bg-start-panel p-5 text-white sm:grid-cols-3 sm:gap-8 lg:px-8 lg:py-6">
          <div className="min-w-0 space-y-3 sm:col-span-2">
            <h2 id="start-support-title" className="text-2xl font-medium tracking-tight">{t('startPage.support.title', 'Need help?')}</h2>
            <p className="max-w-prose text-sm leading-relaxed text-white/85">
              {t('startPage.support.description', 'Ask the community on Discord or email the Open Mercato team. Tell us which step you reached and what happened.')}
            </p>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <a href={COMMUNITY_URL} target="_blank" rel="noreferrer" className={heroLinkClass}>
                {t('startPage.support.discord', 'Ask on Discord')} <ArrowUpRight aria-hidden className="size-4" />
              </a>
              <a href={`mailto:${CONTACT_EMAIL}`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4 hover:decoration-2 focus-visible:outline-offset-4">{CONTACT_EMAIL}</a>
            </div>
          </div>
          <Image src="/start/support-keyboard.webp" width={640} height={460} alt="" unoptimized className="h-auto w-36 justify-self-end mix-blend-lighten sm:w-full sm:max-w-60" />
        </section>

        <footer className="flex flex-wrap items-start justify-between gap-4 border-x border-b border-foreground/20 p-5 lg:p-6">
          <div className="flex items-start gap-3">
            <Checkbox className="start-checkbox mt-0.5 rounded-none inset-ring inset-ring-start-control-ring" id="show-start-page" checked={showStartPage} aria-describedby="start-preference-hint" onCheckedChange={handleCheckboxChange} />
            <div className="grid gap-1">
              <label htmlFor="show-start-page" className="cursor-pointer text-sm">
                {t('startPage.showNextTime', 'Display this start page next time')}
              </label>
              <p id="start-preference-hint" className="text-xs text-muted-foreground">{t('startPage.guide.dismissHint', 'Turning this off opens the app or sign-in page immediately.')}</p>
            </div>
          </div>
        </footer>
      </div>
    </main>
  )
}
