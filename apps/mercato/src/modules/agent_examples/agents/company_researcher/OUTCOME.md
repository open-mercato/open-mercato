---
kind: informative
---
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["companyName", "assessment", "findings", "summary"],
  "properties": {
    "companyName": { "type": "string", "minLength": 1 },
    "assessment": {
      "type": "object",
      "additionalProperties": false,
      "required": ["revenueBand", "companySizeBucket", "dealFitScore", "payingLikelihood", "recommendation"],
      "properties": {
        "revenueBand": { "type": "string", "minLength": 1 },
        "annualRevenueEstimateUsd": { "type": "number", "nullable": true, "minimum": 0 },
        "employeeEstimate": { "type": "string", "nullable": true },
        "companySizeBucket": { "type": "string", "enum": ["micro", "small", "mid_market", "enterprise", "unknown"] },
        "fundingStage": { "type": "string", "nullable": true },
        "dealFitScore": { "type": "integer", "minimum": 0, "maximum": 100 },
        "payingLikelihood": { "type": "string", "enum": ["low", "medium", "high"] },
        "recommendation": { "type": "string", "minLength": 1 }
      }
    },
    "findings": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["signal", "detail", "sourceUrl"],
        "properties": {
          "signal": { "type": "string", "minLength": 1 },
          "detail": { "type": "string", "minLength": 1 },
          "sourceUrl": { "type": "string", "minLength": 1 }
        }
      }
    },
    "summary": { "type": "string", "minLength": 1 }
  }
}
```

Fill `assessment` with your qualified read of the company as a paying prospect:

- `revenueBand` — a short human-readable band, e.g. `"$40–60M ARR (est.)"` or `"Unknown"`.
- `annualRevenueEstimateUsd` — a single best-guess number in USD, or `null` when you cannot ground one.
- `employeeEstimate` — a short range like `"200–500"`, or `null`.
- `companySizeBucket` — one of `micro`, `small`, `mid_market`, `enterprise`, or `unknown`.
- `fundingStage` — e.g. `"Series C"`, `"Bootstrapped"`, `"Public"`, or `null`.
- `dealFitScore` — an integer 0–100 (higher = better prospect), consistent with the `deal_qualification` skill.
- `payingLikelihood` — `low`, `medium`, or `high`: how likely this company can and will pay well.
- `recommendation` — one or two sentences a seller can act on (pursue, qualify further, or deprioritize, and why).

List every concrete signal in `findings` with a short `signal` label, a one-sentence `detail`, and the `sourceUrl` you drew it from. Return an empty `findings` array (and say so in `summary`) when nothing citable was found. Pass this whole object as the `outcome` argument of the submit_outcome tool (an object, not a string).
