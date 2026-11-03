/**
 * Selection rules for the TC-MA integration suite.
 *
 * `marketing_automation` is an optional, opt-in module: `apps/mercato/src/modules.ts` registers it only
 * when `OM_ENABLE_MARKETING_AUTOMATION` is set, so an app booted without the flag serves none of its
 * routes. Integration discovery otherwise treats every `packages/*\/src/modules/*` as enabled, which
 * would select all 49 specs against an app that answers 404 to every one of them.
 *
 * `requiredEnvVars` is a presence check, so setting the flag to `false` still selects the suite. That is
 * the discovery contract shared with `OM_PUSH_FAKE_PROVIDERS`; leave the variable unset to exclude.
 */
export const integrationMeta = {
  description: 'Marketing automation integration coverage (TC-MA-001..049) — requires the opt-in module flag',
  dependsOnModules: ['marketing_automation'],
  requiredEnvVars: ['OM_ENABLE_MARKETING_AUTOMATION'],
}

export default integrationMeta
