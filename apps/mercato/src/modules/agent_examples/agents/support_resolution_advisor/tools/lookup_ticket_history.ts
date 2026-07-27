// Local sandboxed tool file (Phase 5). Pure function of its args — no fs/net/imports.
// The agent calls it via the MCP tool `agent_orchestrator.run_skill_script`
// ({ skillId: "__agent_tools__", scriptName: "lookup_ticket_history",
//    args: { customerEmail } }). It runs server-side in the isolated-vm sandbox and
// returns a canned support-history snapshot, so the example is self-contained (no DB
// and no app-module MCP tool, which the standalone MCP server cannot load). It can
// compute, never mutate — propose-only holds.

function run(args) {
  const email = String((args && args.customerEmail) || '').trim().toLowerCase()
  const canned = {
    'vip@acme.test': { openTickets: 3, resolvedLast30Days: 1, averageResolutionHours: 41, churnRisk: 'high', vip: true },
    'casual@example.test': { openTickets: 0, resolvedLast30Days: 2, averageResolutionHours: 6, churnRisk: 'low', vip: false },
  }
  const history = canned[email] || {
    openTickets: 1,
    resolvedLast30Days: 1,
    averageResolutionHours: 18,
    churnRisk: 'medium',
    vip: false,
  }
  return { customerEmail: email, history }
}
