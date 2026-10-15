# Property Management interactive backend prototype

This directory contains a static, pre-implementation prototype for a standalone office-space
management module, derived from `.ai/prototypes/property-management.requirements.md`: the floor plan and
its unit panels, floors with their spaces and units, Buildings, Leases, Bookings and Settings, plus
the customer-portal Bookings, My lease and notifications screens (screens 27-37).

## Review

Open `index.html` directly, or serve this directory on localhost when browser automation requires HTTP:

```bash
python3 -m http.server 8899 --bind 127.0.0.1
```

Keep the server attached to the current terminal session and stop it immediately after review.

All review controls live in one floating bar at the top. The screen inventory is behind its
**Screens** menu: sections at the top level (Floor plan, Buildings, Leases, Bookings), that
section's screens one level in. Opening the menu expands the section you are currently looking at
and highlights the current screen. Escape or a click outside closes the menu; picking a screen
works in presentation mode too.

The toolbar supports click-through, presentation, and comment modes. Comments are not live collaboration: they remain in this browser until a reviewer chooses **Export for repository**, replaces `comments.js`, and commits the result. The operation-log format preserves independent replies and deletion tombstones when reviewers merge exports.

## Screens

| # | Section |
|---|---------|
| 1–9, 5b, 5c | Floor plan, leasable and bookable unit panels |
| 10–13 | Buildings — list, new, edit, delete |
| 14–19 | Leases — list, new, detail, propose extension, proposal sent, delete |
| 20 | Bookings — all bookings of bookable units |
| 21–26 | Floor — spaces & units, new unit, new space, resize space, edit a leased unit, new common area |
| 27–30 | Customer portal — my bookings, book, review & confirm, booked |
| 31–35 | Customer portal — my lease, no lease, lease ending, extension accepted / declined |
| 36–37 | Customer portal — notifications, nothing new |
| 38 | Unit — edit a bookable unit with upcoming bookings |
| 39 | Floor — make a floor unavailable |
| 40 | Building — archive (blocked while leases and bookings run) |
| 41 | Floor — edit the West Wing (from "Edit floor" on the floor plan) |
| 42 | Settings — sales channel, invoice issue day, cancelled-booking status, lease-ending and reminder lead times |

## Limitations

- **Opening hours and availability**: a building can optionally have opening hours (Edit building,
  screen 12 — switches per day, `prepareSwitches()`), and bookings are only offered inside them.
  A building, floor, space or unit can be made unavailable with a reason and dates — an
  Available switch in every list and edit form (`[data-availability-toggle]` in lists, delegated;
  `data-controls-off` on form switches; floor dialog on screen 39): units inside take no new leases or
  bookings, bookings in the period are cancelled (customers notified), active leases stay but are
  flagged "Unit unavailable" on the Leases list (filter chip; L-2026-009, parking P03), and the area is drawn hatched
  (`.floorplan-unavailable`). Elm Works and the ground-floor Parking are the unavailable
  examples.
  A building can also be archived for good (screen 40): it leaves every list and switcher but
  keeps its records read-only, and archiving is blocked while leases or bookings are still running.

- **Customer portal** (screens 27-37) carries this module's portal pages only: Bookings, My lease
  (with the extension offer) and the bell's booking/lease notifications. The portal nav lists
  Bookings and My Lease; Access, Events, Invoices, Support and Extras belong to other modules and
  are left out, and links into them (e.g. "Ask about other terms") toast. Bookings list every
  bookable unit at a location grouped by floor, each naming its product and space, priced in złoty;
  the review step shows the unit on its
  floor, drawn to scale. Jordan Lee is Office 201,
  Marta Kowalska Office 202 (lease ending). Notification panels are cloned from three
  `<template>`s at the bottom of `index.html` by `preparePortalNotifications()`.

- The HTML illustrates flow and layout; it is not production implementation.
- Destinations owned by other modules — CRM People and Company records, catalog products, sales
  orders and invoices (lease detail, Bookings list), and the
  portal's Extras, Support, Invoices, Events and Access sections — surface the standard "This
  screen does not exist in the prototype" toast naming the real path, rather than a dead link.
- The backend sidebar shows only this module's Facilities group (Floor Plan, Buildings, Leases,
  Bookings, Settings); other modules' groups, including CRM, are left out for clarity.
- The operator is the standard mock company **Acme Corp**. The backend sidebar and the customer-portal
  header (screens 27-37) show a text "AC" mark (`.brand-mark`, DS tokens) beside the name — no
  third-party logos are used.
