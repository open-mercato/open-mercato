# Report Template — Sticky Advisory PR Comment

Upsert by marker `<!-- om-ux-walkthrough:report -->`: search existing PR comments for the
marker and edit that comment in place (same sticky pattern as other house automation comments).
Never stack a second report comment.

## Template

```markdown
<!-- om-ux-walkthrough:report -->
## 🧭 UX walkthrough — synthetic user report (advisory)

**Persona:** {name} (`{id}` @ `{blobHash}`) — **Goal:** "{goal}"
**Outcome:** {reached in N steps (baseline B) | abandoned at step N} — runs: {k}/{k} consistent
**Env:** ephemeral @ {base_url} — role `{role}@acme.com` — runId `{runId}`

### Friction findings (reproduced in both runs)
| # | Severity | Type | Where | What happened |
|---|---|---|---|---|
| 1 | S2 | Mislabel | {normalized route} | Label "{verbatim label}" read as {expectation}; delivered {actual}. Quote: "{persona narration}" |
| 2 | S3 | Dead end | {normalized route} | {what the interaction failed to visibly do} |

### Screenshots
![Finding 1 — step {NN}]({raw url})   <!-- annotated: red outline on the finding's element -->

### Narration excerpts
> Step {NN}: "{short persona narration at the moment of friction}"

<details><summary>Unreproduced observations (seen in one run only)</summary>

{one bullet per singleton, same anchoring: step, route, quote/screenshot}

</details>
<details><summary>Epistemics — read before acting on this report</summary>

{fixed caveat block, verbatim — see below}

</details>

*Compare vs run `{prevRunId}`: {r} resolved, {p} persisting, {n} new.*   <!-- only with --compare -->
```

With `--compare`, prefix each findings-table row with **resolved** / **persisting** / **new**,
and note when the persona blob hash differs from the prior run.

Rendering rules:

- Every finding row anchors to a concrete moment: step number, route, verbatim quote for
  mislabels, screenshot reference. No unanchored findings.
- Findings are phrased as hypotheses about a user like the persona ("a first-contact accountant
  may read 'Directory' as the client registry"), never as facts about users.
- Severity S1 runs still get the same calm, advisory tone — no verdict language, no
  pass/fail framing, no recommendation to block.
- Screenshots follow the sibling skill's redact-or-omit rule.

## Fixed epistemics caveat block (normative — include verbatim)

```markdown
**What this signal is and is not**

- **A synthetic user is a signal, not proof.** These findings are hypotheses about how a person
  like this persona might struggle — not evidence about any real user. Confirmation still
  requires a human.
- **The persona is synthetic.** It is an authored archetype, not a research participant; nothing
  here is user research and it must not be cited as such.
- **The navigator is not a person.** It does not get tired, distracted, or embarrassed; its
  "patience" is a step counter. S1 means the simulation failed the task — evidence, not
  equivalence.
- **Runs are nondeterministic.** Two runs of the same goal can take different paths. Only
  friction reproduced in both runs (matching fingerprints) is listed as a finding; singletons
  sit in the collapsed appendix, and both full step logs are retained in the run artifacts so
  divergence itself is inspectable.
- **Vocabulary can leak.** The persona's quirks are written by the same team that named the
  UI; a persona can accidentally encode the house vocabulary and mask exactly the mislabels
  this walkthrough exists to find. Persona review requires vocabulary sourced from real user
  language — support tickets, sales calls — never from the product's own labels.
- **This report is advisory.** It sets no labels, fails no checks, and gates nothing. A
  walkthrough finding alone never justifies blocking a PR.
- **Cost was bounded.** Runs stop at the persona's patience budget, a 40-step hard cap, or the
  token budget; a tripped budget produces an honest PARTIAL report, not an inferred one.
```
