# Step 6 — Validation, self-review, and hard rules

## 6.1 Script-probed validation gate

A standalone app ships a subset of the monorepo scripts (see
`../references/standalone-layout.md` § 3). Probe `package.json` and run only what exists — skip
and **log** monorepo-only scripts (`build:packages`) rather than failing:

```bash
has_script() { node -e "process.exit(require('./package.json').scripts?.['$1'] ? 0 : 1)"; }
```

1. **Generate**: `yarn generate` — the integration is discovered.
2. **Typecheck**: `yarn typecheck` — must pass.
3. **Tests**: `yarn test` — must pass.
4. **Build**: `yarn build` — must pass.
5. **Dev server**: `yarn dev` — integration visible in `/backend/integrations`.
6. **Health check + credential save**: exercise via the admin panel.

## 6.2 Self-review checklist

- [ ] `integration.ts` exports a valid `IntegrationDefinition` with all required fields
- [ ] `credentials.fields` covers all secrets needed; secret fields use `type: 'secret'`
- [ ] Adapter implements ALL methods of the hub contract (no partial implementations)
- [ ] Status mapping covers ALL known provider statuses with an `'unknown'` fallback
- [ ] Webhook signature verification uses the provider SDK or timing-safe comparison
- [ ] Health check validates real connectivity (not just credential format)
- [ ] No credentials stored in memory or logged — resolve fresh from the `credentials` param
- [ ] i18n: all user-facing strings in locale files, no hardcoded strings
- [ ] ACL features declared and assigned in `setup.ts` `defaultRoleFeatures`
- [ ] Workers export `metadata` with `{ queue, id, concurrency }`
- [ ] Widget injection table maps widgets to correct spots
- [ ] Unit tests for status mapping, webhook verification, client factory
- [ ] No `any` types — use zod schemas with `z.infer`, narrow with runtime checks
- [ ] Package-level imports (`@open-mercato/<pkg>/...`) for cross-module references

## 6.3 Hard rules

- **MUST** build the provider as a module under `src/modules/<module_id>/` (standalone) — never edit framework source under `node_modules/@open-mercato/*/dist/`.
- **MUST** export `integration.ts` at the module root for marketplace discovery.
- **MUST** register the module in the app-root `src/modules.ts`.
- **MUST** implement the FULL adapter contract for the chosen hub category.
- **MUST** encrypt credentials at rest — never store raw secrets; use the `IntegrationCredentials` service.
- **MUST** use the provider SDK for webhook signature verification when available.
- **MUST** use timing-safe comparison for any manual HMAC verification.
- **MUST** map ALL known provider statuses to unified statuses with an `'unknown'` fallback.
- **MUST** add a health check that validates real connectivity.
- **MUST** add a webhook setup guide (`helpDetails`) on webhook-secret credential fields.
- **MUST** add i18n translations — no hardcoded user-facing strings.
- **MUST** run `yarn generate` after creating/modifying module files.
- **MUST** declare ACL features and wire them in `setup.ts` `defaultRoleFeatures`.
- **MUST** follow the `gateway-stripe` reference implementation patterns (read it on GitHub / docs — it is not on disk in a standalone app).
