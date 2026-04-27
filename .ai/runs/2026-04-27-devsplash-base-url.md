# Devsplash: respect configured base URL across all variants

Date: 2026-04-27
Slug: devsplash-base-url
Branch: `fix/devsplash-base-url`
Owner: pkarw
Status: in-progress

## Goal

Replace hardcoded `localhost` / `127.0.0.1` URLs in the dev splash variants with a single reusable helper that derives the developer-facing URL from `APP_URL` / `NEXT_PUBLIC_APP_URL` / `PORT`, applies smart port handling, and drops the explicit port for standard schemes (80/http, 443/https). The splash and the URLs it prints must match what the developer actually types into their browser when running the app behind a reverse proxy at e.g. `https://devsandbox.openmercato.com`.

## Scope

In scope:

- New helper module `scripts/dev-splash-url.mjs` (pure ESM, dependency-free) that exposes:
  - `parsePortNumber(value)` — already exists in `scripts/dev.mjs`; centralized here.
  - `isStandardPort(scheme, port)` — true for `http:`/80 and `https:`/443.
  - `parseConfiguredBaseUrl(value)` — parse a candidate URL string.
  - `formatBaseUrl({ protocol, hostname, port })` — drops port when standard for scheme.
  - `resolveDevBaseUrl(env, { actualPort })` — main entry point. Reads `APP_URL`/`NEXT_PUBLIC_APP_URL`/`PORT`, applies port-randomization logic, and returns `{ url, hasConfiguredBaseUrl, portWasRandomized }`.
  - `resolveSplashUrl(env, splashPort)` — same scheme/host as the configured app URL, attached to the actual splash port; drops standard ports.
- Apply the helper to every place that currently constructs a localhost URL by hand:
  - `scripts/dev.mjs`: `resolveExpectedAppBaseUrl()` (line ~297) and the splash URL string at the splash bind site (line ~919).
  - `scripts/dev-ephemeral.ts`: the splash URL (line ~424) and the two `http://127.0.0.1:${port}` literals at lines ~952 and ~1131. The ephemeral-mode `APP_URL`/`NEXT_PUBLIC_APP_URL` propagation must respect a parent-process `APP_URL` when set.
- Mirror `scripts/dev-splash-url.mjs` to the standalone create-app template via `scripts/template-sync.ts`'s explicit list (the sync is list-driven, not glob-driven).
- Unit tests for the helper in `scripts/__tests__/dev-splash-url.test.mjs` covering: localhost default, custom HTTPS host, standard port suppression (80/443), non-standard port retention, randomized-port override, missing/invalid env fallback.
- Verify existing `scripts/__tests__/*.test.mjs` still pass with the change.

Non-goals:

- The two `new URL(req.url, 'http://localhost')` calls in the coding-flow / git-repo-flow handlers (they are URL-parsing tricks, not user-facing URLs).
- Changing the ACL/auth model, ephemeral PostgreSQL container, or any other dev-runtime behavior.
- Touching `apps/mercato/scripts/dev.mjs` (it does not contain the localhost hardcodes).
- Touching the splash HTML (it renders state from the parent script, so the helper output flows through automatically).
- Renaming / relocating the existing `parsePortNumber` / `normalizePublicBaseUrl` helpers in `scripts/dev.mjs`. The new helper module imports cleanly and the legacy helpers can stay in place to avoid churn (re-exporting from the new module is enough to dedupe over time).

## External References

None — no `--skill-url` arguments were passed by the requester.

## Implementation Plan

### Phase 1: helper module + unit tests

1.1 Create `scripts/dev-splash-url.mjs` with the API listed in Scope. Pure ESM, no dependencies. Implement the port logic exactly as described:
- If `actualPort` is provided AND a configured port exists AND they differ → "randomized", use `actualPort`, set `portWasRandomized: true`.
- If `actualPort` is provided AND no configured port exists → use `actualPort` if non-standard for the scheme, otherwise drop the port from the URL.
- If `actualPort` is omitted → use the configured port (URL port → `PORT` env → default 3000 for http+localhost / scheme default for explicit configured URL).
- Always drop port `80` for `http:` and `443` for `https:`.

1.2 Create `scripts/__tests__/dev-splash-url.test.mjs` (Node `node:test` runner — same convention as `dev-splash-state.test.mjs`). Cover at minimum:
- localhost default fallback (`{}` env → `http://localhost:3000`).
- localhost with `PORT=4321` → `http://localhost:4321`.
- `APP_URL=https://devsandbox.openmercato.com` → `https://devsandbox.openmercato.com` (no `:443`).
- `APP_URL=http://example.test` → `http://example.test` (no `:80`).
- `APP_URL=http://example.test:8080` with `actualPort=8080` → `http://example.test:8080`.
- `APP_URL=http://example.test:8080` with `actualPort=8123` → `http://example.test:8123` and `portWasRandomized: true`.
- Invalid `APP_URL` (not a URL) → fallback to localhost+`PORT`.
- `NEXT_PUBLIC_APP_URL` used when `APP_URL` is missing.
- `formatBaseUrl({ protocol: 'https:', hostname: 'devsandbox.openmercato.com', port: 443 })` → no port.
- `isStandardPort('http:', 80)` true; `isStandardPort('http:', 443)` false.
- `resolveSplashUrl` with configured HTTPS host + non-standard splash port keeps the splash port.

