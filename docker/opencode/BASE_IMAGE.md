# OpenCode base image — build & publish

The OpenCode CLI is baked into a **base image** (`Dockerfile.base`) that is built
and pushed to a registry once. The service image (`Dockerfile`) starts `FROM`
that base and only layers in this project's `AGENTS.md`, agents, skills, and
entrypoint.

**Why:** the old service `Dockerfile` ran `curl https://opencode.ai/install | …`
on every build. Behind a corporate TLS-intercepting proxy that download fails
(`self-signed certificate in certificate chain`), and even on a good network it
is slow and rate-limitable. Downloading once into a base image removes that step
from every app/dev build — rebuilds become a few seconds of `COPY`, and corporate
machines only need to `docker pull` an already-built image.

Current pin: **OpenCode 1.18.3**. Registry: **`docker.io/openmercatocom/open-mercato-opencode`**.

---

## Prerequisites

```bash
docker login                      # authenticate to Docker Hub (openmercatocom)
```

## Build & push (multi-arch — required)

Corporate Windows/Rancher machines are **linux/amd64**; Apple-Silicon dev
machines are **linux/arm64**. A single-arch image pushed from the wrong host
will not run on the other, so build both with `buildx` and push in one shot.

```bash
# from the repo root
docker buildx create --use --name om-builder 2>/dev/null || docker buildx use om-builder

docker buildx build \
  --file docker/opencode/Dockerfile.base \
  --platform linux/amd64,linux/arm64 \
  --build-arg OPENCODE_VERSION=1.18.3 \
  --tag docker.io/openmercatocom/open-mercato-opencode:1.18.3 \
  --tag docker.io/openmercatocom/open-mercato-opencode:latest \
  --push \
  docker/opencode
```

> The build context is `docker/opencode` (last argument) so the cert anchor in
> `Dockerfile.base` can reuse `AGENTS.md` + `certs/`.

### Single-arch fallback (amd64 only)

If `buildx` is unavailable, build at least the amd64 image the target machines
need (run this on an amd64 host, or it will emulate slowly):

```bash
docker build \
  --file docker/opencode/Dockerfile.base \
  --platform linux/amd64 \
  --build-arg OPENCODE_VERSION=1.18.3 \
  --tag docker.io/openmercatocom/open-mercato-opencode:1.18.3 \
  docker/opencode
docker push docker.io/openmercatocom/open-mercato-opencode:1.18.3
```

## Verify the pushed image

```bash
docker run --rm --entrypoint sh docker.io/openmercatocom/open-mercato-opencode:1.18.3 \
  -c 'opencode --version'          # -> 1.18.3
docker buildx imagetools inspect docker.io/openmercatocom/open-mercato-opencode:1.18.3 \
  | grep -i platform               # -> linux/amd64 and linux/arm64
```

## After a push, the service image just works

`docker/opencode/Dockerfile` defaults to
`docker.io/openmercatocom/open-mercato-opencode:1.18.3`, so once the base is
pushed:

```bash
docker compose -f docker-compose.fullapp.dev.yml build opencode   # pulls base, COPYs project files
```

Override the base per build without editing the Dockerfile:

```bash
docker build --build-arg OPENCODE_BASE_IMAGE=docker.io/openmercatocom/open-mercato-opencode:1.18.3-rc docker/opencode
```

---

## Bumping the OpenCode version

The pin is a **breaking-risk** change — the `opencode.jsonc` schema written by
`entrypoint.sh` (provider / `mcp` / `permission` / `tools` / `server`) and the
agent-file/skill contract are validated against a specific tag.

1. Edit `OPENCODE_VERSION` in `Dockerfile.base` and the tag + `OPENCODE_BASE_IMAGE`
   default in `Dockerfile` (keep them in lockstep).
2. Rebuild + push the base (commands above) with the new tag.
3. Re-verify: `docker compose -f docker-compose.fullapp.dev.yml up` and exercise
   a Cmd+K → tool-call → MCP round-trip. Startup already logs
   `opencode server listening on http://0.0.0.0:4096` when the config is accepted.

**1.18.3 note:** newer OpenCode logs `OPENCODE_SERVER_PASSWORD is not set; server
is unsecured` at startup. The dev/prod compose stacks keep the OpenCode port
off the public interface (published on localhost in dev, internal in prod), so
this is informational; set `OPENCODE_SERVER_PASSWORD` if you ever expose it.
