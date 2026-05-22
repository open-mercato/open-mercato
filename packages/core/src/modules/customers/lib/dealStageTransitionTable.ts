import { TableNotFoundException } from '@mikro-orm/core'

const DEAL_STAGE_TRANSITIONS_TABLE = 'customer_deal_stage_transitions'

let warnedAboutMissingDealStageTransitionTable = false

export function isMissingDealStageTransitionTable(error: unknown): boolean {
  if (error instanceof TableNotFoundException) {
    return true
  }
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const candidate = error as { code?: unknown; message?: unknown }
  const message = typeof candidate.message === 'string' ? candidate.message : null

  if (candidate.code === '42P01') {
    return !message || message.includes(DEAL_STAGE_TRANSITIONS_TABLE)
  }

  return !!message
    && message.includes(DEAL_STAGE_TRANSITIONS_TABLE)
    && message.includes('does not exist')
}

export function warnMissingDealStageTransitionTable(source: string): void {
  if (warnedAboutMissingDealStageTransitionTable) {
    return
  }
  warnedAboutMissingDealStageTransitionTable = true
  console.warn(`[${source}] missing ${DEAL_STAGE_TRANSITIONS_TABLE} table; returning without stage history. Run yarn db:migrate.`)
}
