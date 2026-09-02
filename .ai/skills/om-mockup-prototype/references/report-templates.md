# Report templates

The hand-off is a deliverable, not a log. Fill this shape exactly and expand
with detail: the reader decides, on the strength of this text, whether the
flow is ready to review and what the prototype can and cannot tell them.

## Prototype hand-off

```markdown
## 📝 Prototype ready: .ai/prototypes/<slug>/

**Requirements**: <path, and whether a story map was added or gaps were found>
**Screens**: <N>, covering <happy path + the empty/permission/error/undo states included>
**Token source**: <the repository snapshot path, or the bundled default — exactly as the tokens.css header states>
**Screen anatomy**: <the repo-local override path, or the shipped neutral template — whichever initialization used>
**Theme**: <untouched defaults, or which of the eight identity tokens were set>

### 🎯 What this prototype decides

<Two or three sentences: which flow questions a reviewer can now answer by
clicking through, and which remain a rejectable proposal.>

### ⚠️ What it cannot show

<The interactions that are illustrative rather than implemented, the
contradictions or missing decisions discovered while drawing the flow, and
anything the `.notes` annotations carry.>

### 🧪 Verification

<Both themes checked, click-through and keyboard navigation, comment engine
checklist (creation, reply focus, reload persistence, pins on inputs and
buttons, re-anchoring on a restructured screen, deletion tombstones, export,
storage isolation between two prototypes on one origin) — state what ran and
what was skipped, with why.>

### ✅ Next

<How to review it (open index.html or the bounded server command), and that
comments export back through **Export for repository** → replace
`comments.js` → commit.>
```
