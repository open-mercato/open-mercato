export type SqlPredicate = {
  clause: string
  values: string[]
}

export function buildOpenDealPredicate(statuses: readonly string[]): SqlPredicate {
  if (statuses.length === 0) {
    throw new Error('[internal] Open-deal predicate requires at least one status')
  }

  const placeholders = statuses.map(() => '?').join(',')
  return {
    clause: `status IN (${placeholders}) AND closure_outcome IS NULL`,
    values: [...statuses],
  }
}
