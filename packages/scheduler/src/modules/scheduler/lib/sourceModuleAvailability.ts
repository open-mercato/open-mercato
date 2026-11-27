import { tryGetModules } from '@open-mercato/shared/lib/modules/registry'

type ScheduleSourceShape = {
  sourceType?: string | null
  sourceModule?: string | null
}

/**
 * The module that registered a schedule row is no longer part of the deployment
 * (#8381): it was dropped from `src/modules.ts`, so its workers, commands and
 * entities are gone while its `scheduled_jobs` rows stay enabled. Such rows must
 * be skipped at dispatch instead of firing and failing on every tick.
 *
 * Only module-authored rows are judged; user-authored rows keep their own
 * dispatch checks. When the registry has not been bootstrapped the answer is
 * "not disabled", so isolated callers keep their previous behavior.
 */
export function isScheduleSourceModuleDisabled(schedule: ScheduleSourceShape): boolean {
  if (schedule.sourceType !== 'module') return false
  const sourceModule = schedule.sourceModule?.trim()
  if (!sourceModule) return false
  const modules = tryGetModules()
  if (!modules || modules.length === 0) return false
  return !modules.some((mod) => mod.id === sourceModule)
}

export function describeDisabledSourceModule(schedule: ScheduleSourceShape): string {
  return `Source module is not enabled: ${schedule.sourceModule ?? '(none)'}`
}
