// Area 01 owns `agents.view` / `agents.run`. Area 03 owns `proposals.view` /
// `proposals.dispose`. `workflows.author` is declared by area 02 — see
// mvp/00-overview.md §ACL features.
export const features = [
  { id: 'agent_orchestrator.agents.view', title: 'View agents and runs', module: 'agent_orchestrator' },
  {
    id: 'agent_orchestrator.agents.run',
    title: 'Run agents (playground)',
    module: 'agent_orchestrator',
    dependsOn: ['agent_orchestrator.agents.view'],
  },
  {
    id: 'agent_orchestrator.agents.manage',
    title: 'Manage agent presentation settings',
    module: 'agent_orchestrator',
    dependsOn: ['agent_orchestrator.agents.view'],
  },
  { id: 'agent_orchestrator.proposals.view', title: 'View proposals', module: 'agent_orchestrator' },
  {
    id: 'agent_orchestrator.proposals.dispose',
    title: 'Dispose proposals (approve/edit/reject)',
    module: 'agent_orchestrator',
    dependsOn: ['agent_orchestrator.proposals.view'],
  },
  // Trace + eval overlay.
  { id: 'agent_orchestrator.trace.view', title: 'View agent run traces', module: 'agent_orchestrator' },
  {
    id: 'agent_orchestrator.trace.correct',
    title: 'Record agent corrections',
    module: 'agent_orchestrator',
    dependsOn: ['agent_orchestrator.trace.view'],
  },
  {
    id: 'agent_orchestrator.eval.manage',
    title: 'Manage evaluation cases and assertions',
    module: 'agent_orchestrator',
    dependsOn: ['agent_orchestrator.trace.view'],
  },
  {
    // Separate from eval.manage: authoring an assertion is cheap, but TRIGGERING a
    // run performs real inference against a real model and costs real money.
    id: 'agent_orchestrator.eval.run',
    title: 'Run agent evaluations',
    module: 'agent_orchestrator',
    dependsOn: ['agent_orchestrator.eval.manage'],
  },
  {
    id: 'agent_orchestrator.eval.export',
    title: 'Export the agent eval-case set',
    module: 'agent_orchestrator',
    dependsOn: ['agent_orchestrator.eval.manage'],
  },
  // Runtime guardrails overlay.
  { id: 'agent_orchestrator.guardrail.read', title: 'View guardrail checks', module: 'agent_orchestrator' },
  {
    id: 'agent_orchestrator.guardrail.manage',
    title: 'Manage guardrail sets',
    module: 'agent_orchestrator',
    dependsOn: ['agent_orchestrator.guardrail.read'],
  },
  // Context overlay — read the assembled context bundles (trace "context assembled" panel).
  { id: 'agent_orchestrator.context.read', title: 'View agent context bundles', module: 'agent_orchestrator' },
  // Identity overlay (Wave 4) — provision/manage agent principals and their scoped roles.
  { id: 'agent_orchestrator.identity.read', title: 'View agent principals', module: 'agent_orchestrator' },
  {
    id: 'agent_orchestrator.identity.manage',
    title: 'Manage agent principals (provision agent users + scoped roles)',
    module: 'agent_orchestrator',
    dependsOn: ['agent_orchestrator.identity.read'],
  },
  // External-agent OAuth (Wave 4 Phase 3) — mint client-credentials tokens and
  // create/revoke delegation grants for external (`oauth_client`) principals.
  {
    id: 'agent_orchestrator.identity.tokens',
    title: 'Manage external agent tokens and delegation grants',
    module: 'agent_orchestrator',
    dependsOn: ['agent_orchestrator.identity.manage'],
  },
  // Processes (triggered process model spec, 2026-08-11). ONE `view` feature
  // covers both surfaces the model has: the running-process projection
  // (`/backend/processes`) and the definitions that can start one
  // (`/backend/processes/definitions`). The retired `tasks.view` merged into
  // this id rather than adding a fourth feature for a distinction nobody makes.
  // Consequence recorded in the spec: `dependsOn` proposals.view is inherited by
  // definition authors, who did not transitively read proposals before.
  {
    id: 'agent_orchestrator.processes.view',
    title: 'View agent processes, process definitions and run history',
    module: 'agent_orchestrator',
    dependsOn: ['agent_orchestrator.proposals.view'],
  },
  {
    id: 'agent_orchestrator.processes.manage',
    title: 'Create and configure process definitions',
    module: 'agent_orchestrator',
    dependsOn: ['agent_orchestrator.processes.view'],
  },
  {
    id: 'agent_orchestrator.processes.run',
    title: 'Start a process run',
    module: 'agent_orchestrator',
    dependsOn: ['agent_orchestrator.processes.view'],
  },
  // Web egress overlay (spec 2026-07-11-agent-web-search-tool) — gates the
  // read-only `web_search`/`web_fetch` MCP tools. Default-OFF: intentionally NOT
  // added to the narrower `defaultRoleFeatures` in setup.ts, so an agent must be
  // explicitly authorized for network egress. `dependsOn` agents.run because the
  // tools are only reachable inside an agent run.
  {
    id: 'agent_orchestrator.web_search',
    title: 'Use agent web search',
    module: 'agent_orchestrator',
    dependsOn: ['agent_orchestrator.agents.run'],
  },
  // Split from `web_search` so a tenant can be granted discovery without the
  // ability to retrieve an arbitrary URL, which is the higher-risk half. Additive:
  // `web_fetch` requires BOTH features, so every existing grant of `web_search`
  // keeps working for search and only loses fetch until this is granted too.
  {
    id: 'agent_orchestrator.web_fetch',
    title: 'Use agent web fetch (retrieve an arbitrary URL)',
    module: 'agent_orchestrator',
    dependsOn: ['agent_orchestrator.web_search'],
  },
]

export default features
