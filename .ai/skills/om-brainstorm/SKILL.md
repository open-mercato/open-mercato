---
name: om-brainstorm
description: >
  Facilitation methods for exploring an idea — party mode (an AI panel of personas), Socratic
  questioning, 5-whys, yes-and, and more. Use when ideating on a feature, stress-testing an
  approach, or when invoked by om-proposal to explore a proposal. Methods adapted from
  BMAD-METHOD. Single-user facilitation: personas are simulated, not real teammates.
---

# om-brainstorm — Idea Facilitation Methods

A toolbox of brainstorming methods to explore and pressure-test an idea. Usually invoked by
`om-proposal` against an active proposal, but works standalone too. This is **single-user
facilitation** — when a method uses multiple voices (e.g. party mode), the skill simulates those
personas; it is not a real-time multi-human session. Real teammate collaboration happens
asynchronously through the proposal file (see `om-proposal`).

Method details and prompts live in [methods.md](references/methods.md). Attribution:
methods are adapted from [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) core-skills.

## Workflow

1. **Pick a method** — ask the user which method fits, or recommend one:
   - **Party mode** — convene a panel of personas (architect, PM, skeptic, end-user, …) that
     debate the idea from their angles. Best for surfacing blind spots and trade-offs.
   - **Socratic** — interrogate the idea with probing questions to expose hidden assumptions.
     Best when the idea feels obvious but untested.
   - **5 Whys** — drill from symptom to root cause. Best for problem framing.
   - **Yes-and** — divergent expansion without judgement. Best early, to widen the option space.
2. **Run the method** following its recipe in `methods.md`. Stay in the method until it converges
   or the user stops it.
3. **Distil** — summarise decisions, trade-offs, and any new questions the session raised.
4. **Return** the distilled output to the caller. When invoked by `om-proposal`, the output is
   written into the proposal's `## Findings`, and new questions into `## Open Questions`.

## Rules

- MUST keep persona panels balanced — always include at least one skeptic/critic voice so party
  mode does not become an echo chamber.
- MUST end every method with a distillation (decisions + open questions), not just a transcript.
- MUST credit BMAD-METHOD when the user asks where the methods come from.
- MUST NOT invent consensus — if personas/questions expose an unresolved trade-off, record it as
  an open question rather than papering over it.
