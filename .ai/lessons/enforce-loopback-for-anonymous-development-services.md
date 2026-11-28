---
title: "Enforce loopback for anonymous development services"
modules: ["create_app","starter"]
areas: ["architecture","testing"]
topics: ["docker-compose","network-security","local-development","registry"]
---

# Enforce loopback for anonymous development services

**Context**: The local Verdaccio registry accepted anonymous publishing and larger
package uploads, but its Compose port mapping omitted the host address. Calling
the service local did not prevent access through other host interfaces. The
security review of #8655 caught the missing network boundary.

**Rule**: Enforce the intended boundary at the published port. Default anonymous
development services to loopback, preserve port overrides without widening the
bind, and require an explicit host override for other interfaces. Shared network
access needs authentication and external request/concurrency controls. Keep the
canonical Compose file and its compatibility duplicate aligned.

**Verification**: Assert the actual rendered Compose ports for the default,
custom-port and explicit-host cases. Inspect a disposable container's published
host address and exercise the real package upload before claiming the boundary
and upload-capacity fixes work together.
