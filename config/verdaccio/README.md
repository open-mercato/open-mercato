# Local registry authentication and upload capacity

`config.yaml` limits each request body to **200 MiB** (`max_body_size: 200mb`).
This is a development registry limit, not a package tarball size limit. npm
publishes a JSON document containing the tarball as base64, which takes
`4 * ceil(tarballBytes / 3)` bytes, plus package metadata and JSON overhead.
The reported 40.3 MB core tarball therefore requires at least 53.7 MB before
metadata; the previous 50 MiB limit rejected it with HTTP 413. The bounded
200 MiB limit leaves room for the current package and growth without allowing
unlimited uploads. Reassess it when the encoded payload approaches capacity.

The default infrastructure Compose service publishes port 4873 only on
`127.0.0.1`. `VERDACCIO_PORT` changes the port while keeping loopback binding.
A non-loopback bind requires an explicit `VERDACCIO_HOST` override. For access
from another machine, prefer an SSH tunnel. Package reads stay available to development clients. The bundled configuration permits first-party writes only to the `mercato-publisher` account and disables self-registration. Apply external request and concurrency limits when sharing the registry.

After the normal `yarn build:packages`, `yarn generate`, `yarn build:packages`
sequence, pack and measure a current package:

```sh
cd packages/core
yarn pack --out /tmp/open-mercato-core.tgz
cd ../..
node scripts/registry/check-upload-capacity.mjs /tmp/open-mercato-core.tgz
node --test scripts/__tests__/registry-upload-capacity.test.mjs
rm /tmp/open-mercato-core.tgz
```

The probe sends npm's actual publish JSON to a temporary loopback HTTP sink,
counts its bytes, compares them with the checked-in capacity, and exits nonzero
if it exceeds the limit. It stores no package in a registry, disables lifecycle
scripts and provenance, and uses disposable fake auth and cache files. Output
includes tarball bytes, request bytes, capacity, and remaining headroom. The
regression also covers the reported payload using both decimal MB and binary
MiB, with 1 MiB reserved for metadata; the probe measures actual metadata.

Verify the native publish/scaffold/install/generate flow with:

```sh
yarn test:create-app --no-shell
```

The native smoke resets its disposable local registry and provisions a random publisher credential. For a persistent or externally managed development registry, provision `mercato-publisher` in the registry’s htpasswd file using a bcrypt hash and a unique password. `yarn registry:setup-user` signs in to that existing account. Supply its token from your secret store for automated publishing.

```sh
VERDACCIO_URL=http://localhost:14873 VERDACCIO_TOKEN="$PUBLISHER_TOKEN" yarn registry:publish
```

Supplying the token preserves the existing registry volumes. The command still replaces the matching package versions as part of republishing, so use a registry and package namespace you control. Inspect and rebuild any reused registry that previously accepted public writes before trusting its stored artifacts.

A fresh `YARN_GLOBAL_FOLDER` keeps cached tarball URLs from another local
registry from redirecting the standalone install to an old port.

Recreate an existing Compose registry after upgrading to apply the loopback port
binding; restarting a container alone retains its previous published ports:

```sh
docker compose --project-directory . -f starters/docker/compose.infra.yml \
  --profile registry up -d --force-recreate verdaccio
```

Recreation also reloads the publishing policy and request-size configuration.
