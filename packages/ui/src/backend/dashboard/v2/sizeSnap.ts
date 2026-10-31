import type { DashboardWidgetSize } from '@open-mercato/shared/modules/dashboard/widgets'

const RESIZE_STEPS: readonly { size: DashboardWidgetSize; fraction: number }[] = [
  { size: 'sm', fraction: 0.25 },
  { size: 'md', fraction: 0.5 },
  { size: 'lg', fraction: 0.75 },
  { size: 'full', fraction: 1 },
]

export function sizeToFraction(size: DashboardWidgetSize | undefined): number {
  return RESIZE_STEPS.find((step) => step.size === size)?.fraction ?? 0.5
}

export function fractionToSize(fraction: number): DashboardWidgetSize {
  let best = RESIZE_STEPS[0]
  for (const step of RESIZE_STEPS) {
    if (Math.abs(step.fraction - fraction) < Math.abs(best.fraction - fraction)) best = step
  }
  return best.size
}
