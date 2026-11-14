# Security Pipeline Coverage

> **Status:** Implemented
> **Scope:** Repository CI/CD and deployment workflows

## TLDR

Every pull request now receives the normal CI gate plus CodeQL, dependency-change review, secret/configuration scanning, and an SBOM artifact. Production-style container builds are scanned for fixable high and critical vulnerabilities. Published QA images carry BuildKit provenance, an SBOM, and a GitHub artifact attestation. A controlled manual DAST workflow scans an operator-supplied HTTPS deployment.

## Overview

The repository already ran unit, integration, dependency-audit, and Docker build jobs, but coverage depended on the pull request target branch and did not include SAST, repository secret scanning, image vulnerability gates, SBOM generation, or DAST.

## Problem Statement

- Pull requests targeting feature integration branches could receive no full CI run.
- Source security analysis and leaked-secret detection were not explicit merge checks.
- A successful Docker build did not prove that the resulting image was free of fixable high or critical findings.
- Deployable images had no attached SBOM or verifiable build provenance.
- No repeatable DAST entry point existed for a deployed environment.

## Proposed Solution

- Run `ci.yml` for pull requests targeting any branch.
- Add a security workflow with CodeQL extended queries, dependency review, Trivy secret/configuration scanning, and Anchore Syft SBOM generation.
- Load the main application image during normal Docker CI and fail on fixable high or critical Trivy findings.
- Enable BuildKit provenance and SBOM generation for QA images, then attest the pushed digest through GitHub's OIDC-backed attestation service.
- Add a manual OWASP ZAP baseline workflow restricted to explicit HTTPS targets and without automatic issue creation.

## Architecture

```text
pull request
  -> normal CI for every target branch
  -> CodeQL SAST
  -> dependency review
  -> Trivy secret and configuration scan
  -> repository SBOM artifact
  -> container build and image vulnerability gate

trusted QA publish
  -> pushed image + BuildKit provenance + SBOM
  -> GitHub digest attestation

manual operator action
  -> validated HTTPS target
  -> OWASP ZAP baseline report
```

## Data Models and API Contracts

No application data model or HTTP API changes.

`dast.yml` accepts one required `target_url`. It rejects non-HTTPS URLs and loopback host names before starting ZAP. The workflow stores a report artifact and does not create or edit repository issues.

## Integration Coverage

- Workflow syntax and action inputs are checked locally.
- Existing CI exercises application tests and all Dockerfiles for every pull request target.
- The security workflow runs on pull requests, pushes to `main` or `develop`, a weekly schedule, and manual dispatch.
- DAST remains manual because it requires an authorized live deployment target.

## Risks & Impact Review

| Failure scenario | Severity | Mitigation | Residual risk |
|---|---|---|---|
| Security action is compromised | High | Versioned actions and weekly Dependabot updates | Tags are mutable until repository-wide SHA pinning is completed |
| Scanner database is unavailable | High | Scanner fails the job instead of reporting success | External service availability can delay a merge |
| Existing vulnerability blocks all work | Medium | Dependency audit allowlist remains separately governed; image gate ignores only unfixed findings | A newly fixable base-image issue can block CI |
| DAST scans an unauthorized host | High | Manual dispatch, required HTTPS, loopback rejection, operator responsibility | Maintainers must still confirm authorization and scope |
| Attestation is missing on an untrusted PR | Low | Attest only pushed images from the trusted QA deployment workflow | Local and PR-only images are intentionally not attested |

## Migration & Backward Compatibility

Application contracts are unchanged. CI begins running on more pull requests, and new security findings can block merges or QA deployment. Repository administrators should mark the new checks as required after the first successful baseline run.

## Changelog

- **2026-08-24:** Expanded pull request CI coverage, added SAST, dependency review, secret/configuration scanning, SBOM generation, image scanning, image attestations and a manual DAST workflow.
