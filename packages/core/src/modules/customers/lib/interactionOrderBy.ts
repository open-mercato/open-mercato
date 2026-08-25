import { raw } from '@mikro-orm/core'

export function buildInteractionOccurredAtOrderBy(sortDir: 'asc' | 'desc') {
  return {
    [raw('occurred_at')]: `${sortDir} nulls last`,
    createdAt: sortDir,
  }
}
