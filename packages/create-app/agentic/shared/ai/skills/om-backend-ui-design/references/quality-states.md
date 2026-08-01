# UI Quality and States

Load this reference for the final UI quality pass.

- Reuse shared page/section/form/table/detail/chart/KPI/schedule/message/notification/banner families.
- Use semantic design tokens, `StatusBadge`, `Alert`, standard buttons/dialogs, `FormField`, `SectionHeader`, `CollapsibleSection`, and shared loading/error/empty components.
- Translate titles, labels, actions, placeholders, validation, states, notifications, and navigation with client/server translation helpers.
- Preserve input after errors, focus the first invalid field, disable duplicate submits, and announce async results accessibly.
- Support Cmd/Ctrl+Enter and Escape in dialogs; label icon-only controls; retain keyboard/focus/reduced-motion behavior.
- Make server/client first render deterministic across locale, timezone, environment, random values, and browser-only APIs.
- Verify narrow/wide layout and long/translated content. Do not use hard-coded status colors, arbitrary text sizes, raw forms/fetch, or inline SVG.
