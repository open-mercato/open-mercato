# Starter setup: emoji spacing in log lines

## Goal

Stop `yarn setup` / starter log text from colliding with status emojis (`ℹ️lockfile changed`, `⚙️working…`).

## Scope

`ℹ️`, `⚠️` and `⚙️` are narrow base characters turned into emoji by the U+FE0F variation selector. Many terminals draw them two columns wide but move the cursor only one, so the single following space disappears under the glyph. Follow the existing starter convention (`⚠️  `, already used in `infra-preflight.mjs` / `steps.mjs`): use two spaces after these emojis everywhere in `packages/starter/src`, including the shared `icons` map and the step spinner label.

Non-goals: `✅` / `❌` (wide by default, render fine); other packages; changing message text.

## Risks

Cosmetic only; tests that assert exact strings get updated.

## Progress

PR: #8927

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Spacing

- [x] 1.1 Double-space after VS16 emojis in starter output and update tests — 6caf4552e8

### Phase 2: Dev runtime output (scope extension requested by the user)

- [x] 2.1 Double-space after VS16 emojis in yarn dev / dev:greenfield output, dedent the "Press [d]" hint, sync create-app template — c9c875c355

### Phase 3: Keep init credentials visible (scope extension requested by the user)

- [x] 3.1 Re-print the `mercato init` credentials panel outside the folded setup log (regression from #8838)

### Phase 4: Terminal-independent icons (user decision after the doubled-gap report)

- [x] 4.1 Swap U+FE0F emoji for always-wide emoji with one space, add guard tests, post rendering proof — e1263e2743
