---
kind: actionable
---
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["actions", "confidence", "rationale"],
  "properties": {
    "actions": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["type", "payload"],
        "properties": {
          "type": { "const": "set_stage" },
          "payload": {
            "type": "object",
            "additionalProperties": false,
            "required": ["stage"],
            "properties": {
              "stage": { "type": "string", "minLength": 1 }
            }
          }
        }
      }
    },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "rationale": { "type": "string", "minLength": 1 }
  }
}
```

Use this EXACT shape — `actions` is an ARRAY and the stage is nested under `payload`:

```json
{ "actions": [{ "type": "set_stage", "payload": { "stage": "negotiation" } }], "confidence": 0.8, "rationale": "…" }
```

Common mistakes to avoid: do NOT use a singular `action` object, and do NOT put `stage` at the top of the action (it must be `payload.stage`). Return exactly one action. `confidence` must be between 0 and 1; `rationale` must be a non-empty, manager-readable justification. Pass this object as the `outcome` argument of the submit_outcome tool (an object, not a string).
