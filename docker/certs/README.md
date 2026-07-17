# Corporate proxy root CAs

If your network runs a TLS-intercepting proxy (Zscaler, Netskope, Blue Coat, …),
every HTTPS download inside `docker build` fails with errors like
`TLS: server certificate not trusted` or `unable to get local issuer certificate`,
because the proxy re-signs traffic with a corporate root CA that your OS trusts
but containers do not.

Drop that root CA here as one or more **PEM** files named `*.crt` or `*.pem`
(one certificate per file). The app image build trusts everything in this
directory (apk, node, yarn — via the system bundle and `NODE_EXTRA_CA_CERTS`),
and the Windows launcher (`scripts/windows/start-dev.ps1`) mirrors these files
into `docker/opencode/certs/` so the opencode image build trusts them too.

The Windows launcher also detects this failure automatically and exports the
proxy's root certificate here as `corporate-proxy-root.crt` before retrying.

To export the certificate manually on Windows: open `https://example.com` in
Edge/Chrome, inspect the certificate chain, export the **topmost (root)**
certificate as Base-64 encoded X.509, and save it in this directory.

Everything in this directory except this README is gitignored — never commit
a certificate.
