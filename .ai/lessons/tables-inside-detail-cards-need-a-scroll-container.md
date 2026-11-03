---
title: "Tables inside detail cards need their own scroll container"
modules: ["ui","customers"]
areas: ["backend-ui","testing"]
topics: ["ui-components","layout","design-system"]
---

# Tables inside detail cards need their own scroll container

**Context**: The deal and company detail People tab was rebuilt as a `Table` primitive inside a detail card (`LinkedPeopleSection`). Cells carried `truncate` and `whitespace-nowrap`, but nothing constrained the table width.

**Problem**: The `Table` primitive renders a bare `<table class="w-full">` with no overflow wrapper. In automatic table layout the columns grow to their content, so long emails and extra columns pushed the table past the card edge and widened the whole backend page; the user saw the layout shifted off-screen ("wszystko się rozwaliło").

**Rule**: When rendering `Table` anywhere other than `DataTable`, give it `table-fixed w-full`, size the secondary columns explicitly and hide them with container-query variants (`@container` on the wrapper, `hidden @3xl:table-cell` on the column) so the table fits the card it lives in, whatever the viewport does; detail cards share the width with a 40% form column, so viewport breakpoints are the wrong signal. `truncate` on a cell child only works once the column has a definite width. Reach for `overflow-x-auto` only for genuinely wide data tables.

An `embedded` `DataTable` has the same gap: it adds no scroll wrapper, keeps a `min-w-[640px]` below `md`, and takes no per-column classes. `LinkedPeopleSection` therefore hosts it in an `@container` wrapper, drops columns from a measured container width and bounds cells through `meta.maxWidth`.

**Applies to**: Any `@open-mercato/ui/primitives/table` usage inside detail cards, dialogs, popovers and tab panels; integration tests that assert the page has no horizontal scroll after rendering such tables.
