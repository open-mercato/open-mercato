# Provider-independent AI content safety

> **Status:** Implemented
> **Scope:** OSS, `@open-mercato/ai-assistant`

## TLDR

The hardened AI profile uses a deterministic, provider-independent content-safety service for typed-agent input, structured output, and untrusted tool results. Provider moderation remains an optional additional signal when available, but hardened execution no longer depends on a provider-specific moderation endpoint.

## Problem statement

The first hardened profile required the selected model provider to expose an input-moderation endpoint. It did not provide the same pre-delivery control for structured output or tool results. That prevented equivalent controls across providers and runtimes.

## Proposed solution

- Add an overridable `contentSafetyService` DI port with a deterministic default implementation.
- Detect instruction override, tool redirection, data-poisoning, model-inversion, and credential-exfiltration patterns without returning raw content in findings.
- Enforce the service on typed-agent input and structured object output in the hardened profile.
- Reject structured-output streaming in the hardened profile so partial output cannot bypass the pre-delivery scan.
- Enforce the same service on tool results before those results are returned to a model.
- Keep provider moderation available as defense in depth when supported, without making it a prerequisite for hardened execution.

## Architecture

The default scanner is local and has no network or model dependency. Downstream deployments may replace it through DI with a stricter implementation while preserving the same result contract. Enforcement fails closed in the hardened profile if a replacement throws or returns a blocking finding.

## Data models

No database change is required. Findings contain stable rule identifiers and severity only. Raw input, output, and tool-result content is not copied into the finding.

## API contracts

The public object-agent result gains additive `providerId` and `modelId` fields. Existing callers that ignore them remain compatible. Existing moderation error handling remains valid because provider-independent blocks use the same client-safe content-safety rejection class.

## Integration coverage

- Unit tests cover prompt injection, data poisoning, model inversion, clean business content, and blocked tool results.
- Object-agent tests cover provider/model metadata and the hardened input/output gate.

## Risks and impact review

| Failure scenario | Severity | Mitigation | Residual risk |
|---|---:|---|---|
| False positive in deterministic rule | Medium | Narrow imperative patterns and DI override seam | Operator may need a deployment-specific scanner |
| Scanner replacement unavailable | High | Hardened mode fails closed | AI run is unavailable until the scanner recovers |
| Provider moderation unavailable | Low | Local scanner remains mandatory | Provider-specific abuse categories may be less detailed |

## Migration and backward compatibility

The default `standard` profile keeps current behavior. New types and result fields are additive. No agent ID, tool ID, API route, event, or ACL feature is renamed.

## Changelog

- **2026-08-21:** Added the provider-independent content-safety contract and hardened enforcement for typed inputs, structured outputs, and tool results.
