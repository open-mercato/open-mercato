// Sandboxed skill helper (Phase 5). Pure function of its args — no fs/net/imports.
// Invoked by the agent via `agent_orchestrator.run_skill_script`
// ({ skillId: "stage_playbook", scriptName: "score", args: { momentum, risk } }).
// Returns a 0..1 health score from two 0..1 signals; the agent folds it into its
// confidence. It can compute, never mutate — propose-only holds in the sandbox.

function run(args) {
  const momentum = clamp01(numberOr(args && args.momentum, 0.5))
  const risk = clamp01(numberOr(args && args.risk, 0.5))
  const score = clamp01(0.6 * momentum + 0.4 * (1 - risk))
  return { score: Math.round(score * 100) / 100, momentum, risk }
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}
