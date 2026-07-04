---
name: om-help
description: >
  Open Mercato app navigator. Use when a developer asks: "what should I do now?",
  "which skill should I use?", "where do I start?", "next steps?", "I'm lost",
  "what comes after X?", "how do I create/add/build Y?", "how do I extend module Z?",
  "how do I fix this error?", "where does X go?", "what's the sequence for a new module / feature / integration?".
  Covers both orientation (navigation mode) and technical how-to (knowledge mode).
---

# om-help — App Navigator

Point a developer or agent to the right skill and the right order. Two modes: orientation
("what do I do now?") and technical how-to ("how do I do X?"). Pick the one that matches the
question, then follow its workflow file.

## When to use

- The user is disoriented and asks what to do next, where to start, or which skill applies.
- The user asks a concrete how-to ("how do I add a module / search / RBAC / events / migrations / UI / integration?").
- Not for executing the work itself — this skill routes; the target skill does the work.

## What it contains

Two mode workflows. Mode 1 (Navigation) reads the current repo context and maps it to a named
workflow sequence. Mode 2 (Knowledge) maps a how-to question to the owning skill and grounds the
answer in that skill's content.

## Reference map — load the mode in play

| When | Load |
|------|------|
| "what now?" / "next steps?" / "which skill?" / "I'm lost" | `workflow/mode-1-navigation.md` |
| "how do I add/build/extend X?" / "where does Z go?" | `workflow/mode-2-knowledge.md` |
| Which skill to use — categories, triggers, sequencing | `references/skills-catalog.md` |
| Named workflows with ordered skill lists (sequencing / "where to start") | `references/workflow-sequences.md` |

Load both references when the user is fully disoriented.

## Non-negotiables

- Route, don't do: recommend the right skill; never reimplement its procedure here.
- Ground every knowledge-mode answer in the loaded skill content, not model training data alone.
- In navigation mode, present at most two options when multiple paths are valid.
