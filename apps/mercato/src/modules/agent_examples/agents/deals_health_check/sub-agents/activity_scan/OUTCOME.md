---
kind: informative
---
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["momentum", "signals"],
  "properties": {
    "momentum": { "type": "string", "enum": ["increasing", "steady", "stalling"] },
    "lastTouchpoint": { "type": "string", "minLength": 1 },
    "signals": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 }
    }
  }
}
```

Report `momentum` as one of `increasing`, `steady`, or `stalling`. `signals` is a list of short, concrete momentum/risk observations (e.g. "no contact in 21 days", "moved to negotiation last week"). `lastTouchpoint` is an optional brief description of the most recent activity.
