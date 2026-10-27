# Notify — forms → core

Append-only. Things the reviewer or the repo owner must see, newest last.

- **Three new production dependencies in `packages/core`**: `ajv`, `ajv-formats`, `pdf-lib`.
  Root `AGENTS.md` requires asking before adding production deps. They are intrinsic to the
  migrated module (JSON Schema compilation of form versions; PDF submission snapshots), so the
  alternative is not migrating it. Reversible only by dropping the module.
- **The `forms:embed` injection mapping was removed** relative to the source repo. Nothing in this
  repo mounts that spot id, and the `embedded-form` widget is documented as the generic primitive
  host modules map against a spot of their own. A downstream module that rendered
  `<InjectionSpot spotId="forms:embed">` against the official-modules copy would have to declare
  its own spot. Worth an `UPGRADE_NOTES.md` line if the official-modules package is ever deprecated
  in favour of this one.
- **`official-modules` still contains `packages/forms`.** Retiring it there is a separate PR in a
  separate repository. Until that lands the two copies can drift, so it should follow closely.
- **The module's internal runner was shipping raw i18n keys to users.** `forms.runner.actions.*`
  were referenced with no fallback and no locale entry, so `/forms/<id>/run` rendered
  "forms.runner.actions.next" as a button label. Fixed here; worth knowing the standalone package
  had no gate that could catch it.
- **A module-level `packages/core/src/modules/forms/AGENTS.md` may not be admissible.**
  `yarn agents:check-budget` already rejects a single-line addition to `packages/core/AGENTS.md`'s
  module table because the `packages/core/src/modules/sales` instruction chain is ~44 KB over the
  32 KB agent budget and an over-budget chain may only shrink. Decide deliberately.
- **`/embed/:slug` ships inert.** Cross-origin framing is blocked by this repo's global
  `frame-ancestors 'self'` / `X-Frame-Options: SAMEORIGIN` on `/:path*`. The per-distribution
  framing header the module documents has never been implemented anywhere — the source repo's own
  sandbox app declares no `headers()` block at all, so `/embed/:slug` was framable there by default
  rather than by policy. Wiring it is new feature work whose failure mode is clickjacking, needs a
  browser to verify Next.js header precedence, and needs module-specific code in the proxy that root
  `AGENTS.md` forbids. Deferred with the reasoning in the spec's § Known limitations; the misleading
  doc comments on `frontend/embed/[slug]/page.meta.ts` and the `embed-policy` route were corrected
  so nobody reads them as "already works".
- **Two routes were unauthenticated AND unscoped by tenant**: `GET /api/forms/:id/run/context` and
  `POST /api/forms/:id/run/submissions`. `run/context` returned the full schema + uiSchema of any
  active published form in any tenant to anyone holding the form UUID, bypassing the distribution
  gate, CAPTCHA and rate limiter. Both are now authenticated and tenant-scoped. Worth a look during
  review: this changes `/forms/:id/run` from anonymous to authenticated.
- **Six submission commands were never registered** — `commands/index.ts` did not import
  `./submission`. Fixed. `forms.submission.{start,save,submit,reopen,assign_actor,revoke_actor}`
  would have failed at call time.
- **The forms tables are singular** (`forms_form`, `forms_distribution`, …) against this repo's
  plural convention — 234 of 250 core tables are plural. Left alone deliberately: renaming eleven
  tables would break every existing official-modules installation and needs a data migration, which
  a behaviour-preserving migration should not smuggle in.
