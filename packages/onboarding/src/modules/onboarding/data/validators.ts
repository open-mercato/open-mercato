import { z } from 'zod'

export const onboardingStartSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  organizationName: z.string().min(1).max(240),
  termsAccepted: z.literal(true),
  locale: z.string().min(2).max(10).optional(),
})

export const onboardingVerifySchema = z.object({
  token: z.string().min(32),
})

export type OnboardingStartInput = z.infer<typeof onboardingStartSchema>
export type OnboardingVerifyInput = z.infer<typeof onboardingVerifySchema>
