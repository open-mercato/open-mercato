---
title: "PR author, reviewer, and assignee roles are independent"
modules: ["platform"]
areas: ["spec-pr"]
topics: ["pr-workflow","review-ownership"]
---

# PR author, reviewer, and assignee roles are independent

GitHub exposes author, review requests, completed reviews, and assignees as separate workflow facts. A person appearing as an assignee or reviewer does not make them the change owner, and the author can also be assigned without ceasing to be the author.

When adopting or continuing a pull request, read the author from the PR author field, identify reviewers from requested and completed reviews, and treat assignees only as assignment metadata. Preserve reviewer assignments unless the user explicitly asks to change them, and do not infer ownership from a combined people list.
