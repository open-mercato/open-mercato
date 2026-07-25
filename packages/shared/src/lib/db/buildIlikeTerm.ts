import { escapeLikePattern } from './escapeLikePattern'

export type IlikeMatchMode = 'contains' | 'startsWith' | 'endsWith'

export const buildIlikeTerm = (value: string, mode: IlikeMatchMode = 'contains'): string => {
  const escaped = escapeLikePattern(value)
  switch (mode) {
    case 'startsWith':
      return `${escaped}%`
    case 'endsWith':
      return `%${escaped}`
    case 'contains':
    default:
      return `%${escaped}%`
  }
}
