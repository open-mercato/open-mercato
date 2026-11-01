# Bookings Module interactive backend prototype

This directory contains a static, pre-implementation prototype derived from `.ai/specs/2026-08-10-bookings-module.md`.

## Review

Open `index.html` directly, or serve this directory on localhost when browser automation requires HTTP:

```bash
python3 -m http.server 8899 --bind 127.0.0.1
```

Keep the server attached to the current terminal session and stop it immediately after review.

The toolbar supports click-through, presentation, and comment modes. Comments are not live collaboration: they remain in this browser until a reviewer chooses **Export for repository**, replaces `comments.js`, and commits the result. The operation-log format preserves independent replies and deletion tombstones when reviewers merge exports.

## Limitations

- The HTML illustrates flow and layout; it is not production implementation.
- Icons use an embedded SVG sprite instead of `lucide-react`.
- Text is hardcoded instead of translated through `useT()`.
- Sample records must remain synthetic and fictional.
- `tokens.css` is generated. Refresh it with the skill's `sync-tokens.mjs` script rather than editing it.
- The backend shell (sidebar, top bar, footer) is rendered by one inline script from each frame's `data-shell`, `data-nav` and `data-crumbs`, so all 24 screens share one navigation. It runs before `prototype.js`, so comment anchors stay stable.
- Screen 24 (public booking page) has no backend shell. `om-mockup-prototype` has no pattern for public pages, so its layout is illustrative only.

## Changes after the first design review (2026-11-01)

- Presentation mode: toolbar links switch screens, and the screen title with its state switch stays visible.
- Targets and Booking pages were greyed out in every state: the backdrop of a hidden drawer showed. Fixed for all screens.
- Settings (1): one column, sections numbered in the order they unlock.
- Timeline (2): a conflict is marked once (icon and red edge); Calendar is a view switch on the page and replaces the hourly scale (former screen 19, removed). §11 of the specification has both, to be confirmed.
- Menu: "Bookings" (Timeline, All bookings), "Bookings setup" (Subjects, Targets, Categories, Booking pages), "Settings".
- Edit mode (3): how-to note, resize handles on bar edges; while dragging, the bar shows its new dates and duration.
- Card (5): a side panel next to the timeline instead of a drawer over it.
- Unplaced (6): Place… button with a dialog, next to drag and drop.
- All bookings (8): renamed from Reservations; filters and the row menu shown.
- Subjects (9–11): filters; the kind buttons switch the add form's fields; Add existing explains what it is for.
- Targets (13): filters and the row menu.
- Categories (12): New category dialog.
- Booking pages (23): New page and Created states.

Screen numbers are kept, so comments and references stay valid; 19 is unused.

## Changes after the specification review of #8250 (2026-11-01)

- Phase filter: with a phase selected, controls and menu items of later phases are hidden inside the screens (for example the Calendar switch on screen 2 and Booking pages in the menu at phase 1), so no link leads to a filtered-out screen.
- Viewer (15): the shell follows the user's features. The menu shows only Timeline and All bookings, and the bell has no bookings notifications.
- Loading, empty and failed-read states on Timeline (2), All bookings (8), Subjects (9) and Targets (13), drawn after `LoadingMessage`, `ErrorMessage` and the `DataTable` loading, error and empty rows. Every failed read offers Try again.

## How to read it

- Every screen carries its phase. Phase 1 is the first delivery; phases 2–4 are the roadmap of the specification. The **Phase** filter in the toolbar shows one phase at a time and hides what later phases add to the screens.
- A **State** switch under a screen title shows the states its user stories require: first run, refusal, conflict, empty, and so on.
- References under each title point to sections (`§`) and user stories (`US-`) of the specification.

## Screens

| # | Screen | Phase | Stories |
|---|---|---|---|
| 1 | Bookings settings | 1 | US-A1, US-A2, US-A3 |
| 2 | Timeline | 1 | US-D1, US-D2 |
| 3 | Timeline — edit mode | 1 | US-C2 |
| 4 | New reservation | 1 | US-C1 |
| 5 | Reservation card (side panel) | 1 | US-C6, US-C5, US-C3 |
| 6 | Unplaced list — place by drag | 1 | US-D3, US-C4 |
| 7 | Inspection or breakdown | 1 | US-C7 |
| 8 | All bookings | 1 | §20 tables |
| 9 | Subjects | 1 | US-B5, US-B3 |
| 10 | Add a new subject | 1 | US-B1 |
| 11 | Add existing subjects | 1 | US-B2 |
| 12 | Categories | 1 | US-B3 |
| 13 | Targets | 1 | US-B4 |
| 14 | Notifications | 1 | US-D4 |
| 15 | Timeline — viewer | 1 | US-D5 |
| 16 | Visit in minutes with a second participant | 2 | US-F1, US-F2, US-F5 |
| 17 | Confirm warnings | 2 | US-F4 |
| 18 | Calendar view (also replaces the hourly scale) | 2 | US-F3, §11, §18 |
| 20 | Catalog product — Booking section | 3 | US-G1, US-G4 |
| 21 | Visit with several services and pools | 3 | US-G5, US-G2 |
| 22 | First free dates | 3 | US-G3 |
| 23 | Booking pages | 4 | US-H1 |
| 24 | Public booking page | 4 | US-H2, US-H4 |
| 25 | Confirm or decline a request | 4 | US-H3 |

Not drawn, because they have no screen: US-E1 and US-E2 (extension points and the occupancy service), US-G6 (services defined in code) and the e-mail of US-H4.

## Assumptions not in the specification

- Menu placement: a "Bookings" group (Timeline, All bookings), a "Bookings setup" group (Subjects, Targets, Categories, Booking pages) and "Bookings settings" under Settings. Calendar is a view switch on the Timeline page, not a menu item.
- Sample domains: construction equipment and sites for phase 1, a dental clinic for phases 2–4, a hotel night for US-G4.
- The Unplaced list sits next to the timeline as a side panel.
