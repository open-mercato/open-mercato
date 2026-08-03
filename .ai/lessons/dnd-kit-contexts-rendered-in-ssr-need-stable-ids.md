---
title: "dnd-kit contexts rendered in SSR need stable ids"
modules: ["customers","ui","cli"]
areas: ["backend-ui"]
topics: ["generated-files","ui-components"]
---

# dnd-kit contexts rendered in SSR need stable ids

**Context**: The advanced datatable uses dnd-kit for header and column-chooser drag-and-drop, and those contexts are rendered during SSR on backend pages.

**Problem**: Letting dnd-kit generate its own accessibility ids caused server/client `aria-describedby` mismatches, which showed up as React hydration errors on customer grid pages even though the table still rendered.

**Rule**: Whenever a dnd-kit `DndContext` can be server-rendered, pass a deterministic `id` derived from stable page/table identity instead of relying on auto-generated ids.

**Applies to**: `DataTable` header drag-and-drop, column chooser drag-and-drop, and any future SSR-rendered dnd-kit surface.
