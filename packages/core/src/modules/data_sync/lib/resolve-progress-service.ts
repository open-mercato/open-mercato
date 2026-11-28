import type { ProgressService } from '../../progress/lib/progressService'

export function resolveProgressService(container: {
  resolve: <T>(name: string, options: { allowUnregistered: true }) => T
}): ProgressService | null {
  return container.resolve<ProgressService | undefined>('progressService', { allowUnregistered: true }) ?? null
}
