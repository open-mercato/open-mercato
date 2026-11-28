import type { StackProps } from '../contracts/stack'

export const stackFixtures: Record<string, StackProps> = {
  default: { gap: 3 },
  tight: { gap: 1, align: 'start' },
  centered: { gap: 4, align: 'center', justify: 'center' },
  spread: { gap: 2, align: 'center', justify: 'between' },
  wrapping: { gap: 2, wrap: true, align: 'baseline' },
  roomy: { gap: 12, align: 'stretch', justify: 'end' },
}
