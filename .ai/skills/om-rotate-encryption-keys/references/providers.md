# Four protected provider routes

Use these capabilities only when the installed Enterprise runtime supports them.
All require the same offline fence, independent custody, encrypted recovery and
complete persisted-data verification. A dry-run does not certify provider admission.

| Route | Previous source | New target |
| --- | --- | --- |
| derived → derived | Retained previous derived root | Distinct retained derived root |
| derived → vault | Retained previous derived root | Already staged, current Vault DEKs at exact versions |
| vault → derived | Exact retained old Vault versions | Distinct retained derived root |
| vault → vault | Exact retained old Vault versions | Already staged current versions, same or separate location |

Set `OM_ROTATION_SOURCE_PROVIDER` and `OM_ROTATION_TARGET_PROVIDER` to `derived`
or `vault`. Source defaults to `derived` for compatibility. The existing
`OM_ROTATION_KMS_PROVIDER` is a target alias; unequal explicit selectors refuse.
Do not infer the source from an available fallback secret or silently change routes.

## Derived selection

A derived source requires `TENANT_DATA_ENCRYPTION_OLD_KEY` from approved secret
custody. It is a root, never a raw Vault DEK; each tenant's key is derived from it.
An all-tenant derived-source invocation requires every selected tenant to share
that root. Different roots require separate authorized scopes/runs.

A derived target selects `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` when configured,
otherwise `TENANT_DATA_ENCRYPTION_KEY`. Review precedence and retain the exact new
root; do not generate one during a generic rotation request. The ordinary app
factory prefers configured healthy Vault, so Vault→derived application cutover
also requires disabling ordinary `VAULT_ADDR`/`VAULT_TOKEN` selection and deploying
the exact selected derived root. The rotation selector does not do that for you.

## Vault selection

The implementation uses KV v2 raw application DEKs, not Transit or automatic KEK
rotation. Set these for each selected Vault role:

- `OM_ROTATION_SOURCE_VAULT_ADDR`, `_TOKEN`, `_KV_PATH`, `_VERSIONS_FILE`.
- `OM_ROTATION_TARGET_VAULT_ADDR`, `_TOKEN`, `_KV_PATH`, `_VERSIONS_FILE`.

These suffixes share their full role prefix. Target address/token/path may use
legacy `VAULT_ADDR`, `VAULT_TOKEN`, `VAULT_KV_PATH` (default path `secret/data`).
Source has no implicit target fallback. Target application configuration must use
the same selected target location/keys through ordinary `VAULT_*` settings.
Independent source/target tokens or clusters/prefixes are supported.

Require HTTPS origin URLs with no credentials, path, query or fragment. HTTP is
allowed only for literal 127.0.0.1 / ::1 isolated fixtures, not Docker DNS names.
Redirects refuse. Use reviewed runtime read credentials, not a provisioning token.
HTTP key path `secret/data/app` means the CLI logical path `app/tenant_key_UUID`
under `-mount=secret`; never double the `/data` segment.

For each Vault role retain an owner-only exact-scope manifest:

```json
{"schemaVersion":1,"versions":{"11111111-1111-4111-8111-111111111111":2}}
```

Every selected canonical tenant UUID must appear once, with a positive integer
version. Missing/extra tenants and wildcard/default versions refuse. For all tenants,
inventory the union of nonnull tenant IDs from `encryption_maps` and
`custom_entities_storage`, in canonical sorted order; at most 10,000 are supported.
Close the diagnostic DB connection before the protected CLI opens its own.

Source reads the exact retained older version. Target reads its exact selected
version **and current latest**, requiring both version and key bytes to agree at
every refresh and before durable completion. Same-path old v2 → new v3 is supported;
different tenants may pin different version pairs. Identities bind endpoint/path
and the exact sorted version-map digest without tokens or key bytes. No fallback,
automatic provisioning, old-version overwrite or deletion occurs.

## Provisioning and release remain separate

A DEK is tenant-wide across organizations; a derived target root is shared across
the application's tenants. A changed app Vault prefix/endpoint can span that whole
key domain too. A scoped `--org` or single-tenant pass is not global cutover proof.
Keep the full offline fence until every tenant/org sharing the changed key/root
uses the same intended target. If old roots differ, perform separately authorized
per-tenant phases in the same offline window without restarting apps between them.
Do not broaden a phase's mutation scope without authorization. Excluded system-key
and independent inner-secret owners must confirm compatibility with the new shared
profile; otherwise keep the fence. Never turn a scoped report into an app-release
authorization or silently retire the remaining old-key data.

Before an explicitly authorized operator stages a new Vault latest version, the
fence must already be in place and old versions/custody must be retained.
Vault DEK automation must stay paused through verification and controlled app
cutover. Refresh detects observed drift, not future latest changes after return.
Review mount/per-key `max_versions` and `delete_version_after`: new writes can destroy
older versions needed by historical backups. Do not alter retention automatically.
Provision a fresh 32-byte canonical-base64 `key` field through a private file/stdin
and CAS: zero for a new path, the observed current version for an existing path.
Never put `key=SECRET` in argv. CAS conflict stops; do not blindly retry with a new
expected version. This is a separately authorized provisioning workflow, not a
side effect of this skill's prepare/rotate modes.

Do not invent an ordinary application `VAULT_KV_VERSION` flag: the normal KMS reads
latest. After derived→Vault, retain the old derived root separately before removing
unwanted active fallback roots. After Vault→derived, retain source Vault versions
while deploying the selected derived root and disabling normal Vault selection.
Review/restart all replicas to flush old caches only as part of a separately
authorized maintenance release. Never automatically release the fence or retire keys.

If latest changes, a source version disappears, a provider fails or bindings differ,
keep writers stopped and report the actual failure. A new latest version can make
an original run ineligible for resume even if bytes happen to match; do not rewrite
pins, roll back live Vault, delete locks or create a new baseline to force success.
Use retained custody for an independently approved quarantine recovery decision.
Vault-source routes require the Enterprise adapter; Core risk acknowledgment does
not create this capability.
