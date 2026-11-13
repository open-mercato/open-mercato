# Evaluation operator rules

Apply these rules on every invocation, including inspection-only requests.

- **No tracker writes.** Do not claim issues, change labels, post comments, open PRs, push, or publish artifacts through this skill. A separately authorized PR workflow owns publication.
- **Evidence before claims.** Report producer-recorded outcomes with the selected denominator and observation timestamp. Distinguish failed evaluations from infrastructure errors, blocked prerequisites, skipped work, and cases not yet evaluated. Never relabel a partial run as a full-suite pass.
- **Protect source evidence.** Keep raw responses, generated code, model captures, environment values, credentials, and absolute local paths out of committed or externally shared reports. Redaction in the local dashboard is not a privacy attestation. Retain hashes and repository-relative evidence references where suitable.
- **Visible output only.** Inspect retained visible responses and tool results. Do not request, reconstruct, or present hidden reasoning. When a response was not retained, say so; evaluator decisions are separate evidence.
- **Safe execution.** Treat paths and IDs as data, quote arguments, and use the documented runner. Do not install a new provider, production dependency, or alter isolation/certification behavior as a side effect of observation.
- **Reporting style.** Lead with the result and next action. Include concise evidence and consequences for defects; omit empty optional sections. Keep unresolved direction questions separate from verified failures and do not imply an unrun check passed.
