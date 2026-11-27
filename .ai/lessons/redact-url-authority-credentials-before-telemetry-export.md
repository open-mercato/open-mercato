---
title: "Redact URL authority credentials before telemetry export"
modules: ["telemetry"]
areas: ["architecture", "testing"]
topics: ["network-security", "telemetry", "testing"]
---

# Redact URL authority credentials before telemetry export

**Context:** The initial #9805 fix sanitized query values and token-shaped path segments but preserved URL authority user-info. Review of PR #9816 found that raw instrumentation spans could still export embedded usernames and passwords.

**Rule:** Review every credential-bearing URL component at the export boundary, including authority user-info, path, query and fragment. Remove the complete user-info prefix through the final `@` while preserving scheme, host and port. Cover absolute and scheme-relative URLs, encoded credentials, username-only authorities, multiple `@` characters and IPv6 hosts.

**Verification:** Exercise both URL attributes and URL-bearing span names through a raw span exporter and the browser processor path. Inspect the pinned instrumentation source for mirrored values: Next.js stores the original name in `next.span_name`, which must receive the same cleaning as the exported span name. Helper-only tests do not prove that instrumentation-created spans reach the redaction boundary. The authority and mirrored-name exporter regressions failed before their corrections and passed after them.

**Browser regression fixtures:** Replay only completed finite JSON API responses. A successful event-stream response is long-lived; replaying it repeatedly consumes the browser connection pool and can stall the test before its redaction assertions. The #9816 Polish CI trace showed six replayed `/api/events/stream` connections followed by an unstarted request. Filter the response content type rather than raising timeouts or reducing the required requests.