### Phase 2: apply helper across devsplash variants

2.1 In `scripts/dev.mjs`:
- Import from `./dev-splash-url.mjs`.
- Replace `resolveExpectedAppBaseUrl` body to delegate to `resolveDevBaseUrl(process.env).url`. Keep the function name (it is referenced elsewhere).
- Replace the `splashUrl = \`http://localhost:${address.port}\`` line with `resolveSplashUrl(process.env, address.port)`.
- Keep the local `parsePortNumber` if it is referenced more than once in the file; otherwise delegate to the helper.

2.2 In `scripts/dev-ephemeral.ts`:
- Import from `./dev-splash-url.mjs` (the helper is `.mjs` ESM; the TS file imports as ESM).
- Replace `const splashUrl = \`http://localhost:${address.port}\`` with `resolveSplashUrl(process.env, address.port)`.
- Replace the two `const baseUrl = \`http://127.0.0.1:${port}\`` literals with the helper. The ephemeral runtime should:
  - prefer the parent-process `APP_URL` / `NEXT_PUBLIC_APP_URL` when set, passing `actualPort: port` so the resolved URL reflects the bound port.
  - otherwise fall back to `http://127.0.0.1:${port}` (preserving today's behavior — the ephemeral PostgreSQL is bound to 127.0.0.1, so 127.0.0.1 is the right loopback default for the dev server too).
  - The 127.0.0.1 vs localhost distinction matters for the ephemeral path because the existing readiness probe uses `${baseUrl}/backend/login` and the ephemeral runtime explicitly avoids the 'localhost' alias. Helper option `localhostHost: '127.0.0.1'` covers this.

### Phase 3: template sync

3.1 Add `scripts/dev-splash-url.mjs` to the explicit sync list in `scripts/template-sync.ts` and write the mirrored copy to `packages/create-app/template/scripts/dev-splash-url.mjs`. Also mirror the test file as a sibling under `packages/create-app/template/scripts/__tests__/` only if other dev-splash tests already live there; otherwise, the test is a monorepo-only artifact (existing pattern).

3.2 Run `tsx scripts/template-sync.ts --fix` to ensure both the new file and the updated `dev.mjs` are mirrored to the create-app template.

### Phase 4: validation gate

4.1 Run targeted tests: `node --test scripts/__tests__/dev-splash-url.test.mjs scripts/__tests__/dev-splash-state.test.mjs`.

4.2 Run the full validation gate per the auto-create-pr workflow:
- `yarn build:packages`
- `yarn generate`
- `yarn build:packages` (post-generate)
- `yarn i18n:check-sync`
- `yarn i18n:check-usage`
- `yarn typecheck`
- `yarn test:scripts`
- `yarn test`
- `yarn build:app`

If `yarn build:app` is too slow / risky for an isolated worktree, document the reason and skip with a justification in the Risks section.

4.3 Open PR against `develop`, apply `review` and `bug` + `skip-qa` labels (no customer-facing UI change — only dev tooling output). Post the comprehensive summary comment.

## Risks

- **Misreading "randomized port" semantics for proxy-fronted dev**: when `APP_URL=https://devsandbox.openmercato.com` (port 443 implicit) and the dev server binds locally to 3000, the helper must NOT promote 3000 into the URL — the proxy fronts 443. Mitigation: the helper only treats `actualPort` as authoritative when a configured port exists and they differ. If no configured port exists AND the configured host is non-localhost AND `actualPort` is non-standard, we drop the port (assume proxy). Tests cover this.
- **Breaking ephemeral readiness probe**: ephemeral runtime probes `${baseUrl}/backend/login` against `127.0.0.1`. If the helper rewrites the probe URL to a remote sandbox, the probe would fail. Mitigation: when ephemeral runs WITHOUT a parent `APP_URL`, the helper falls back to `127.0.0.1:port` (same as today). When run WITH a parent `APP_URL`, the runtime keeps a separate `loopbackUrl` for the probe. Implementation Step 2.2 handles this explicitly.
- **Template sync drift**: `template-sync.ts` is list-driven. Forgetting to add the new file would cause `tsx scripts/template-sync.ts` (CI step) to flag drift. Phase 3 explicitly updates the list.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: helper module + unit tests

- [x] 1.1 Create `scripts/dev-splash-url.mjs` with the helper API — 2ba66444b
- [x] 1.2 Create `scripts/__tests__/dev-splash-url.test.mjs` covering all required scenarios — 2ba66444b

### Phase 2: apply helper across devsplash variants

- [ ] 2.1 Update `scripts/dev.mjs` to use the helper
- [ ] 2.2 Update `scripts/dev-ephemeral.ts` to use the helper (splash + ephemeral baseUrl)

### Phase 3: template sync

- [ ] 3.1 Add helper to `scripts/template-sync.ts` SYNC list and mirror to `packages/create-app/template/scripts/dev-splash-url.mjs`
- [ ] 3.2 Run `tsx scripts/template-sync.ts --fix` to mirror the updated `dev.mjs` (and any other touched scripts) into the create-app template

### Phase 4: validation gate

- [ ] 4.1 Run targeted Node tests for the new helper and existing splash state tests
- [ ] 4.2 Run full validation gate (build:packages, generate, i18n, typecheck, test, build:app)
- [ ] 4.3 Open PR against develop with `review`, `bug`, `skip-qa` labels and post summary comment
