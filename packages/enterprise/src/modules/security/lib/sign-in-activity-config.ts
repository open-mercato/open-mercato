import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

const millisecondsPerDay = 24 * 60 * 60 * 1000

export function readSignInActivityConfig() {
  const parsedDays = Number(process.env.OM_SECURITY_SIGN_IN_RETENTION_DAYS || '90')
  const retentionDays = Number.isFinite(parsedDays) ? Math.min(730, Math.max(1, Math.trunc(parsedDays))) : 90
  return {
    enabled: parseBooleanWithDefault(process.env.OM_SECURITY_SIGN_IN_ACTIVITY, true),
    notifyNewDevice: parseBooleanWithDefault(process.env.OM_SECURITY_SIGN_IN_NOTIFY_NEW_DEVICE, true),
    retentionDays,
    retentionMs: retentionDays * millisecondsPerDay,
  }
}
