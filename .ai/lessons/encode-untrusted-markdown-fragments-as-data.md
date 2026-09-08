---
title: "Encode untrusted Markdown fragments as data, not chained escapes"
modules: ["platform"]
areas: ["architecture","testing"]
topics: ["network-security","testing"]
---

# Encode untrusted Markdown fragments as data, not chained escapes

**Context**: Mutation reports embed repository-controlled source, paths, and labels in GitHub Markdown tables. Sequential backslash escaping looked complete but remained parser-sensitive and triggered high-severity incomplete-sanitization alerts.

**Rule**: When arbitrary text must be rendered as inline code in generated Markdown, place a numeric character reference for every code point inside a fixed `<code>` element. Do not build a sanitizer from ordered replacements for backslashes, pipes, and backticks. Encode every untrusted field, and test combinations that could close code spans, split table cells, or activate mentions.

**Applies to**: CI summaries, automated PR comments, generated issue bodies, and any Markdown table populated from source files or tool output.
