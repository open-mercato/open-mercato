import type { SendEmailOptions } from '../send'

export const EMAIL_STRATEGIES = ['resend', 'smtp'] as const

export type EmailStrategyName = (typeof EMAIL_STRATEGIES)[number]

export type ResolvedEmailMessage = Omit<SendEmailOptions, 'from'> & { from: string }

export interface EmailTransport {
  send(message: ResolvedEmailMessage): Promise<void>
}
