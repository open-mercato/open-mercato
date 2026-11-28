// The fixture decision provider is opt-in and never called against a real
// vendor. Gating on these three vars excludes the whole folder from CI until
// the integration job sets them (see the implementation PR's proposal to add
// them to .github/workflows/ci.yml — a pipeline change that needs maintainer
// approval and is out of scope for this change).
export const integrationMeta = {
  dependsOnModules: ['catalog'],
  requiredEnvVars: ['OM_DECISION_PROVIDER', 'OM_DECISION_MODEL', 'OM_DECISION_FIXTURE_ENABLED'],
}
