---
title: "Check existing test identities before adding coverage"
modules: ["cli"]
areas: ["testing", "spec-pr"]
topics: ["testing", "code-review"]
---

# Check existing test identities before adding coverage

When adding CLI lifecycle coverage, a reused TC-INT-008 filename replaced the existing agentic initialization suite. The final diff exposed the removed coverage, and a follow-up restored that suite byte-for-byte and moved the new cases to TC-INT-009.

Before choosing a new test identifier or path, inspect the tracked test inventory. Review deleted assertions in the final diff and run both the preserved suite and new regression suite. A green replacement file does not prove that earlier coverage survived.
