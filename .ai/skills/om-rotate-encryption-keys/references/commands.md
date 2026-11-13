# Command discovery and invocation

## Discover before executing

Find the operator-selected application directory and the real executable with
`command -v mercato`; resolve its path without listing environment variables.
Inspect safe top-level `mercato --help`/`mercato help` and owning installed package
metadata to record the CLI/package version. Do not guess a `--version` interface;
the supported CLI does not provide that option. Never mistake a global skill installation
for an installed or compatible application CLI.

In a trusted checkout, inspect `package.json` to confirm the `mercato` script and
package version. The equivalent prefix is `yarn mercato` when that script exists.
Do not assume the shell's global binary belongs to this checkout. Verify the
selected CLI advertises the `entities` module and `rotate-encryption-key` command.
Command-specific help is read-only in the supported dispatcher; if an older
dispatcher's help semantics are unknown, inspect its installed implementation
before invoking a potentially mutating command with `--help`.

After confirming non-mutating help dispatch, use explicit module/command help;
never invoke the rotation handler without `--help` merely to detect it:

```sh
mercato entities --help
mercato entities rotate-encryption-key --help
```

Use `yarn mercato entities --help` and its command-help equivalent only after
confirming that checkout's actual package script.

Use only capabilities actually present in the installed version. Do not assume
command-specific help lists every option. The supported interface below is the
bundled reference; reconcile version differences before mutation. Missing commands,
protection service or supported capabilities are blockers, not permission to change
software, entitlement or protection mode.

## Selected Docker maintenance runtime

Use only an already approved prebuilt maintenance image/profile with its existing private volume, custody and private runtime env file. When that exact runtime/tool invocation was authorized, launch only the ephemeral CLI container with the reviewed profile's `run --rm --no-deps` and no-pull policy; do not ask again for the same selected action. Do not build/pull images, start application/database/Redis services, create volumes or repair permissions as discovery or a rotation side effect.

The compiled maintenance image needs no Next UI/server startup. In the monorepo the application prefix is `node /app/apps/mercato/scripts/mercato-cli.mjs` from `/app/apps/mercato`; in a standalone app it is `node /app/scripts/mercato-cli.mjs` from `/app`. Verify the selected installation's files before use. Direct Node invocation avoids runtime Corepack/Yarn downloads in a nonroot read-only container. The backup configuration inspector uses the corresponding existing standalone Enterprise bin. Runtime capability/rights, source service, provider selections, keys and the actual offline fence remain explicit. Preserve that same volume/profile/bindings across resume; never remove it with `down -v`.

## Select one scope

Use the concrete tenant UUID and, only when intended, organization UUID. An
explicitly authorized all-tenant scope omits both restrictions; there is no
`--all-tenants` flag. Never broaden an unspecified scope to every tenant. Confirm the selected
database identity and intended target provider from nonsecret configuration.
Read [provider selection](providers.md) for the four supported routes. Inject a
previous derived root only for a derived source, or exact retained Vault source
versions/credentials for a Vault source; supply target credentials through the
approved secret manager. Do not print their values or use
the deprecated `--old-key`/`--allow-unsafe-old-key` bridge.

Examples use `mercato`; replace that prefix with the verified `yarn mercato`
checkout script when appropriate. Replace uppercase identifiers before execution;
do not pass placeholder words literally.

```sh
mercato entities rotate-encryption-key --tenant TENANT_UUID --dry-run
mercato entities rotate-encryption-key --tenant TENANT_UUID
mercato entities rotate-encryption-key --tenant TENANT_UUID --org ORGANIZATION_UUID
```

Run the preview first for a fresh authorized rotation and review its actual scope.
The preview performs Core maintenance inspection and bypasses the protection
service: it does not prove backup availability, complete offline admission,
post-rotation correctness or recovery. Do not add `--dry-run` when actually
executing an already authorized rotation. Protected rotation has no supported
option to skip recovery or final persisted-data verification.

## Output and evidence

Human output is on stderr alongside legacy Core stdout summaries. A mapped
"Encrypted N" summary is intermediate; wait for durable verified completion.
`OM_ROTATION_PROGRESS=json` requests existing-schema NDJSON progress on stderr;
capture stdout separately. `OM_ROTATION_PROGRESS=none` suppresses live progress,
not actionable errors. `NO_COLOR` presence (even empty), non-TTY and `TERM=dumb`
produce plain output. Never infer success from color, a progress percentage or a
zero/empty log; inspect the exit code and trusted state/report.

Keep command output locally and redact it before sharing a small aggregate or
screenshot. Do not dump configuration, libpq password files, Vault tokens, key
bytes, record values, backup contents or encrypted expectation chunks. A skill
request does not authorize posting to a tracker or sending messages to others.

## Core-only exception

If protection is unavailable, stop before mutation and explain the red refusal:
resumable encrypted recovery and complete persisted-data verification are absent.
Keep an independently tested backup and every previous key. Do not propose this as
a fallback for a failed protected attempt.

Core-only rotation retains the legacy previous-derived-root interface; it does
not implement Vault-source providers. Only after explicit current-invocation risk
acceptance and an independently authorized compatible Core-only scope, use:

```sh
mercato entities rotate-encryption-key --tenant TENANT_UUID --acknowledge-unprotected-key-rotation
```

Preserve the red unprotected warning after acknowledgment; never label its result
Enterprise-protected or verified. Do not disable a registered protection service,
change module/rights settings or remove a failed run to manufacture this exception.
Every retry needs both current risk authorization and the exact acknowledgment
flag again. A prior acknowledgment, generic rotation instruction or `--force`
does not supply either.