- The building switcher's 7 locations (Harbor Point, Linden House, Foundry Yard, Millstone Court,
  Northgate, Riverside Tower, Elm Works) are Acme Corp's locations; names and addresses are made up. Only
  Harbor Point has a modeled floor/occupancy dataset; picking another location is illustrative and
  surfaces a toast.
- The floor plan's two bookable units, "BE.02 Studio" (6 seats) and "Ideas Blender" (4 seats), are
  Harbor Point's bookable rooms. Acme Corp sells them as
  "meeting rooms", which is also the catalog category they belong to here; the module's own terms
  are "unit", "leasable unit" and "bookable unit" (see §Units in the requirements).
- Office 202 (Nordic Design Studio, lease ending 30 Sep 2026) is the one lease-expiry example.
  The marker is an annotation, not a status: dashed warning-toned edge plus a clock badge on the
  neutral occupied fill, so it never reads as the solid-amber Unavailable state. Threshold is
  60 days; screen 5c is its detail panel.
- Buildings CRUD (screens 10-13) covers the 7 locations. Building names and addresses
  are made up. Only the Harbor Point record has a modeled edit
  screen — every row opens it. Floors are laid out from two counts (below and above ground, ground
  floor = 0) on both create and edit, and `prepareFloorLayout()` re-lays the table live; names are
  edited inline, and a floor's space and unit counts are read-only there because they are set up on
  the floor's own page (screen 21). On edit, a count cannot drop past a floor that still has units.
  Each floor also has a rectangular size, x × y in metres; the floor plan shows it next to the
  unit counts, and the floor plan is drawn to scale from it: the floor and every unit are
  positioned in metres via CSS custom properties (`--floor-x/--floor-y/--scale-x` on
  `.floorplan-scale`, `--x/--y/--w/--h` on each unit). All floors of a building share one scale.
- **Spaces, units and common areas** (screens 21-26): a floor is divided into spaces (rectangles that never
  overlap; every floor starts with one default space covering it) and holds units — anything that
  can be leased or booked, each sitting in one space. A unit's type is a catalog category and its
  product a catalog product from that category; leasable vs bookable comes from the product.
  Harbor Point's Ground Floor is the divided example (Reception, Coworking, Parking); floors 1-3
  keep their default space. The new-unit form filters products by type
  (`prepareCategoryProducts()`) and both forms validate fit and overlap live against the to-scale
  preview (`prepareLayoutForms()`, `[data-layout-*]` attributes). Categories, products and the
  ground-floor layout are illustrative. Dividing a floor works like partitioning a disk: shrink a
  space first (screen 24), then add one in the freed area; a layout with any unit sticking out of
  its space cannot be saved (`[data-layout-contains]` + `[data-layout-submit]`). Creating and
  resizing are modeled, plus editing a leased unit (screen 25, from Office 202's panel): it can
  be moved or resized, its type and product are locked, and Delete is blocked until its lease and
  bookings are cancelled. A bookable unit's product can change even with upcoming bookings
  (screen 38, from BE.02 Studio's panel); every booking keeps the product and price it was made at
  (the Bookings list's "Booked as" column), and units and leases keep a product history. Units, spaces and common areas are placed by drag and drop on the preview
  (pointer events with capture, 0.5 m snap, arrow keys for keyboard users; a dropped unit adopts the
  space that contains it) — the x, y fields are read-only. Common areas (corridors, kitchens,
  toilets…) belong to the floor, not a space, and are never leased or booked. Other edit/delete
  actions toast.
- Leases (screens 14-19) is the CRUD behind every lease the floor plan reads from, and carries the
  manager's side of the extension offer: screen 16 is the lease before anything was proposed, 17
  composes the offer with a live preview of the card the tenant sees in their portal, and 18 is the
  sent state that screen 5c already refers to. Only the Office 202 lease has a modeled detail
  screen; every row opens it.
- The Bookings list (screen 20) has working filters: the Active/Archived chips, the location
  select and the fulltext search all filter the rows on screen via `prepareTableFilters()`
  (`[data-filterable]` + `data-state`/`data-location` on rows). Units at other locations carry
  generic labels because this prototype does not model their unit catalogs.
- `components.css`, `screens.css` and `prototype.js` contain some styles and helpers for screens not
  included here (access codes). They are inert without matching markup.
- Icons use an embedded SVG sprite instead of `lucide-react`.
- Text is hardcoded instead of translated through `useT()`.
- Sample records must remain synthetic and fictional.
- `tokens.css` is generated. Refresh it with the skill's `sync-tokens.mjs` script rather than editing it.
