# Local registry upload capacity

`config.yaml` limits each request body to **100 MiB** (`max_body_size: 100mb`).
This is a development registry limit, not a package tarball size limit. npm
publishes a JSON document containing the tarball as base64, which takes
`4 * ceil(tarballBytes / 3)` bytes, plus package metadata and JSON overhead.
The reported 40.3 MB core tarball therefore requires at least 53.7 MB before
metadata; the previous 50 MiB limit rejected it with HTTP 413. The bounded
100 MiB limit leaves room for the current package and growth without allowing
unlimited uploads. Reassess it when the encoded payload approaches capacity.

The default infrastructure Compose service publishes port 4873 only on
`127.0.0.1`. `VERDACCIO_PORT` changes the port while keeping loopback binding.
A non-loopback bind requires an explicit `VERDACCIO_HOST` override. For access
from another machine, prefer an SSH tunnel. Before sharing the registry on a
network, configure authenticated publishing and external request/concurrency
limits; the bundled anonymous development configuration is for loopback use.

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

The native smoke resets its local development registry and publishes all packages.
Use an owned disposable registry if the default registry is shared:

```sh
docker run -d --name om-upload-check -p 127.0.0.1:14873:4873 \
  -v "$PWD/config/verdaccio/config.yaml:/verdaccio/conf/config.yaml:ro" \
  verdaccio/verdaccio:6
UPLOAD_CHECK_YARN_DIR=$(mktemp -d)
VERDACCIO_URL=http://localhost:14873 OM_SKIP_VERDACCIO_BOOTSTRAP=1 \
  YARN_GLOBAL_FOLDER="$UPLOAD_CHECK_YARN_DIR" yarn test:create-app --no-shell
docker rm -f om-upload-check
rm -rf "$UPLOAD_CHECK_YARN_DIR"
```

A fresh `YARN_GLOBAL_FOLDER` keeps cached tarball URLs from another local
registry from redirecting the standalone install to an old port.

Recreate an existing Compose registry after upgrading to apply the loopback port
binding; restarting a container alone retains its previous published ports:

```sh
docker compose --project-directory . -f starters/docker/compose.infra.yml \
  --profile registry up -d --force-recreate verdaccio
```

Recreation also reloads the request-size configuration. These limits and
anonymous publishing settings are intended for local development.
