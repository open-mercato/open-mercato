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

The Windows launcher also detects this failure automatically: it captures the
root certificate from a live connection (probing `dl-cdn.alpinelinux.org`,
`registry-1.docker.io`, then `github.com`) and saves it here as
`corporate-proxy-root.crt`; if the capture is blocked (CONNECT-only proxies),
it falls back to exporting known TLS-inspection vendor roots (Zscaler,
Netskope, Palo Alto, …) from the Windows certificate store as
`interception-root-*.crt`, then retries the build.

To export the certificate manually on Windows: open `https://example.com` in
Edge/Chrome, inspect the certificate chain, export the **topmost (root)**
certificate as Base-64 encoded X.509, and save it in this directory. Or from
PowerShell (replace the vendor/company pattern):

```powershell
$roots = Get-ChildItem Cert:\LocalMachine\Root, Cert:\CurrentUser\Root |
  Where-Object { $_.Subject -match 'Zscaler|Netskope|MyCompany' }
foreach ($c in $roots) {
  $pem = "-----BEGIN CERTIFICATE-----`n" +
    ([Convert]::ToBase64String($c.Export('Cert')) -replace '(.{64})', "`$1`n").TrimEnd("`n") +
    "`n-----END CERTIFICATE-----`n"
  [IO.File]::WriteAllText("docker\certs\$($c.Thumbprint).crt", $pem)
}
```

If the proxy does not just intercept but **blocks** `dl-cdn.alpinelinux.org`
outright (block page instead of packages), certificates cannot help. Either ask
IT to allow the host (plus `registry-1.docker.io`, `registry.yarnpkg.com`,
`opencode.ai`, `github.com`), or set `ALPINE_MIRROR=<internal alpine mirror
base URL>` in the repo-root `.env` to build against your company's Artifactory/
Nexus alpine remote. `scripts\windows\check-windows.bat` audits all of these
hosts read-only before you start.

Everything in this directory except this README is gitignored — never commit
a certificate.
