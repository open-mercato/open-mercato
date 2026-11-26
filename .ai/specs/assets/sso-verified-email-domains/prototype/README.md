# Verify an SSO email domain

Open `index.html` locally and select Presentation to walk through one screen at a time. Use the Domains tab to add `northwind.example`, check the TXT record, retry after the simulated delay, then activate SSO. Reset simulation returns to the first screen. The toolbar also allows direct navigation for review.

The screens cover SSO-D1 and SSO-D2 in [the spec](../../../enterprise/2026-11-26-sso-verified-email-domains.md). The configuration starts inactive and has a working fictional identity provider. The first check returns record not found, and retry succeeds. All names, dates and record values are illustrative. The browser demo performs no real DNS, SSO configuration, or login requests. The separate staff login and operator recovery steps are acceptance criteria in the spec.

## Browser verification

Playwright Chromium passed the following local workflow checks.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Add and validate a domain | Invalid input showed an error and kept focus. Keyboard submission of a valid name showed pending proof and moved focus to the new screen. | [Domains](evidence/domains.png) · [Pending proof](evidence/pending-proof.png) |
| Handle DNS propagation delay | Activation stayed unavailable. The first check displayed an actionable retry state. Presentation Back returned to the proof instructions. | [Retry](evidence/retry.png) |
| Verify and activate | Keyboard retry led to a verified row. Activation showed the active state, and Reset cleared the form. | [Verified and active](evidence/verified-active.png) |
| Dark theme and narrow layout | Opened every screen in light and dark themes. At 412 px the proof screen fit without horizontal overflow and the check action stayed visible. | [Dark theme](evidence/verified-dark.png) · [Narrow viewport](evidence/pending-narrow.png) |
| Review comments | Created an input pin, reloaded persisted feedback, replied, re-anchored to the add button, deleted the thread, and verified the exported tombstone and namespace isolation. | Browser assertions |

Browser requests remained local and no uncaught script errors were observed. Existing application screenshots and production interaction were not exercised.

Comments stay in this browser until exported and shared. To review with coworkers, use Export for repository and share the exported operations separately.
