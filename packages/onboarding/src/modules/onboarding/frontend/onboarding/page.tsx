import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import OnboardingPageClient from './OnboardingPageClient'

export default function OnboardingPage() {
  const onboardingEnabled = parseBooleanToken(process.env.SELF_SERVICE_ONBOARDING_ENABLED ?? '') === true

  return <OnboardingPageClient onboardingEnabled={onboardingEnabled} />
}
