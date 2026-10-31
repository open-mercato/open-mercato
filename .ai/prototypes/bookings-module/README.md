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
- The backend shell (sidebar, top bar, footer) is rendered by one inline script from each frame's `data-shell`, `data-nav` and `data-crumbs`, so all 25 screens share one navigation. It runs before `prototype.js`, so comment anchors stay stable.
- Screen 24 (public booking page) has no backend shell. `om-mockup-prototype` has no pattern for public pages, so its layout is illustrative only.

## How to read it

- Every screen carries its phase. Phase 1 is the first delivery; phases 2–4 are the roadmap of the specification. The **Phase** filter in the toolbar shows one phase at a time.
- A **State** switch under a screen title shows the states its user stories require: first run, refusal, conflict, empty, and so on.
- References under each title point to sections (`§`) and user stories (`US-`) of the specification.

## Screens

| # | Screen | Phase | Stories |
|---|---|---|---|
| 1 | Bookings settings | 1 | US-A1, US-A2, US-A3 |
| 2 | Timeline | 1 | US-D1, US-D2 |
| 3 | Timeline — edit mode | 1 | US-C2 |
| 4 | New reservation | 1 | US-C1 |
| 5 | Reservation card | 1 | US-C6, US-C5, US-C3 |
| 6 | Unplaced list — place by drag | 1 | US-D3, US-C4 |
| 7 | Inspection or breakdown | 1 | US-C7 |
| 8 | Reservations | 1 | §20 tables |
| 9 | Subjects | 1 | US-B5, US-B3 |
| 10 | Add a new subject | 1 | US-B1 |
| 11 | Add existing subjects | 1 | US-B2 |
| 12 | Categories | 1 | US-B3 |
| 13 | Targets | 1 | US-B4 |
| 14 | Notifications | 1 | US-D4 |
| 15 | Timeline — viewer | 1 | US-D5 |
| 16 | Visit in minutes with a second participant | 2 | US-F1, US-F2, US-F5 |
| 17 | Confirm warnings | 2 | US-F4 |
| 18 | Calendar view | 2 | US-F3 |
| 19 | Timeline — hourly scale | 2 | §11, §18 |
| 20 | Catalog product — Booking section | 3 | US-G1, US-G4 |
| 21 | Visit with several services and pools | 3 | US-G5, US-G2 |
| 22 | First free dates | 3 | US-G3 |
| 23 | Booking pages | 4 | US-H1 |
| 24 | Public booking page | 4 | US-H2, US-H4 |
| 25 | Confirm or decline a request | 4 | US-H3 |

Not drawn, because they have no screen: US-E1 and US-E2 (extension points and the occupancy service), US-G6 (services defined in code) and the e-mail of US-H4.

## Assumptions not in the specification

- Menu placement: a "Bookings" group (Timeline, Reservations, Calendar, Subjects, Targets, Categories, Booking pages) and "Bookings settings" under Settings.
- Sample domains: construction equipment and sites for phase 1, a dental clinic for phases 2–4, a hotel night for US-G4.
- The Unplaced list sits next to the timeline as a side panel.
