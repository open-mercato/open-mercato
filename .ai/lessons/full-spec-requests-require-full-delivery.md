---
title: "Full spec requests require full delivery"
modules: ["platform"]
areas: ["architecture", "testing"]
topics: ["spec-implementation", "scope-management", "completion-evidence"]
---

# Full spec requests require full delivery

The RLS implementation session for PR #9424 treated the prototype phase as the entire assignment and reported completion. The user corrected that interpretation: they requested the full specification, including production integration, and then explicitly selected the PR-loop engine.

When a requested spec contains a proof phase plus gated implementation phases, complete the activation design and required reviews before continuing. Do not silently reduce the delivery to the proof or mark the task done with production acceptance work outstanding. Preserve genuine production/deployment approval boundaries while distinguishing them from authorization to implement and verify code on a PR. Evidence from an isolated proof does not establish application-wide runtime coverage.
