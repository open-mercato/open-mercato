# Activity Contracts

Load when adding/configuring an activity type.

- Declare validated config/input/output and registration. Add editor fields and i18n only when users configure it.
- Choose sync for short deterministic work; queue async work and resume after durable result.
- Entity updates dispatch commands; email/provider/API work resolves DI services; cross-module work uses events/signals. Every command ID that a workflow may dispatch must be allowlisted through `registerWorkflowSafeCommands`, with the exact `requiredFeatures` needed to run it; registration on the command bus alone does not make a command workflow-safe.
- External URL activities enforce SSRF, manual redirects, timeout/size bounds, allowlisted non-secret interpolation, and redacted logs.
- Declare retryable versus terminal errors, retry/idempotency key, timeout, cancellation, output mapping, and compensation.
- Run `yarn generate` for discovered activity/UI/event changes.

Test validation, timeout, retry, duplicate execution, cancellation, output mapping, and worker restart.
