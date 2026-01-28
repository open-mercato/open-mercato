import { z } from 'zod'
import { buildPasswordSchema } from '@open-mercato/shared/lib/auth/passwordPolicy'

const passwordSchema = buildPasswordSchema({ maxLength: 120 })

export const onboardingStartSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(120),
  lastName: z.string().min(1).max(120),
  organizationName: z.string().min(1).max(240),
  password: passwordSchema,
  confirmPassword: passwordSchema,
  termsAccepted: z.literal(true),
  locale: z.string().min(2).max(10).optional(),
}).superRefine((value, ctx) => {
  if (value.password !== value.confirmPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Passwords must match.',
      path: ['confirmPassword'],
    })
  }
})

export const onboardingVerifySchema = z.object({
  token: z.string().min(32),
})

export type OnboardingStartInput = z.infer<typeof onboardingStartSchema>
export type OnboardingVerifyInput = z.infer<typeof onboardingVerifySchema>
