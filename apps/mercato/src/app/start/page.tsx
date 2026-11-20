import { modules } from '@/.mercato/generated/modules.app.generated'
import {
  StartPageContent,
  type StartPageDemoAccount,
  type StartPageSetupItem,
} from '@/components/StartPageContent'
import { resolveDemoUserEmails } from '@open-mercato/core/modules/auth/lib/setup-app'
import type { Metadata } from 'next'
import { resolveLocalizedAppMetadata } from '@/lib/metadata'
import { cookies } from 'next/headers'
import { bootstrap } from '@/bootstrap'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { isEmailDeliveryConfigured } from '@open-mercato/shared/lib/email/config'
import { getAuthFromCookies } from '@open-mercato/shared/lib/auth/server'
import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'

// Every other route that builds a request container bootstraps first, and this page needs it
// twice over: `createRequestContainer` throws outright until `registerDiRegistrars` has run, and
// the email transport `isEmailDeliveryConfigured` reads is registered by a module's DI
// `register()`. Without this the process's first request answers `/start` with the database
// reported as unreachable and the onboarding CTA hidden on a fully configured instance, then
// silently corrects itself once any API route bootstraps the process (#5817).
bootstrap()

export async function generateMetadata(): Promise<Metadata> {
  return resolveLocalizedAppMetadata()
}

async function isDatabaseReachable(): Promise<boolean> {
  try {
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
    await em.count(User, {})
    return true
  } catch {
    return false
  }
}

function resolvePendingSetup(emailConfigured: boolean): StartPageSetupItem[] {
  const pending: StartPageSetupItem[] = []
  if (!emailConfigured) pending.push('email')
  const aiAssistantEnabled = modules.some((module) => module.id === 'ai_assistant')
  if (aiAssistantEnabled && llmProviderRegistry.listConfigured().length === 0) pending.push('ai')
  return pending
}

export default async function StartPage() {
  // The checkbox reflects whether this start page is the default landing (the
  // `/` router honors the dismissal cookie); visiting /start always renders it.
  const cookieStore = await cookies()
  const showStartPage = cookieStore.get('start_page_dismissed')?.value !== '1'

  const emailConfigured = isEmailDeliveryConfigured()
  const onboardingAvailable =
    process.env.SELF_SERVICE_ONBOARDING_ENABLED === 'true' &&
    emailConfigured &&
    Boolean(process.env.APP_URL && process.env.APP_URL.trim())

  const demoAccounts: StartPageDemoAccount[] = resolveDemoUserEmails().map((entry) => ({
    role: entry.role,
    email: entry.email,
  }))

  const auth = await getAuthFromCookies()

  return (
    <StartPageContent
      showStartPage={showStartPage}
      showOnboardingCta={onboardingAvailable}
      demoAccounts={demoAccounts}
      signedIn={Boolean(auth)}
      databaseReachable={await isDatabaseReachable()}
      pendingSetup={resolvePendingSetup(emailConfigured)}
    />
  )
}
