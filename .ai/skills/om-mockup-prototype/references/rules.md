# Shared rules

Canonical rules shared by every skill in this collection. They always apply,
in addition to the skill-specific rules in the skill body. On conflict, the
stricter rule wins.

- **Interactive run — a user is in the loop.** This skill acts once, asks the
  questions only the team can answer (story gaps, screen inventory), reports,
  and hands control back. It is not an `om-auto-*` skill: it chains no
  further skills and continues past the report only when asked.
- **Secrets hygiene.** Never paste secrets, tokens, `.env` content, or raw
  credentials into a prototype, the hand-off, or logs. Sample data is always
  synthetic and fictional — never tenant or customer data, production
  identifiers, or private business records.
- **Emoji glossary** in user-facing output: 🎯 goal · 📋 plan · 📝 spec · 🏷️ labels · 📸 evidence · 🔍 review · 🧪 tests · 💥 breaking · ✅ pass · ❌ fail · ⚠️ needs-human · ⛔ blocked · 🔁 resume · 🚀 merge/release. Emojis decorate; parsers key on text markers only.
- **Reporting style.** User-facing output is a deliverable, not a log: write
  complete sentences and explain the why behind every statement. Never
  compress reporting to save tokens. Fill the shape in
  `references/report-templates.md` exactly and expand with detail.

## om-mockup-prototype specifics

- **Stable screen ids are a contract.** Once review begins, every
  `id="sN"` stays fixed — comment anchors resolve against them, and the
  re-anchoring check verifies each surviving pin still points at the element
  its thread discusses, not merely that no orphan state was raised.
- **Comments are not live collaboration.** They live in the reviewer's
  browser until exported into `comments.js` and committed; say so in every
  hand-off.
- **Never overwrite an existing prototype directory** — it may carry
  reviewer feedback. Initialization refuses; respect that.
- **Tokens only.** Screens use design tokens (with their neutral fallbacks);
  no hardcoded status colors, no arbitrary values. Rebranding happens in
  `theme.css` alone; semantic tokens stay owned by the generated
  `tokens.css`.
- **Bounded local server.** Serve a prototype only on localhost, attached to
  the current session, and stop it immediately after verification.
- **Honest interactions.** Never claim an illustrated interaction is
  implemented; `.notes` carry what the prototype cannot execute.
