# Configurable Calendar Event Types interactive backend prototype

This directory contains a static, pre-implementation prototype for issue #6684, derived from:

- `.ai/specs/2026-09-28-configurable-calendar-event-types.md`
- `.ai/specs/2026-09-28-calendar-event-type-extensions.md`

The two specs are independently deployable. The prototype intentionally composes them into one review journey so administrators, CRM users, and module authors can validate the seam.

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

## Decisions illustrated

- Customers → Dictionaries → Activity types is the only authoritative administrator surface.
- A hidden or deleted definition is unavailable for new selection but never rewrites historical interactions.
- Tenant configuration is bounded to supported behavior and existing custom-field fieldsets.
- Module React wraps or replaces one shared panel while the host `CrudForm` retains submit, locking, mutation guards, and injection spots.
- Destructive type changes list affected values, require server-confirmed intent, and remain undoable.

These are design proposals, not evidence that the production application already implements the behavior. Reviewer comments are local browser data until explicitly exported and committed; they are not live collaboration.
