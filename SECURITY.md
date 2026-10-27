# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Open Mercato, **please report it privately** — do not open a public GitHub issue.

**Email:** [security@openmercato.com](mailto:security@openmercato.com)

### What to Include

- Description of the vulnerability
- Steps to reproduce (or proof of concept)
- Affected components or modules
- Potential impact and severity estimate
- Suggested fix (if you have one)

### What to Expect

| Step | Timeline |
|------|----------|
| Acknowledgment of your report | Within 48 hours |
| Initial assessment and severity classification | Within 7 days |
| Fix timeline communicated to reporter | Within 14 days |
| Patch released | Depends on severity (critical: ASAP, high: 30 days, medium/low: next release) |

We will keep you informed throughout the process and credit you in the release notes (unless you prefer to remain anonymous).

### Scope

The following are in scope for security reports:

- Authentication and session management bypasses
- Authorization and RBAC privilege escalation
- Cross-tenant data leakage
- Injection vulnerabilities (SQL, XSS, command injection)
- Encryption implementation weaknesses
- Sensitive data exposure
- CSRF, SSRF, or request forgery attacks
- Dependency vulnerabilities with a viable exploit path

The following are **out of scope**:

- Reports from automated scanners without a demonstrated exploit
- Denial of service via brute-force volume (unless amplification is involved)
- Social engineering attacks
- Issues in third-party services or infrastructure not maintained by this project
- Vulnerabilities in environments running unsupported or heavily modified versions

### Safe Harbor

We consider security research conducted in good faith to be authorized. We will not pursue legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, data destruction, and service disruption
- Report vulnerabilities privately through the channel above
- Allow reasonable time for a fix before any public disclosure

### Supported Versions

Security fixes are applied to the latest release. We do not backport fixes to older versions unless the vulnerability is critical and the version is widely deployed.

## Supply Chain Security

Release packages are published to npm with provenance attestation (`--provenance`), cryptographically binding each published package to the specific GitHub Actions run that produced it. You can verify a package's provenance at `https://www.npmjs.com/package/@open-mercato/<package>`.

Production releases require explicit approval from a named reviewer in the `production` GitHub Environment before the publish job runs — a single compromised maintainer account cannot unilaterally push a release.

PR npm snapshot previews require the separate `npm-preview` environment and `NPM_PREVIEW_TOKEN`, with no stable-token fallback. Before checking out PR code, the workflow verifies deployment approval by someone other than the PR author or workflow initiators. The environment must prevent self-review and administrator bypass and allow dispatch only from trusted `main`; see [the preview security setup](CONTRIBUTING.md#npm-snapshot-preview-security-setup) for operator verification and retry requirements.

The preview token must grant publishing access only to the public package allowlist. Npm package permissions cannot restrict writes to canary versions or dist-tags, so approval of the exact PR SHA is still a supply-chain boundary. Actual registry grants and environment settings require operator verification; repository tests check the workflow boundary.

Sensitive paths (CI/CD workflows, release scripts, auth modules) are protected by CODEOWNERS and require `@open-mercato/maintainers` team sign-off on every PR.

## Security-Related Resources

- [Security Review & Hardening Challenge (Issue #546)](https://github.com/open-mercato/open-mercato/issues/546)
- Architecture overview: `AGENTS.md`
- Auth module: `packages/core/src/modules/auth/`
- Encryption: `packages/shared/src/lib/encryption/`
