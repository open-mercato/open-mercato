// Build-time application version sourced from the root package.json
import packageJson from '../../../../package.json'

export const APP_VERSION = packageJson.version
export const appVersion = APP_VERSION
