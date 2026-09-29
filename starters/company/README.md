# Company overlay

Tailor the starter (`@open-mercato/starter`, run via `yarn om` / `npx @open-mercato/starter`) to your organization **without forking it**. The starter merges, in order:

1. built-in defaults
2. `starters/company/config.mjs` — committed, your org's policy
3. `starters/company/config.local.mjs` — gitignored, per-machine overrides

Copy `config.example.mjs` to `config.mjs` and edit. Everything is optional.

What you can tailor:

| Key | Effect |
|-----|--------|
| `name`, `itContact` | Shown in banners and at the end of the doctor's "hand this to IT" sheet |
| `mirrors.npmRegistry` | Used for `corepack`/`yarn install` (`COREPACK_NPM_REGISTRY`, `YARN_NPM_REGISTRY_SERVER`) |
| `mirrors.alpineMirror` | Forwarded to image builds as `ALPINE_MIRROR` |
| `mirrors.nodeDist` | Mirror of `https://nodejs.org/dist` for the platform bootstraps (`OM_NODE_DIST_MIRROR`) |
| `certs.bundles` | Corporate root CA PEM file(s) — the preferred source of TLS trust; capture is the fallback |
| `certs.capture` | Set `false` to forbid active interception-CA capture on audit-sensitive fleets |
| `checks` | Extra doctor checks (VPN posture, internal endpoints, ...) |
| `steps.disable` / `steps.extra` | Skip built-in setup steps or append your own (same `{ id, title, check, apply }` shape) |
| `env` | Extra `.env` defaults (fill-missing-only — never overwrites) |
