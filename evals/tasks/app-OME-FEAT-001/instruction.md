# Add a `bookmarks` module to this Open Mercato app

You are working inside a standalone Open Mercato application that was scaffolded with `create-mercato-app`. The app lives at `/app/eval-app` (your current working directory) and depends on the published `@open-mercato/*` packages.

## Goal

Add a new **app-level module** `bookmarks` that lets a user store bookmarks. A bookmark has:

- `title` — **required** text
- `url` — **required**, must be a valid URL
- `note` — **optional** text

Expose full **CRUD over `/api/bookmarks`** and gate it behind appropriate permissions. Add the database migration and register the module so the app picks it up.

## Requirements

- Reuse Open Mercato's core building blocks and follow its architecture and conventions. Use the platform's CRUD route factory rather than hand-writing HTTP handlers or raw SQL.
- The entity must be multi-tenant scoped and support soft deletes, consistent with other Open Mercato entities.
- Validate inputs (an invalid `url` must be rejected). `note` must be optional.
- Gate the API so unauthenticated requests are rejected, and read vs. write require appropriate permissions.
- Add a real database migration for the new table and register the module so its routes are reachable.
- After adding module files, make sure code generation is up to date so the app builds cleanly.

## Constraints

- **Edit only within `/app/eval-app/`.** Do **not** modify anything inside `node_modules/` or the `@open-mercato/*` packages — extend the platform, don't fork it.
- The app must build successfully and existing checks must keep passing.

## Reference

This app already enables core modules (auth, directory, configs, entities, query_index, etc.). Open Mercato ships extensive guidance in the app's `AGENTS.md` and package docs — consult them for the canonical module layout, the CRUD route factory, entity conventions, access control, migrations, and module registration.
