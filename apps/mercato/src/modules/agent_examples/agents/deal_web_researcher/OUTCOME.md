---
kind: informative
---
```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["summary", "findings"],
  "properties": {
    "summary": { "type": "string", "minLength": 1 },
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
    }
  }
}
```

Write a one-paragraph `summary` of what the public web says about the prospect that a
seller should know before the next conversation. List each concrete signal in `findings`
with a short `signal` label, a one-sentence `detail`, and the `sourceUrl` you drew it from.
Return an empty `findings` array (and say so in `summary`) when nothing citable was found.
