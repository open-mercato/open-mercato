---
title: "Write Open Mercato specifications in English"
modules: ["platform"]
areas: ["spec-pr","ai-workflow"]
topics: ["specifications","documentation-language"]
---

# Write Open Mercato specifications in English

**Context**: The WCAG 2.2 AA accessibility specification package was first drafted in Polish because the working conversation was in Polish. Every other specification in `.ai/specs/` is in English, and the package had to be translated before it could be proposed upstream.

**Problem**: A specification in another language cannot be reviewed by most maintainers, cannot be searched alongside the rest of `.ai/specs/`, and mixes languages once its companion skill, templates, and reports are written in English. Translating after the fact also risks changing scope, anchors, and quoted identifiers.

**Rule**: Write repository specifications and their companion review reports in English, even when discussing the work in another language. Follow the Open Mercato specification template, including required sections, risk records, and the final compliance report. When translating an existing draft, preserve issue titles quoted from the tracker, identifiers, source links, scope, and evidence limitations, and update local heading links when translated headings change their anchors.

**Applies to**: `.ai/specs/`, `.ai/specs/enterprise/`, `.ai/specs/analysis/`, and the `om-spec-writing` and `om-pre-implement-spec` skills.
