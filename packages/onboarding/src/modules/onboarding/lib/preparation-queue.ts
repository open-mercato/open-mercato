import { createModuleQueue, type Queue } from '@open-mercato/queue'

export const ONBOARDING_PREPARATION_QUEUE = 'onboarding-preparation'
export const ONBOARDING_PREPARATION_WORKER_ID = 'onboarding:preparation'

export type OnboardingPreparationJobPayload = {
  requestId: string
  tenantId: string
  organizationId: string
}

let queue: Queue<OnboardingPreparationJobPayload> | null = null

export function getOnboardingPreparationQueue(): Queue<OnboardingPreparationJobPayload> {
  if (queue) return queue
  queue = createModuleQueue<OnboardingPreparationJobPayload>(ONBOARDING_PREPARATION_QUEUE, {
    concurrency: 1,
  })
  return queue
}

export async function enqueueOnboardingPreparation(
  payload: OnboardingPreparationJobPayload,
): Promise<string> {
  return getOnboardingPreparationQueue().enqueue(payload)
}
