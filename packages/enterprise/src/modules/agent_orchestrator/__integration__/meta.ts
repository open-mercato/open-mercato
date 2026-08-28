export const integrationMeta = {
  description: 'Agent orchestrator runtime, compliance export, trace, caseload and process integration coverage',
  dependsOnModules: ['agent_orchestrator'],
  // The module is registered only when BOTH OM_ENABLE_ENTERPRISE_MODULES and
  // OM_ENABLE_ENTERPRISE_MODULES_AGENTS are set (apps/mercato/src/modules.ts).
  // dependsOnModules alone cannot express that: it resolves against directories
  // on disk, which the umbrella flag already satisfies. Declaring the agents
  // flag makes discovery SKIP these specs when it is absent, instead of running
  // them against an app that never registered the module and failing with 404s
  // that look like product bugs.
  requiredEnvVars: ['OM_ENABLE_ENTERPRISE_MODULES_AGENTS'],
}
