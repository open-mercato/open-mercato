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
          "type": {
            "type": "string",
            "enum": ["set_priority", "assign_specialist", "send_macro"]
          },
          "payload": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "priority": {
                "type": "string",
                "enum": ["low", "medium", "high", "urgent"]
              },
              "team": { "type": "string", "minLength": 1 },
              "macroId": { "type": "string", "minLength": 1 }
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

Propose exactly one action in `actions`. Fill only the `payload` field that matches the
action `type` (`set_priority` → `priority`, `assign_specialist` → `team`, `send_macro` →
`macroId`). `confidence` is 0..1 and `rationale` is one non-empty, support-lead-readable
sentence naming the deciding signal.
