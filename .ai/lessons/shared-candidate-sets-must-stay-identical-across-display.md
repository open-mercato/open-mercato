---
title: "Shared candidate sets must stay identical across display and validation consumers"
modules: ["customers"]
areas: ["backend-ui","testing"]
topics: ["filters","testing","ui-components"]
---

# Shared candidate sets must stay identical across display and validation consumers

**Context**: The CRM calendar grid combined the visible-window query with a recurring-master overlay, while the editor conflict probe still queried only the visible window.

**Problem**: Two consumers that claimed to validate the same calendar state assembled different candidate sets. A recurring occurrence could appear in the grid without being considered by the save-time conflict warning, and later changes to pagination, deduplication, or caps could drift independently.

**Rule**: When display and validation depend on the same logical candidates, share the complete fetch-and-merge helper rather than only its lowest-level request. Tests must assert every required request mode and at least one boundary where ordering or caps affect which candidates survive.

**Applies to**: Calendar overlays, conflict probes, availability checks, deduplicated search views, and any UI where a validator must reason over the same server-backed collection that the user sees.
