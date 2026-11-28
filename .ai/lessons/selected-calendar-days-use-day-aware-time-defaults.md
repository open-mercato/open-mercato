---
title: "Selected calendar days need day-aware time defaults"
modules: ["customers"]
areas: ["backend-ui","testing"]
topics: ["calendar","date-time","testing"]
---

# Selected calendar days need day-aware time defaults

**Context**: PR #7489 forwarded the selected local day into activity creation. Review #5643631972 found that computing today's default and replacing only its date made tomorrow's task use 18:30 after 17:00 today, and moved tomorrow's 09:00 rollover into the past when today was selected after 23:30.

**Rule**: Choose the time policy from the selected local day before combining date and time. Future days use the activity type's day-independent default. Today keeps the strictly-forward default, including the documented next-day rollover when no slot remains. Preserve historical-date behavior when past activity logging is supported. Compare local calendar fields and use local date setters so UTC boundaries do not change the selection.

**Verification**: Cover a future task after today's end-of-day default, today after the last available slot, and an explicitly historical day. Assert both date and time, prove the cases fail against the original helper, and run west and east of UTC.

**Applies to**: `resolveActivityStartOnDay` and its company/person/deal activity-creation callers.
