/**
 * One feature: the right to start a deal briefing call from a company page.
 *
 * It gates the header button (tracker task B6) and nothing else. Everything the
 * run then does is gated by the feature that owns it — the workflow engine
 * checks `workflows.instances.create` on the POST, the ensure-task command
 * declares `customers.interactions.manage`, and the outbound call itself needs
 * the deliberately default-off `agent_orchestrator.external_agents.invoke`.
 * This feature is therefore an INTENT gate, not a capability bundle.
 *
 * ## Why `dependsOn: ['workflows.instances.create']`
 *
 * The button's only action is `POST /api/workflows/instances`, which that
 * feature guards. A role holding `sales_call_planner.brief.run` without it sees
 * a button that can only ever 403 — exactly the "granted but inert" state the
 * dependency diagnostics exist to surface in the role editor
 * (`example_customers_sync.view` → `customers.people.view` is the same shape).
 *
 * `agent_orchestrator.external_agents.invoke` is deliberately NOT listed. It is
 * default-off by design (external-agents tracker T2.8) and a `dependsOn` entry
 * would advertise it as a prerequisite the role editor nudges an admin to grant,
 * which is the opposite of what default-off means. A run started without it
 * fails down the workflow's `error` route before anything dials — visible,
 * recoverable and fail-closed.
 */
export const features = [
  {
    id: 'sales_call_planner.brief.run',
    title: 'Start a deal briefing call',
    module: 'sales_call_planner',
    dependsOn: ['workflows.instances.create'],
  },
]

export default features
