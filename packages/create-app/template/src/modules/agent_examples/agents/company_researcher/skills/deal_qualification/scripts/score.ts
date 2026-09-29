// Sandboxed skill helper. Pure function of its args — no fs/net/imports.
// Invoked by the agent via `agent_orchestrator.run_skill_script`
// ({ skillId: "deal_qualification", scriptName: "score",
//    args: { revenueStrength, fundingStrength, growthStrength, riskLevel } }).
// Turns four 0..1 signal strengths into a 0..100 deal-fit score and a paying-likelihood
// bucket. It can compute, never mutate — propose-only holds in the sandbox.

function run(args) {
  const revenue = clamp01(numberOr(args && args.revenueStrength, 0))
  const funding = clamp01(numberOr(args && args.fundingStrength, 0))
  const growth = clamp01(numberOr(args && args.growthStrength, 0))
  const risk = clamp01(numberOr(args && args.riskLevel, 0))

  const upside = 0.4 * revenue + 0.35 * funding + 0.25 * growth
  const fit = clamp01(upside * (1 - 0.6 * risk))
  const dealFitScore = Math.round(fit * 100)

  const payingLikelihood = dealFitScore >= 66 ? 'high' : dealFitScore >= 33 ? 'medium' : 'low'
  const rationale =
    `fit ${dealFitScore}/100 from revenue=${round2(revenue)}, funding=${round2(funding)}, ` +
    `growth=${round2(growth)}, risk=${round2(risk)}`

  return { dealFitScore, payingLikelihood, rationale }
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

function round2(value) {
  return Math.round(value * 100) / 100
}
