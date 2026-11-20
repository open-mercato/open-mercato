---
title: "Shutdown failure reporting must not block cleanup"
modules: ["telemetry","webhooks"]
areas: ["architecture","testing"]
topics: ["error-reporting","runtime-startup","shutdown","subscribers"]
---

# Shutdown failure reporting must not block cleanup

PR #5801's review found that shutdown awaited a pending initialization but handled its rejection only with a warning. The initialization promise still rejected correctly, yet the shutdown catch lost the standard error-reporting signal.

A lifecycle catch that continues cleanup must attempt the existing reporting facade with the original error and a static `module.reason` code. Guard that attempt separately so a broken reporter cannot interrupt cleanup or replace the original initialization rejection. Reporting must still be attempted before a provider becomes active.

Test a deferred startup rejection concurrent with shutdown against both the real facade without an active backend and a throwing facade. Assert one reporting attempt, the original rejection, successful shutdown, no remaining hooks or timers, and successful re-initialization followed by provider and sampler cleanup. These cases failed twice before the correction and passed after it.

PR #9782 exposed the same control-flow hazard in a webhook notification subscriber: adding an unguarded reporting call to a catch changed a swallowed notification error into a rejected subscriber when telemetry threw. Wrap reporting separately and degrade its failure to a warning; the original error still gets one reporting attempt. A rejecting notification write combined with a throwing reporter must leave the handler resolved. The regression failed before the guard and passed afterward.

The same PR's optional-service lookup initially swallowed every DI exception before reaching that catch. Subscriber contexts expose the bound Awilix resolver, not a registration-check method. Resolve optional services with `{ allowUnregistered: true }` inside the guarded path: an absent registration can skip quietly, while a registered factory failure or a missing transitive dependency must still be logged and reported. Test both outcomes with real scoped Awilix containers, including a throwing reporter; a generic mock that throws for absence cannot establish this distinction.
