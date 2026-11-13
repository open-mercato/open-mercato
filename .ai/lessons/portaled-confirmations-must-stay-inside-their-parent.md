---
title: "Portaled overlays must stay inside their owning dialog"
modules: ["ui"]
areas: ["backend-ui","module-data"]
topics: ["events","ui-components"]
---

# Portaled overlays must stay inside their owning dialog

**Context**: A native confirmation dialog was portaled to `document.body` from beside a Radix dialog's content, so real pointer events were classified as outside interactions and Escape was intercepted before the native cancel event.

**Rule**: Render portaled confirmations as React children of the owning `DialogContent`, and handle Escape before the parent overlay's document-capture dismissal when the confirmation owns the active modal interaction.

Third-party editor overlays also need DOM containment inside their active dialog. A body-level MDXEditor popup can be mounted before Radix modal isolation on a cached reopen, leaving visible options under `aria-hidden="true"`. Supply the nearest owning dialog through the editor's supported `overlayContainer` after the host mounts; preserve the body default outside dialogs. Test repeated open/close cycles with accessible-role queries while verifying background content stays hidden.

**Applies to**: nested native dialogs, Radix `DismissableLayer`, and any portaled confirmation shown from an open modal.
