---
kind: informative
---
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["revenueBand", "signals"],
  "properties": {
    "revenueBand": { "type": "string", "minLength": 1 },
    "annualRevenueEstimateUsd": { "type": "number", "nullable": true, "minimum": 0 },
    "employeeEstimate": { "type": "string", "nullable": true },
    "fundingStage": { "type": "string", "nullable": true },
    "signals": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["detail", "sourceUrl"],
        "properties": {
          "detail": { "type": "string", "minLength": 1 },
          "sourceUrl": { "type": "string", "minLength": 1 }
        }
      }
    }
  }
}
```

Report `revenueBand` as a short human-readable band, e.g. `"$40–60M ARR (est.)"`, or `"Unknown"` when
you found nothing citable. `annualRevenueEstimateUsd`, `employeeEstimate`, and `fundingStage` are
optional single best guesses — use `null` when you cannot ground them. `signals` is the list of
concrete observations you relied on, each with the `sourceUrl` it came from.
