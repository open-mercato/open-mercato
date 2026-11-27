import type { Platform } from '@mikro-orm/core'

export function preserveUnconstrainedNumericSnapshots(platform: Pick<Platform, 'normalizeColumnType'>): void {
  const normalizeColumnType = platform.normalizeColumnType.bind(platform)

  platform.normalizeColumnType = (type, options) => {
    if (/^(numeric|decimal)$/i.test(type) && options.precision == null && options.scale == null) {
      return 'numeric'
    }
    return normalizeColumnType(type, options)
  }
}
