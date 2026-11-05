# Corporate proxy root CAs (opencode image)

Mirror of `docker/certs/` for the opencode image, which builds from its own
context (`docker/opencode/`). Put PEM files (`*.crt` / `*.pem`) in
`docker/certs/` — the Windows launcher copies them here automatically; when
building manually, copy them yourself.

Everything in this directory except this README is gitignored — never commit
a certificate.
