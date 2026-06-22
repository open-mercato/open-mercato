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

Return exactly one `set_stage` action whose `payload.stage` names the proposed pipeline stage. `confidence` must be between 0 and 1, and `rationale` must be a non-empty, manager-readable justification.
