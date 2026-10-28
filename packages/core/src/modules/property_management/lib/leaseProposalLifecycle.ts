import { addDays, compareIsoDates } from './leaseTerm'

export const PROPOSAL_REMINDER_DAYS = 3

export function isProposalExpired(respondBy: string, today: string): boolean {
  return compareIsoDates(today, respondBy) > 0
}

export function isReminderDue(respondBy: string, today: string): boolean {
  return compareIsoDates(addDays(respondBy, -PROPOSAL_REMINDER_DAYS), today) <= 0 && !isProposalExpired(respondBy, today)
}
