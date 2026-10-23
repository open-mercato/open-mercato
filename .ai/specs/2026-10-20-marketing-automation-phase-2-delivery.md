# Marketing Automation — Phase 2: Delivery, Tracking and Deliverability

| Field | Value |
|-------|-------|
| **Status** | Specification (per-phase slice) |
| **Created** | 2026-10-20 |
| **Modules** | `marketing_automation` (`packages/marketing-automation`) |
| **Parent spec** | [`.ai/specs/2026-09-28-marketing-automation-module.md`](2026-09-28-marketing-automation-module.md) — Problem Statement, Data Models, API Contracts, Risks & Impact Review, Final Compliance Report and Changelog are shared across all phases and are not repeated here. |
| **Delivery plan** | [`.ai/specs/2026-10-02-marketing-automation-phased-delivery.md`](2026-10-02-marketing-automation-phased-delivery.md) — this file is P2–P5's "relevant sections out of" the module spec, per that spec's Migration & Backward Compatibility section |
| **PR** | [#6865](https://github.com/open-mercato/open-mercato/pull/6865) |

## Scope

The only routes in the module a stranger can reach: signed open/click tracking, the public
unsubscribe and NPS-survey endpoints, the customer-portal preference centre, and the
deliverability breaker that pauses a campaign whose sends are mostly being refused. Everything
here either protects or reports on a send that Phase 1's engine already makes; nothing here
decides whether to send.

## Architecture (extracted from the module spec)

### Delivery tracking

Opens and clicks, because "did this campaign work" is the question the module exists to answer and
every later feature — attribution, A/B winners, send-time learning, deliverability guards — reads from
here rather than computing its own version.

Two PUBLIC endpoints, which is the only public surface this module has. A recipient's mail client
fetches them with no session, so a signed token is the entire authorisation, and it carries the
tenant and organization the write belongs to: an unauthenticated request has no scope of its own, and
reading one from a query parameter would let anybody write rows into any tenant. The token identifies
the SEND — campaign, run, step — never the person.

What each endpoint refuses matters as much as what it records:

- The pixel answers a 1×1 GIF **whatever** the token turns out to be. A broken image in somebody's
  inbox is worse than a lost statistic, and an error status would tell a prober which tokens are real.
  It is served `no-store`, or a proxy would serve the second open from cache and it would never be
  recorded.
- The click destination travels INSIDE the signature, which is what keeps the redirect from being an
  open one. Signed by us is still not the same as safe — the author writes the links — so the scheme
  is checked again at redirect time and anything but http(s) answers 404. The redirect is 302, because
  a permanent one would be cached and the second click would never reach us.
- An open token cannot be replayed as a click, or the other way round: the purpose is part of the
  signed claims.
- Recording failures never change the response. Somebody clicked a link in an email and expects the
  page, not an apology about our statistics.

The signing key is derived from the configured secret with a purpose label, so a tracking token can
neither be forged from nor confused for anything else signed with the same secret. **There is no
fallback.** It used to fall back to the platform's data-encryption key material so tracking worked
without an operator reading a changelog, and that convenience was a forgery hole: `.env.example`
publishes the fallback key as a constant, so any install that kept it let anybody mint a token this
module would accept — a signed redirect to an arbitrary URL, writes into any scope, and forged
unsubscribe and survey tokens. An unset `OM_MARKETING_TRACKING_SECRET` disables tracking instead,
which is the safe way to be unconfigured. A second `OM_MARKETING_TRACKING_SECRET_PREVIOUS` is
accepted on verification only, so rotating the secret does not break a link already sitting in
somebody's mailbox. Session and JWT secrets are deliberately NOT candidates either, for the opposite
reason: a tracking token is handed to every recipient and lives in mail archives forever.

`marketing_message_send_events` stores no IP address and no user agent. The question this table exists
to answer never needs them, and a marketing module that quietly builds a device-and-location log of
every recipient is a liability nobody asked for. Counts are reported with unique-recipient figures
alongside raw totals, because a mail client re-fetching the pixel is not a second person reading it.

`send_email` rewrites links and embeds the pixel after interpolation — a link assembled from a
substituted value has to be tracked too — and leaves the body untouched whenever anything needed is
missing or the author opted out per step. Tracking is an enhancement to a send; a send must never fail
because it could not be tracked.

### Consent and one-click unsubscribe

The feature without which this module should not send anything in production.

**Two tables, deliberately.** `marketing_consents` holds one row per (customer, channel) with the current
answer; `marketing_consent_events` is append-only. They answer different questions with opposite access
patterns: the send gate needs one indexed row per message, a regulator needs the whole history and never in
a hurry. Keeping them together would mean either an aggregate on the hottest path in the module or a
history that can be overwritten — and a consent trail that can be overwritten is not a trail. A repeated
"unsubscribe" still appends an event, because when somebody acted is a fact.

**Silence means permitted**, and that is a decision rather than an oversight. The platform has no global
consent model for this module to inherit, so treating an absent record as refusal would have disabled every
campaign on every existing installation the moment this shipped — a behaviour change delivered as a bug
report. An installation that needs opt-in imports its consent, which is what the `import` source is for.
The constant is named `UNRECORDED_CONSENT_ALLOWS_SENDING` so the choice is visible where it is made.

**Consent is checked before every other send gate.** Quiet hours and the learned send hour say "not yet";
the frequency cap says "not this one"; consent says "not at all". So it DROPS the message rather than
deferring it — deferring something a customer asked not to receive only sends it later — and records the
suppression with reason `unsubscribed`, so the reason appears in reporting instead of the message simply
never existing.

**The unsubscribe link carries no identity.** It reuses the tracking token machinery — signed, public,
scoped, purpose-pinned, so an open token cannot be replayed as an unsubscribe — and names the RUN. The
endpoint resolves the customer from the run, so the URL that ends up in mail archives, forwarded messages
and corporate scanners identifies nobody. It answers HTML, because a mail client opens it in a browser and
somebody who has just asked to be left alone deserves a sentence rather than a JSON object; `no-store` and
`no-referrer`, and POST behaves identically for RFC 8058 one-click clients.

**It never claims success it did not achieve.** A signed link whose run no longer exists answers 404 with an
apology and a way to reach a human, and a failed write answers 500 — because somebody who believes they
unsubscribed and did not is the worst outcome this feature can produce, worse than an honest error.

`{{unsubscribeUrl}}` is offered to the author so they can place the link where their design wants it, and a
minimal footer is appended only when they did not. That footer is the one place this module modifies an
author's HTML, which the link rewriter otherwise refuses to do: a marketing email with no way out is not a
shippable default, and in much of the world it is not lawful.

### NPS survey

One question, answered in a click from the email.

**The step composes its own message**, which no other sending step does. An eleven-point scale is eleven
signed links, and asking an author to place eleven placeholders correctly — in every locale, in every
template — would make the feature technically available and practically unused. The author writes the
subject line and the question; the module renders the scale. It declares `channel: 'email'`, so consent,
quiet hours and the frequency cap apply to it exactly as to a campaign message: a survey IS a message, and a
customer who unsubscribed did not ask to be surveyed either.

**The score travels inside the signature.** A different score is a different link, not a different
parameter, so a recipient cannot change their own answer by editing the URL. The purpose is signed too, so an
open, click or unsubscribe token cannot be replayed as an answer.

**The prompt row is written before the message goes out**, and only once per (run, step). A row without a
message is an unanswered survey, which is visible; a message without a row is an answer with nowhere to go.
Asking twice would give one person two chances to answer one question, which quietly doubles their weight in
the result.

**A second answer overwrites the first.** Somebody who clicks 3 and then 8 has told us 8; keeping the first
click measures reflexes rather than opinion. The thank-you page offers an optional comment, which is usually
where the value actually is, and it posts back to the same signed URL so the token remains the only thing
identifying the answer.

One defect the tests caught immediately: `isValidNpsScore` accepted `null`, because `Number(null)` is 0 — a
valid NPS score, and the worst one. A missing answer would have been recorded as the strongest possible
complaint and would have looked like data.

*(`survey.nps` as a pushable audience field, read from each subject's latest answer, ships with Phase 4 —
it is an audience predicate, not a delivery concern.)*

### The customer-portal preference centre

A signed-in customer can subscribe or unsubscribe, cap themselves at N messages a week, or pause for
30/90/180 days — the middle ground consent does not have, and the reason a preference centre reduces
unsubscribes rather than collecting them: somebody who only wanted less mail has otherwise had one
button, and it says stop. The engine honours both new instructions: the customer's cap is evaluated as
a SECOND cap in its own weekly window rather than merged with the campaign's, because "three a week"
and a shop's "two a day" only have exact answers as written, and a preference may only ever make things
quieter; the pause DEFERS at the same step rather than dropping, because it is "not now" and not "no" —
and when a pause ends inside quiet hours the later instant wins, since both are promises. The subject
always comes from the portal session and never from the request: a preference centre that took an id
from its input would let anybody unsubscribe anybody. Consent written here is recorded with the
`customer` source on the same append-only trail as a one-click unsubscribe, which is what makes it
provably first-party. What reads it: the send gate, and the customer profile (Phase 4), which shows
what the person asked for beside the consent they gave — "subscribed, but at most one a week and paused
until March" is a customer nobody should be surprised by.

### The deliverability breaker

Pauses a campaign whose recent sends are mostly failing, by unpublishing it through the ordinary
command rather than setting a flag of its own — a campaign that looks enabled and sends nothing is the
worst of both — and notifies by FEATURE rather than by person, because whoever published it may have
left while the people who can fix it are those holding the manage grant. It is conservative in both
directions: a small sample never trips it and a campaign that is merely unlucky is left alone, since a
guardrail that pauses working campaigns gets switched off. It watches the failure rate of attempted
sends, and says so: bounce and complaint rates need provider feedback webhooks the platform has no
contract for, recorded as a core proposal rather than faked. A gap closed on the way: a failed send was
not recorded as a send at all, so a campaign being refused by the transport looked quiet rather than
broken — the results screen (Phase 3) understated it as "fewer sends" and the breaker would have had no
signal.

## Invariants worth re-stating at review

- **A link in an email must not change anything on GET.** SafeLinks, antivirus gateways, proxies and
  chat unfurlers fetch every URL in a message, so a mutating GET lets them unsubscribe people and
  invent NPS scores indistinguishably from the recipient. GET asks, POST acts — and RFC 8058 one-click
  still POSTs, so the one-click promise is kept where it is actually made.
- **Whether the author placed an unsubscribe link is decided before tracking rewrites it.** The
  rewriter turns their link into a tracking URL, so checking afterwards finds nothing and appends a
  second way out. And the unsubscribe URL is never tracked: an unsubscribe counted as a click inflates
  every rate and lets the variant that drove the most opt-outs win the A/B test.

## Out of scope for this phase

Consent and the contact preference themselves (the gate every send checks) ship with Phase 1 by
policy — a phase that can send without them is a phase that mails people who said no. Attribution,
the results screen and the learned send hour are Phase 3. The customer profile that surfaces consent
and preferences is Phase 4.
