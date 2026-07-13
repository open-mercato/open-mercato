# README banner promoting open-mercato/skills

## Overview

**Goal:** Add a promotional banner to the root `README.md`, placed between the Getting Started section (below the video table) and the "Spec Driven Development" heading, pointing readers to https://github.com/open-mercato/skills.

**Scope:**
- Root `README.md` only.
- Banner headline: "🤖 Learn AI Engineering like we do!"
- Copy: the experience of building this enterprise-grade ERP is distilled into `open-mercato/skills` — re-usable, technology-agnostic agent skills (autonomous PR creation, code review, CI stabilization, spec writing, integration testing, merge management, and more), usable in any technology stack.
- Showcase install command `npx skills add open-mercato/skills --skill '*'` in a fenced code block.
- GitHub shields.io badge linking to the repo.
- Framed with horizontal rules so it reads as a banner.

**Non-goals:**
- No changes to any other README sections, docs pages, or code.
- No changes to the skills installation tooling (`yarn install-skills`, `.ai/skills/tiers.json`).

## Implementation Plan

### Phase 1: Add banner to README

- 1.1 Insert the banner block into `README.md` between the Getting Started video table and `## Spec Driven Development`.

## Risks

- Docs-only change; risk limited to markdown rendering on GitHub (HTML `<div align="center">` mixed with a fenced code block). Mitigated by keeping the code fence separated by blank lines, which GitHub renders correctly.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Add banner to README

- [ ] 1.1 Insert skills banner into README.md
