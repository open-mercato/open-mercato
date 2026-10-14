---
title: "Verify the PR head before including local commits"
modules: ["platform"]
areas: ["spec-pr","ai-workflow"]
topics: ["git","change-ownership","review"]
---

# Verify the PR head before including local commits

**Context**: Review fixes started from a local branch containing newer commits that were absent from the actual PR head. Those commits added work the user wanted kept separate.

**Rule**: Fetch the PR's head repository and compare its commit with the local branch before merging or fixing reviews. A push to a different fork does not update the PR. Distinguish pre-existing commits from uncommitted changes, preserve unrelated work, and include it only within the user's requested scope.
