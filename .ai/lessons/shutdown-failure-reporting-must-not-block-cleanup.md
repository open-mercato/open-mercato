---
title: "Shutdown failure reporting must not block cleanup"
modules: ["telemetry"]
areas: ["architecture","testing"]
topics: ["error-reporting","runtime-startup","shutdown"]
---

# Shutdown failure reporting must not block cleanup

PR #5801's review found that shutdown awaited a pending initialization but handled its rejection only with a warning. The initialization promise still rejected correctly, yet the shutdown catch lost the standard error-reporting signal.

A lifecycle catch that continues cleanup must attempt the existing reporting facade with the original error and a static `module.reason` code. Guard that attempt separately so a broken reporter cannot interrupt cleanup or replace the original initialization rejection. Reporting must still be attempted before a provider becomes active.

Test a deferred startup rejection concurrent with shutdown against both the real facade without an active backend and a throwing facade. Assert one reporting attempt, the original rejection, successful shutdown, no remaining hooks or timers, and successful re-initialization followed by provider and sampler cleanup. These cases failed twice before the correction and passed after it.
