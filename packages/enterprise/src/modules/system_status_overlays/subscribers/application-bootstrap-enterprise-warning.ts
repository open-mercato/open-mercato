import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

const APP_BOOTSTRAP_EVENT = 'application.bootstrap.completed'
const ENTERPRISE_WARNING_GLOBAL_KEY = '__openMercatoEnterpriseLicenseWarningShown__'

export const metadata = {
  event: APP_BOOTSTRAP_EVENT,
  persistent: false,
  id: 'system_status_overlays:application-bootstrap-enterprise-warning',
}

export default async function handle() {
  if ((globalThis as Record<string, unknown>)[ENTERPRISE_WARNING_GLOBAL_KEY] === true) return
  const enterpriseModulesEnabled = parseBooleanWithDefault(process.env.OM_ENABLE_ENTERPRISE_MODULES, false)
  if (!enterpriseModulesEnabled) return

  ;(globalThis as Record<string, unknown>)[ENTERPRISE_WARNING_GLOBAL_KEY] = true
  console.warn(
    '[enterprise] Enterprise modules are enabled. Developer preview is free, but production usage requires a commercial enterprise license. See: https://github.com/open-mercato/open-mercato/blob/main/packages/enterprise/README.md',
  )
}
