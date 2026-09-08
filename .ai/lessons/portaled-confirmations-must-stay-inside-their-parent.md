---
title: "Portaled confirmations must stay inside their parent dialog's React tree"
modules: ["ui"]
areas: ["backend-ui","module-data"]
topics: ["events","ui-components"]
---

# Portaled confirmations must stay inside their parent dialog's React tree

**Context**: A native confirmation dialog was portaled to `document.body` from beside a Radix dialog's content, so real pointer events were classified as outside interactions and Escape was intercepted before the native cancel event.

**Rule**: Render portaled confirmations as React children of the owning `DialogContent`, and handle Escape before the parent overlay's document-capture dismissal when the confirmation owns the active modal interaction.

**Applies to**: nested native dialogs, Radix `DismissableLayer`, and any portaled confirmation shown from an open modal.
