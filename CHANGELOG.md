# 0.10.1 (2026-11-25)

<!-- Release notes generated using configuration in .github/release.yml at c8272a5ac8ad23b35b702eaa9cf9313eb9d6304a -->

## What's Changed
### 🔒 Security
* fix(sso): keep normalized return redirects on the application origin (#9019) by @open-mercato-assistant[bot] in https://github.com/open-mercato/open-mercato/pull/10394
* fix(core): decrypt rehydrated user and customer activity lists (#5447) by @open-mercato-assistant[bot] in https://github.com/open-mercato/open-mercato/pull/10403
* security(audit_logs): deny action-log list and export on an empty organization scope by @open-mercato-assistant[bot] in https://github.com/open-mercato/open-mercato/pull/10445
* fix(security): deny login when the MFA challenge cannot be created by @open-mercato-assistant[bot] in https://github.com/open-mercato/open-mercato/pull/10498
* fix(encryption): keep lookups working during pepper rotation (#10177) by @open-mercato-assistant[bot] in https://github.com/open-mercato/open-mercato/pull/10228
* fix(security): harden extension header parsing and analytics SQL identifiers (#10331, #10332) by @open-mercato-assistant[bot] in https://github.com/open-mercato/open-mercato/pull/10455
* fix(deps): patch Hono middleware bypass vulnerabilities by @open-mercato-assistant[bot] in https://github.com/open-mercato/open-mercato/pull/10566
* security(record_locks): deny lock routes on an empty organization scope by @open-mercato-assistant[bot] in https://github.com/open-mercato/open-mercato/pull/10640
* fix(entities): backport relation options authorization (#9106) by @pkarw in https://github.com/open-mercato/open-mercato/pull/10545
### 🐛 Fixes
* fix(cli): let module add read unset Yarn registry settings (#10569) by @open-mercato-assistant[bot] in https://github.com/open-mercato/open-mercato/pull/10575


**Full Changelog**: https://github.com/open-mercato/open-mercato/compare/v0.10.0...v0.10.1

# 0.10.0 (2026-11-23)

## Highlights

Open Mercato 0.10.0 is led by **commerce you can actually sell through**: the ecommerce storefront read side (store hostname resolution, a public catalog API with buyer-scoped prices, tax mode and assortment) is joined by the Release 4 write side — a `cart` module, a `promotions` module and buyer-scoped visibility enforced inside the cart. Payments grow with them: new **Tpay** and **Autopay** hosted PLN gateways, generic signed-webhook support in `payment_gateways`, checkout links that refuse to save when they cannot collect the payer fields a provider requires, and an opt-in `external` amounts mode for mirrored sales orders. Underneath, **money and exchange rates move to arbitrary-precision `numeric` columns** with exact decimal arithmetic, and WMS gains Phase 2 inbound receiving — ASNs, QC, putaway tasks and scan endpoints.

**Starting a new app gets a front door.** `create-mercato-app` now opens the Open Mercato Modules catalog by default, so a new project can pick verified modules, start from an app `--template`, and `mercato module search` / `module info` / installing from npm or GitHub locators let developers — and their coding agents, through the new `om-find-module` skill and catalog MCP server — find a module before building one. `yarn setup` preflights Docker, starts and health-checks the infrastructure, reuses configured services by default with `--ephemeral` and `--random-ports` options for isolated runs, and `om-setup-ci` generates security-hardened GitHub Actions CI for a standalone app in one command.

**This is the largest security pass Open Mercato has shipped.** Well over a hundred fixes tighten tenant and organization isolation across catalog, sales, CRM, messages, scheduler, search and AI tools; decryption is now bound to the tenant the caller asserted; production deployments get a nonce-based Content Security Policy and must provide a tenant encryption key; passkey enrollment requires a verified WebAuthn response; MCP servers bind to loopback by default; AI session keys are bounded by their owner's ACL; outbound requests, CSV exports, uploads and webhook bodies are bounded or neutralized; and a series of dependency bumps clears published advisories.

CRM and communications round it out with **helpdesk support tickets** filed from the customer portal, a generic **SMTP outbound channel**, attachments on send-as-user mail, an OAuth2 grant lifecycle core for integrations, a redesigned deals KPI strip, a single-column create-deal page, a VAT / tax ID field on companies and a richer CRM calendar — alongside the consolidated agent platform roadmap (MCP exposure filtering, mutation approval mode, access-log auditing), a provider-neutral decision model port, opt-in cache compression and new saturation metrics. Several of these changes need downstream attention — the production encryption key and CSP among them — so read [`UPGRADE_NOTES.md`](UPGRADE_NOTES.md) before deploying. Enjoy!

## ✨ Features
- ✨ Add WMS Phase 2 inbound receiving with ASN list/detail pages, QC and receive flows, a putaway task lifecycle with queue UI, scan endpoints for receive/putaway/location/lot resolve, and sales reservation re-evaluation after stock increases. (#5621) *(@mkadziolka)*
- ✨ Share one linked-people section between the Company and Deal People tabs, giving deals person cards with Unlink, a Filters toggle, sorting and an Add person dialog instead of the plain link rows. (#5814) *(@WojciechSoczynskiTHEY)*
- ✨ Add the `@open-mercato/gateway-autopay` provider for Autopay Online v1.1 hosted PLN payment sessions, covering bank transfers, BLIK and cards, with each tenant registering its own Autopay service. (#6047) *(@autopaylab)*
- ✨ Coalesce repeated queue enqueues into a single run per burst, so rapid duplicate jobs for the same key no longer each execute separately (supersedes #5998). (#6087) *(@jtomaszewski, via @pkarw)*
- ✨ Let Customers calendar event types be added, configured, replaced, patched or disabled through module-owned definitions, with an Example Visit showing optional staff/resource availability feedback, event time zones and overlap checks across all event types. (#6688) *(@pkarw)*
- ✨ Add a project mode to the time entry dialog, selectable through a new `defaults.entryMode` time-tracking setting, and export the component props schemas, so teams tracking time per project can create entries without choosing a task (#6989). (#7001) *(@Marynat)*
- ✨ Add the OAuth2 grant lifecycle core for integrations, with cross-process single-run refresh, a trustworthy grant status, an invalidated-grant banner, and disconnect that erases the grant and revokes it at the provider. (#7057) *(@mikolajbogusz-they)*
- ✨ Bring the `@open-mercato/carrier-inpost` InPost carrier package back into the monorepo as `packages/carrier-inpost`, as the last module left in the deprecated `official-modules` repo. (#7081) *(@wojciechszyjka)*
- ✨ Add the ecommerce storefront read side: store hostname resolution to a store, tenant, sales channel and buyer context, a public catalog API with buyer-scoped prices, tax mode and assortment, and a tabbed admin store editor. (#7142) *(@adeptofvoltron)*
- ✨ Add the `@open-mercato/gateway-tpay` provider for Polish merchants, creating PLN transactions on Tpay's hosted payment page and reading results back through the payment-gateway status flow, inactive until a tenant enters credentials. (#7153) *(@mtytula)*
- ✨ Add opt-in webhook transport, locator and response extensions to `payment_gateways`, so providers sending signed form-encoded notifications and expecting a plain-text acknowledgement can use the generic webhook route without changing existing registrations. (#7154) *(@mtytula)*
- ✨ Settle Tpay payments from Tpay's signed server notifications so they no longer depend on the payer returning to the shop, and reconcile missed notifications with a scheduled status check. (#7156) *(@mtytula)*
- ✨ Validate checkout links and templates against payer fields required by the payment provider, warning in the editor and refusing to save links that do not collect them, instead of failing every payment with an unfixable 422 (#7170). (#7172) *(@mtytula)*
- ✨ Store money and exchange rates as arbitrary-precision `numeric` columns with exact decimal arithmetic and add free-form exchange rate `metadata`, supporting small FX rates and high-precision currencies, with public fields gaining optional `<field>Exact` strings. (#7324) *(@patrykbojczuk)*
- ✨ Add helpdesk support tickets, letting customer portal users file tickets that become staff time-tracking tasks routed by category, handled by project assigners in the backoffice and answered back in the portal. (#7421) *(@WojciechSoczynskiTHEY)*
- ✨ Add opt-in zstd/gzip compression for `@open-mercato/cache` values in the Redis and SQLite strategies, controlled by `CACHE_COMPRESSION` and `CACHE_COMPRESSION_MIN_BYTES`, with reads auto-detecting the stored format. (#7519) *(@mtytula)*
- ✨ Add a provider-neutral decision model port with OpenRouter and fixture adapters, so modules can resolve `decisionModelService` from DI and get typed answers with calibrated per-option probabilities instead of hand-rolled LLM calls. (#7553) *(@mateusz-lewandowski)*
- ✨ Add eComm release 4, the write side, with a `cart` module, a `promotions` module and buyer-scoped catalog visibility enforced inside the cart so hidden products cannot be bought through the cart API. (#7592) *(@adeptofvoltron)*
- ✨ Send attachments through send-as-user, IMAP/SMTP and Gmail, so a user sending from their own connected mailbox can attach files instead of having them dropped or the message failing (#7098). (#7676) *(@mikolajbogusz-they)*
- ✨ Add an opt-in "Use default stage probabilities" setting per pipeline, so a deal entering a stage gets that stage's default win probability instead of keeping a hand-typed value. (#7792) *(@WojciechSoczynskiTHEY)*
- ✨ Add the `om-setup-ci` skill for `create-mercato-app` apps, generating security-hardened GitHub Actions CI in one command with dependency audit, Gitleaks, Semgrep, zizmor, Trivy and a single aggregate `CI` check that fails pull requests only on newly introduced problems. (#7864) *(@pat-lewczuk)*
- ✨ Make `yarn setup` in `create-mercato-app` projects preflight Docker and start and health-check the infrastructure, and add `infra:up`/`infra:down` scripts plus a `--no-infra` opt-out (#7791). (#7865) *(@wojciechszyjka)*
- ✨ Add a single "Start building with Cezar" control to the dev and setup splashes that opens a terminal running `npx cezar-run` in the current project, with dev-only preview framing (#7790). (#7866) *(@wojciechszyjka)*
- ✨ Write sales order lines in one aggregate batch through a new bulk upsert command and API route, preserving custom-field persistence and parent-order optimistic locking (supersedes #6184). (#8050) *(@maxidragon, via @pkarw)*
- ✨ Add `mercato module search` and `module info` to the CLI, backed by the Open Mercato Modules catalog, so developers and agents can find built-in, published and verified modules before building. (#8117) *(@wojciechszyjka)*
- ✨ Add `--modules` and `--module-picker` options to `create-mercato-app` to plan modules from the Open Mercato Modules catalog, showing verification status and license while scaffolding. (#8118) *(@wojciechszyjka)*
- ✨ Add the `om-find-module` skill to the `create-mercato-app` agentic setup so coding agents check the module catalog before building features that already exist. (#8119) *(@wojciechszyjka)*
- ✨ Add a Created column to the People and Companies lists with sorting and whole-day creation-date filtering that respects the user's timezone (supersedes #6448). (#8201) *(@nowekontotestowe2026-web, via @pkarw)*
- ✨ Let staff cancel a pending portal invitation from the CRM person's Portal Account card, invalidating its link, retaining invitation history and tolerating repeated requests (#7275). (#8212) *(@haxiorz)*
- ✨ Add an opt-in `external` amounts mode for mirrored sales orders, letting callers persist their own line and header net, tax and gross figures from an external book of record, stored per order in `sales_orders.totals_mode` (supersedes #6092). (#8216) *(@maxidragon, via @pkarw)*
- ✨ Add the consolidated agent platform roadmap (waves 1-6), including MCP exposure filtering with allow/deny lists, access-log auditing, `OM_MCP_MUTATION_MODE` with a Pending AI actions approval page, a unified model-call contract, eval report export and document structure extraction. (#8251) *(@pat-lewczuk)*
- ✨ Add a generic SMTP outbound email channel (`channel-smtp`) so tenants can send messages through any SMTP server (supersedes #6185). (#8252) *(@jtomaszewski, via @pkarw)*
- ✨ Add a reusable live experiment dashboard (`yarn experiments:dashboard --experiment <directory>`) that shows progress, token throughput, searchable outcomes and retained evidence for multiple local experiment folders. (#8259) *(@pkarw)*
- ✨ Add installing modules from canonical npm and GitHub locators in the CLI, inspecting packages before dependency changes and rejecting duplicate enabled module IDs and conflicting providers before the generator writes. (#8309) *(@pkarw)*
- ✨ Collapse the floating demo feedback button to a 44px icon-only circle that expands into the gradient pill with its rotating caption on hover or keyboard focus (#8313). (#8314) *(@Hejnas)*
- ✨ Add PostgreSQL pool saturation, acquisition wait, event-loop and memory pressure metrics to the opt-in telemetry backend, and return a retryable `503 cart_busy` with `Retry-After: 1` under cart lock contention (supersedes #5801). (#8434) *(@haxiorz, via @pkarw)*
- ✨ Add `OM_ATTACHMENT_STORAGE_POLICY=strict` to validate attachment storage configuration (partitions, drivers, scope, provider checks) before storage is constructed or reused across web, worker and CLI (#6690) (supersedes #6820). (#8446) *(@haxiorz, via @pkarw)*
- ✨ Count adapter tasks in person and company profile badges in compatibility mode, including completed tasks and unbridged legacy links, independent of the bounded preview (#6068) (supersedes #6887). (#8482) *(@haxiorz, via @pkarw)*
- ✨ Improve the CRM calendar grid with a richer event peek card, click-to-create on an empty half-hour slot, hover slot highlighting and type icons instead of unexplained color dots (#9620). (#8531) *(@zielivia)*
- ✨ Redesign the deals KPI strip as one card of four metric tabs over a trend chart, removing repeated scope lines and "Unassigned" labels. (#8537) *(@zielivia)*
- ✨ Add a VAT / tax ID field to the company profile via a nullable `customer_companies.tax_id` column covered by the encryption map with a backfill. (#8538) *(@zielivia)*
- ✨ Add a CC field of up to ten validated addresses to the Send quote dialog, sent with the e-mail and stored as `metadata.recipients.cc` to pre-fill the next send (#8460). (#8549) *(@zielivia)*
- ✨ Make `yarn setup` reuse configured services by default and add `--ephemeral` (disposable Testcontainers services), `--random-ports` (checkout-specific Compose stack) and `--infra` options for isolated service modes. (#8613) *(@pkarw)*
- ✨ Rebuild the create deal page as a single-column form with a pinned action bar and section cards for pipeline and stage, details, and associations (#5109). (#8650) *(@zielivia)*
- ✨ Offer the Open Mercato Modules picker by default in `create-mercato-app` when no preset or modules are given, listing modules verified for the app line with origin, license and level. (#8718) *(@wojciechszyjka)*
- ✨ Add `create-mercato-app --template <slug | owner/repo>[#ref]` to create an app from an app template in the Open Mercato Modules catalog or from any GitHub repository. (#8732) *(@wojciechszyjka)*
- ✨ Declare the public read-only `om-modules` catalog MCP server in the standalone `mcp.json.example` files, so `om-find-module` has a configured source in a new app (#8125). (#8733) *(@wojciechszyjka)*
- ✨ Add foldable logs, an animated working row and saved run files to `yarn setup` and infrastructure commands, matching the dev runtime. (#8838) *(@pkarw)*
- ✨ Identify audit log rows with a bounded historical record name, ID fallback and one-line change summary, and keep undo/redo actions reachable while the table scrolls (#8200). (#8845) *(@haxiorz)*
- ✨ Pass channel identity to `importHistory` in `communication_channels`, so an email adapter can tell which mailbox a history import targets when several shared mailboxes resolve credentials by the same scope. (#8960) *(@shimmy-aga)*
- ✨ Add an opt-in `requireShared` flag to `RateLimitConfig` that disables the in-memory fallback, so `consume()` returns a `degraded` result when the shared Redis store is unavailable and callers can fail closed. (#9280) *(@ddiarassouba94140-blip)*
- ✨ Let native integration runs initialized with custom admin and employee actors use those credentials in the shared browser and API login helpers instead of always using seeded ones (#8475). (#9561) *(@pkarw)*

## 🔒 Security
- 🔒 Canonicalize live ACL grants and targets with tenant-bound super-admin grants, deterministic remediation and partial unique indexes for live user/role ACL rows, and decryption-aware target reads, so revoked or duplicate ACL rows no longer affect RBAC, API keys or recipient resolution (supersedes #5764). (#5770) *(@Geeknauts-company, via @pkarw)*
- 🔒 Bind decryption to the tenant the caller asserted: the query engines and `find*WithDecryption` now refuse to decrypt a row whose `tenant_id` contradicts the read's `tenantId`, and return it as ciphertext instead of another tenant's plaintext. A field that used to come back as plaintext and now comes back as ciphertext means a pre-existing scoping bug is returning rows the caller was never entitled to — not a decryption regression. Each refused read logs one aggregated warning, `DECRYPT_REFUSAL_LOG_MESSAGE`: `Skipped decryption for rows whose tenant does not match the query tenant`; alert on that string. Queries that need no plaintext can now decline it with `decryptEncryptedFields: false` on `QueryOptions` or a CRUD `list` config. (#5430) (#5822) *(@adeptofvoltron)*
- 🔒 Bound attachment OCR by capping PDF pages (`OM_ATTACHMENT_OCR_MAX_PAGES`), timing out each call, limiting concurrency and queue depth, and rate-limiting `POST /api/attachments` uploads, preventing cost amplification by authenticated users (#2676). (#6264) *(@Sawarz)*
- 🔒 Block workflow mapping targets from traversing inherited properties, preventing an authorized workflow author from polluting `Object.prototype` and crashing the shared Node.js process across tenants. (#6303) *(@pkarw)*
- 🔒 Bind the production and dev MCP HTTP servers to loopback by default instead of all network interfaces, and compare the dev key in constant time (#2659). (#6712) *(@Sawarz)*
- 🔒 Harden encryption key rotation and database decryption to fail closed on invalid metadata, keys or ciphertext, exit non-zero on aborts, add `TENANT_DATA_ENCRYPTION_OLD_KEY` instead of echoing secrets via `--old-key`, and stop re-encrypting undecryptable data as plaintext. (#6767) *(@pkarw)*
- 🔒 Require a verified WebAuthn registration response for every new passkey enrollment and remove the shortcut that accepted an arbitrary caller-supplied public key, with legacy requests answered by a localized HTTP 400 (#6800, #5296). (#6824) *(@haxiorz)*
- 🔒 Enforce registrable owner access policies on attachments, adopting Documents permissions across bytes, derived images, metadata, reassignment, deletion and public links, so unshared colleagues get 404 and hidden rows no longer leak into counts (#6726). (#6829) *(@haxiorz)*
- 🔒 Enforce personal-mailbox ownership when reassigning a communication channel thread, so holders of `communication_channels.assign` can no longer reassign threads on another user's personal mailbox (#3832). (#6846) *(@adeptofvoltron)*
- 🔒 Bump `@fastify/busboy` from 3.2.0 to 3.2.2, picking up fixes for multiple published security advisories. (#7024)
- 🔒 Bump `proxy-addr` from 2.0.7 to 2.0.8, fixing CVE-2026-90711. (#7027)
- 🔒 Bump `compression` from 1.8.1 to 1.8.2, fixing CVE-2026-87776. (#7029)
- 🔒 Bump `source-map-js` from 1.2.1 to 1.2.2, fixing a denial of service from malicious indexed source maps (CVE-2026-93749). (#7030)
- 🔒 Require read access to the parent message when a reply names a `parentMessageId`, so callers can no longer join a conversation thread they cannot read. (#7151) *(@AHKSammich)*
- 🔒 Revoke the refresh session on `POST /api/auth/logout` even after the access token has expired, so logging out in a lapsed tab no longer leaves the session silently refreshable (#7225). (#7299) *(@AHKSammich)*
- 🔒 Enforce the actor's organization scope when creating staff users, so a user restricted to one organization can no longer create confirmed users in a sibling organization of the same tenant (#7238). (#7300) *(@AHKSammich)*
- 🔒 Count concurrent failed customer portal logins atomically, so parallel wrong-password requests can no longer keep the counter under the five-failure lockout threshold (#7232). (#7301) *(@AHKSammich)*
- 🔒 Limit the `CALL_OPEN_MERCATO` business rule action to API key roles the rule author may grant, so a rule can no longer run with roles above the author's permissions (#7236, #7362). (#7320) *(@AHKSammich)*
- 🔒 Cap Stripe webhook bodies before unauthenticated buffering on `POST /api/payment_gateways/webhook/stripe`, so oversized requests are rejected before being read into memory (#7222). (#7321) *(@AHKSammich)*
- 🔒 Enforce the upload limit while streaming customer-portal warranty attachments, so requests without a `Content-Length` header (chunked) can no longer bypass the size limit (#7227). (#7322) *(@AHKSammich)*
- 🔒 Scope AI pending actions to their creator and recheck the tool's own required features on confirm, so other users can no longer read, cancel or confirm someone's pending action or write beyond their permissions (#3806). (#7329) *(@AHKSammich)*
- 🔒 Close customer portal SSE streams when the customer session is revoked or expires, instead of authenticating only once when the stream opens (#7217). (#7331) *(@AHKSammich)*
- 🔒 Authenticate Discord AI reply proposals, so only system-filed proposals can cause an approving operator to send a public reply and a `messages.compose` user can no longer forge one. (#7342) *(@haxiorz)*
- 🔒 Route shared-thread replies through the mailbox the replying teammate selected, so replies are no longer sent from the original sender's mailbox or attributed to them (#7311). (#7343) *(@haxiorz)*
- 🔒 Surface localized Discord approval refusals instead of generic errors when an approval is refused (#7310). (#7356) *(@haxiorz)*
- 🔒 Reject Forms submission access tokens after their invitation is revoked, so revoked participants can no longer keep using already-issued tokens (#7230). (#7358) *(@AHKSammich)*
- 🔒 Limit portal form submissions to the caller's own subject, so a portal customer can no longer start a submission for any subject in their organization (#7224). (#7426) *(@AHKSammich)*
- 🔒 Reject notification hrefs that resolve to external origins, such as `/\evil.example/path`, which previously passed the safe-href check (#7240). (#7430) *(@AHKSammich)*
- 🔒 Restrict the participant submission PDF to the answers their role can read, instead of rendering the full decrypted revision (#7229). (#7431) *(@AHKSammich)*
- 🔒 Reject cross-site browser requests on the staff and portal sign-in routes, so a page on another site can no longer sign a visitor into an attacker's account through login CSRF on `POST /api/auth/login` and session refresh (#7239). (#7447) *(@AHKSammich)*
- 🔒 Log a startup warning, with the closest registered id as a suggestion, when an encryption map names an entity that is not registered, instead of silently storing the declared fields as plaintext (#7453). (#7458) *(@mstopinski)*
- 🔒 Make `entities seed-encryption --tenant` also append missing field rules to the tenant's organization encryption maps, so newly declared fields no longer stay plaintext in those organizations (#7460). (#7463) *(@mstopinski)*
- 🔒 Route all browser egress of the `@open-mercato/web-research-browser` sidecar through a pinned public-only proxy, closing gaps where subresources, redirects, WebSockets and DNS rebinding could reach non-public networks (#7218). (#7474) *(@AHKSammich)*
- 🔒 Neutralize spreadsheet formulas in the WMS SKU, lot and location detail-page CSV exports, so user-controlled codes, names and SKUs can no longer reach the spreadsheet as live formulas (#7219). (#7481) *(@AHKSammich)*
- 🔒 Escape and neutralize CSV header cells in `serializeCsv`, so headers containing commas, quotes, newlines or leading `=`, `+`, `-`, `@` can no longer corrupt exports or inject spreadsheet formulas (#7482). (#7510) *(@adeptofvoltron)*
- 🔒 Bump `http-cache-semantics` from 4.2.0 to 4.3.0. (#7539)
- 🔒 Send workflow `CALL_API` keys only to the exact `APP_URL` origin and its `/api/` path on the first request and every redirect hop, so a plaintext `http://` endpoint on the same host no longer receives the key (#7235). (#7559) *(@AHKSammich)*
- 🔒 Bound Akeneo response bodies and store imported media through the attachment upload path, so size limits, tenant quota, content checks and the storage driver apply instead of reading unbounded files into memory (#7233). (#7566) *(@AHKSammich)*
- 🔒 Hide credential custom header values from webhook viewers lacking `webhooks.secrets`, so `webhooks.view` alone can no longer read reusable destination credentials such as `Authorization` or `x-api-key` headers (#7237). (#7574) *(@AHKSammich)*
- 🔒 Match scheme and port, not just hostname, in the `AI_RUNTIME_BASEURL_ALLOWLIST` check, so the server's provider API key can no longer be forwarded over cleartext or to an unexpected port (#7228). (#7576) *(@AHKSammich)*
- 🔒 Load catalog write-command targets inside the caller's tenant and organizations, so product, variant, price and offer updates and deletes no longer look records up by bare id (#3825). (#7577) *(@AHKSammich)*
- 🔒 Answer `404` for reactions on messages outside the caller's scope, including other users' personal and deleted mailboxes, so the reaction routes no longer reveal whether a message id exists (#3833). (#7589) *(@AHKSammich)*
- 🔒 Cap the unpaginated record attachment list at 100 in `GET /api/attachments`, so one request can no longer load, decrypt and serialize every attachment of a record (#3816). (#7590) *(@AHKSammich)*
- 🔒 Isolate unauthenticated InboxOps custom webhook admission quotas, so forged signatures can no longer exhaust the quota and make legitimate mail for another tenant receive `429` (#7600). (#7611) *(@haxiorz)*
- 🔒 Notify MFA administrators in the notification center when emergency bypass is observed in their organization, scoped by tenant and organization, while preserving emergency access and audit warnings (#5523). (#7619) *(@haxiorz)*
- 🔒 Seed encryption maps for organizations created after init, so with `TENANT_DATA_ENCRYPTION` enabled their data is no longer silently written as plaintext (#7591). (#7629) *(@adeptofvoltron)*
- 🔒 Unify database identifier quoting in `mercato` database creation on the shared `quotePostgresIdentifier` helper, removing ad-hoc quote stripping, and pin its contract with direct tests (#4121). (#7653) *(@haxiorz)*
- 🔒 Run only the commands a notification type declares, so notification actions can no longer dispatch caller-supplied `commandId`s that bypass the authorization of the route normally running them (#7215). (#7669) *(@AHKSammich)*
- 🔒 Reject creating a currency under another tenant's or a nonexistent organization, closing a gap where a tenant-wide admin could submit an arbitrary `organizationId` to `POST /api/currencies/currencies` (#7668). (#7682) *(@adeptofvoltron)*
- 🔒 AND-combine `mergeIdFilter`'s unrecognised id filter with server-supplied ids, so a client `filter[...][field]=id` can no longer disable interceptor narrowing and return excluded rows (#7641). (#7683) *(@adeptofvoltron)*
- 🔒 Scope `commandActorScope` like `commandScopeWhere` in the catalog module, so scope-only callers and multi-organization actors no longer lose the tenant or organization filter (#7612). (#7685) *(@adeptofvoltron)*
- 🔒 Run the mutation guard before the reaction lookup in `DELETE /api/communication_channels/messages/:messageId/reactions/:reactionId`, so unknown and foreign reaction ids can no longer be told apart (#7670). (#7740) *(@adeptofvoltron)*
- 🔒 Seed dashboard role widget defaults onto the tenant's own roles, instead of looking roles up by name alone and possibly matching another tenant's role (#7803). (#7804) *(@AHKSammich)*
- 🔒 Stop `GET /api/scheduler/jobs?format=json&exportScope=full` from returning scheduler jobs of every tenant to any caller with `scheduler.jobs.view`, by keeping the route's tenant/organization filter on full exports (#7806). (#7875) *(@adeptofvoltron)*
- 🔒 Enforce the caller's allowed organization scope in the AI search tools (`search_query`, `search_get`, `search_aggregate`, `search.hybrid_search`, `search.get_record_context`), so restricted users without a current organization no longer see results across the whole tenant (#7808). (#7876) *(@adeptofvoltron)*
- 🔒 Scope sales tag update and delete commands to the stored tag's tenant and organization instead of request-supplied values, so a caller can no longer mutate a tag belonging to another tenant or organization (#7807). (#7881) *(@adeptofvoltron)*
- 🔒 Bump `nodemailer` from 10.0.10 to 10.1.4, picking up the `addressparser` hardening fixes (group nesting bound, quoted-string and comment parsing). (#7923) *(@pkarw)*
- 🔒 Apply the viewer-specific private email visibility policy to CRM scheduling-conflict results before limiting candidates or decrypting titles, so private emails no longer leak through conflict checks (#7856). (#7935) *(@haxiorz)*
- 🔒 Scope reverse CRM auto-linking to the portal user's organization, so creating a CRM person in one organization can no longer attach an unlinked portal account from another (#7852). (#7947) *(@haxiorz)*
- 🔒 Reject deal and pipeline-stage references outside the caller's tenant and organization, while preserving valid stage-only pipeline inference (#7851). (#7950) *(@haxiorz)*
- 🔒 Stop watch and mention notifications from revealing a private document's current title after `documents.view` is revoked (#7837). (#7986) *(@haxiorz)*
- 🔒 Require independent approval before the npm snapshot preview job runs PR install and release code with the publishing credential (#7835). (#7987) *(@haxiorz)*
- 🔒 Redact money amounts from staff report PDF exports and contributed serializers for viewers without `staff.timesheets.rates.view` (#7834). (#7988) *(@haxiorz)*
- 🔒 Keep app ports private behind the bundled Traefik overlay, so direct HTTP traffic can no longer bypass its TLS and custom-domain ForwardAuth (#7833). (#7993) *(@haxiorz)*
- 🔒 Reject local-use IPv6 translation addresses and 6to4 destinations embedding blocked IPv4 in the web-research HTTP client and browser proxy (#7836). (#7998) *(@haxiorz)*
- 🔒 Bump `postcss-selector-parser` from 6.1.2 to 6.1.5. (#8009)
- 🔒 Enforce the full registered mutation-guard registry, including `data/guards.ts` and feature-gated guards, on custom write routes in messages, integrations, payment gateways, sales quotes, cache administration and push notifications (#7454). (#8019) *(@pkarw)*
- 🔒 Prevent a same-organization manager from exposing another user's private CRM email by changing its author, converting it to a note, or using other interaction mutation paths (#7850) (supersedes #7952). (#8027) *(@haxiorz, via @pkarw)*
- 🔒 Revoke removed roles from AI session keys, so generated keys stop carrying grants of roles later taken away from the user (supersedes #7608). (#8034) *(@haxiorz, via @pkarw)*
- 🔒 Exclude encrypted custom fields from plaintext fulltext and vector fallback text in search indexing, so encrypted values no longer reach the search driver or embedding provider (#7894). (#8043) *(@pkarw)*
- 🔒 Apply SCIM rate limiting before API-key/JWT resolution and SCIM bearer bcrypt verification, so invalid credentials can no longer exhaust CPU before the limiter runs (#7829). (#8076) *(@haxiorz)*
- 🔒 Strip `fieldPolicy.hashOnly` and excluded custom-field values, including `cf_` and `cf:` keys, from `search_get` AI tool output (#7827). (#8079) *(@haxiorz)*
- 🔒 Keep excluded and hash-only customer PII fields out of customer person, company and account vector sources by using scalar allowlists (#7826). (#8081) *(@haxiorz)*
- 🔒 Bound generated MCP and AI session keys by the owner's `UserAcl`, applying the intersection of key grants and the owner's effective feature and organization permissions (#7825). (#8086) *(@haxiorz)*
- 🔒 Keep administrative fields such as email subjects, bodies and management metadata out of public checkout pay-link reads by using an explicit public serializer (#7823). (#8087) *(@haxiorz)*
- 🔒 Block fresh SSO and local password sign-in for SCIM-deactivated accounts, which could previously sign in again after their sessions were revoked (#7824). (#8088) *(@haxiorz)*
- 🔒 Require job ownership or `progress.manage` to update or cancel a progress job via `PUT`/`DELETE /api/progress/jobs/:id`, so same-organization users can no longer rewrite or cancel other users' jobs (#8130). (#8131) *(@AHKSammich)*
- 🔒 Prevent Code Mode `api.request()` from forwarding its session API key, scope headers or request body to a redirect destination (#7532). (#8146) *(@haxiorz)*
- 🔒 Enforce participant role field permissions on public form attachments, so a submission participant can no longer upload to fields they cannot edit or download hidden attachments by ID (#7533). (#8147) *(@haxiorz)*
- 🔒 Restrict checkout link previews to the authenticated user's tenant and organization, so `checkout.view` holders can no longer preview unpublished or password-protected links elsewhere by slug (#7821). (#8159) *(@haxiorz)*
- 🔒 Block remote images in channel emails until the reader chooses **Load remote images** for that message, resetting consent when the message or sanitized content changes (#7819). (#8162) *(@haxiorz)*
- 🔒 Authorize `customer_accounts` custom-domain administration in the target organization, so `customer_accounts.domain.manage` in one organization no longer allows managing mappings in another (#7812). (#8167) *(@haxiorz)*
- 🔒 Cap `CALL_WEBHOOK` workflow activities at a default 30-second deadline and a 1 MiB streamed response limit, so a webhook can no longer hold worker resources or buffer unbounded responses (#7814). (#8170) *(@haxiorz)*
- 🔒 Reject authentication for suspended or soft-deleted tenants across staff and portal sign-in, session use and renewal, and API keys, even when authentication was previously cached (#7813). (#8172) *(@haxiorz)*
- 🔒 Encrypt custom entity fields marked Encrypted inside `custom_entities_storage.doc` with the tenant DEK, independently of EAV compatibility (#7810). (#8174) *(@haxiorz)*
- 🔒 Reject carrier webhooks that match more than one shipment, so organizations or tenants sharing a shipment ID and signing secret can no longer resolve to the wrong shipment (#7816). (#8179) *(@haxiorz)*
- 🔒 Stop advertising public caching on authorized attachment reads whose tenant/organization scope blocks anonymous access, so shared caches cannot replay private bytes (#7220). (#8180) *(@pkarw)*
- 🔒 Patch `webpack-dev-middleware` to 7.4.6 in the docs toolchain, rejecting path traversal requests such as `/static../secret.txt` (#8115). (#8181) *(@pkarw)*
- 🔒 Offer only catalog installation commands that begin with `yarn mercato module add` or `yarn mercato module enable` and contain no shell metacharacters in `create-mercato-app` (#8168). (#8188) *(@wojciechszyjka)*
- 🔒 Harden module search by making the app-line filter part of ranking and fixing the app directory, version parsing and download limits (#8124). (#8190) *(@wojciechszyjka)*
- 🔒 Exclude `.env*` files at every depth, including backups and production/preview variants, from Docker build contexts in the monorepo and the standalone-app template (#7817). (#8195) *(@haxiorz)*
- 🔒 Stop AI chat from automatically requesting model-supplied image URLs, replacing images in both Markdown renderers and in product, person and company cards with alt text so a response can no longer leak data embedded in an image URL (#7818). (#8197) *(@haxiorz)*
- 🔒 Stop agent web search with `includeContent` from reading pages redirected to domains the agent's guardrails deny, and from returning that redirected text under the original allowed result URL (#7548). (#8215) *(@haxiorz)*
- 🔒 Harden the production Content Security Policy in the main app and create-app template with per-request nonces, removing inline and eval script permissions and scheme-wide HTTPS/WebSocket connections outside development (#7264). (#8220) *(@haxiorz)*
- 🔒 Reject session API keys whose owner is deactivated, unconfirmed or deleted on every request, including cache hits, so deactivated staff can no longer keep access through a session key (#7223). (#8245) *(@pkarw)*
- 🔒 Seed tenant encryption maps when `mercato auth add-org` and directory tenant creation run, so protected fields are no longer written as plaintext in tenants created with data encryption enabled (#7687). (#8246) *(@pkarw)*
- 🔒 Discard unknown fields, including legacy `_client` blobs, from Gmail per-user credentials, keeping only `accessToken`, `refreshToken`, `expiresAt`, `scopes` and `email` (#3829). (#8302) *(@pkarw)*
- 🔒 Block direct execution of server-registered mutation tools through `POST /api/ai_assistant/tools/execute`, which now answers 403 instead of letting callers with write features bypass agent policy and approval (#3805). (#8304) *(@pkarw)*
- 🔒 Prevent twenty concurrent cart line additions from exhausting the connection pool by having promotion evaluation reuse the cart transaction with isolated entity managers instead of waiting on another connection. (#8305) *(@pkarw)*
- 🔒 Patch the dependency graph so the high/critical dependency audit is clean, aligning the TipTap/ProseMirror peer graph, and fix the standalone snapshot bootstrap and component-override test setup on `main`. (#8310) *(@pkarw)*
- 🔒 Scope customer interaction author and owner references to the record's tenant, requiring live same-tenant users for new assignments while keeping cross-organization attribution and offboarded authors readable (#7531) (supersedes #8148). (#8358) *(@haxiorz, via @pkarw)*
- 🔒 Reject Discord interaction and agent trace ingest request bodies above a finite cap (default 1 MiB, overridable with `OM_WEBHOOK_MAX_BODY_BYTES`) before signature verification, parsing or command execution (#7241) (supersedes #8233). (#8361) *(@haxiorz, via @pkarw)*
- 🔒 Require production tenant encryption configuration in the Docker Compose full-app setup, so production stacks no longer start without an encryption key (#7231). (#8377) *(@pkarw)*
- 🔒 Withhold agent web search synthesized answers (`answerWithheld: domain_policy`) when domain allow or deny lists are set, since the provider answer cannot be attributed to permitted sources (#7234). (#8378) *(@pkarw)*
- 🔒 Keep staff time-entry totals current under filters by computing full-filter aggregates, refreshing them after a successful change, using one filter-chip layer and collapsing the empty `DataTable` footer (#6990) (supersedes #7002). (#8379) *(@Marynat, via @pkarw)*
- 🔒 Keep encrypted custom fields out of search build contexts, combining the original fix with the encrypted-search protections so their values are not indexed (supersedes #7874). (#8410) *(@mikolajbogusz-they, via @pkarw)*
- 🔒 Equalize SSO password verification timing by always performing the same scoped eligibility reads after bcrypt for correct and incorrect passwords, including unresolved and passwordless accounts (#8344). (#8450) *(@pkarw)*
- 🔒 Carry the monorepo security pins for `node-forge` 1.4.1 and `sharp` 0.35.5 into create-app scaffolds, so fresh standalone apps no longer install `node-forge` 1.3.1 with twelve high-severity advisories (#5099). (#8451) *(@pkarw)*
- 🔒 Protect encryption maintenance with scoped compare-and-swap updates and require `--confirm-offline-maintenance <tenantUuid>` and `--allow-unsafe-old-key` before `decrypt-database --deactivate-maps` retires policies, preventing lost concurrent edits and partial retirement. (#8488) *(@pkarw)*
- 🔒 Throttle warranty-portal attachment uploads (POST and PUT) per authenticated tenant and customer user before multipart parsing or OCR, returning `429` with `Retry-After` once the existing upload limit is exhausted (#6323). (#8581) *(@pkarw)*
- 🔒 Enforce the customer portal session cap under concurrent logins by running the count, revoke and insert in one transaction under an advisory lock, so a customer can no longer exceed `MAX_CUSTOMER_SESSIONS_PER_USER` (#8627). (#8628) *(@AHKSammich)*
- 🔒 Raise the development Verdaccio upload limit to 100 MiB so publishing the current core tarball no longer fails with HTTP 413, and bind its anonymous endpoint to loopback by default (#8615). (#8655) *(@pkarw)*
- 🔒 Require company creation to target a live organization owned by the authorized tenant before creating the company or its profile, in `customers.companies.create` (#8675). (#8686) *(@pkarw)*
- 🔒 Stop changing a tenant embedding provider or model from dropping the shared vector and migration tables and wiping every tenant indexed data; settings now keep all vectors and return the reindex-required flag (#8676). (#8696) *(@pkarw)*
- 🔒 Pin public DNS for customer-domain TLS health checks by validating all A/AAAA answers against the shared public-address policy and connecting to the approved IP, so DNS answers cannot change after verification (#8679). (#8703) *(@pkarw)*
- 🔒 Bump the security resolutions for `ip-address` (10.4.0 to 10.7.5) and `hono` (4.12.25 to 4.13.14), excluding all 17 targeted advisory ranges. (#8717) *(@pkarw)*
- 🔒 Revoke the server-side session on logout for staff clients authenticating only with an `Authorization: Bearer` JWT, instead of redirecting while the session stayed active. (#8719) *(@pkarw)*
- 🔒 Recheck role assignments under the role lock when renaming a role or moving it to another tenant, so a role that gained a holder concurrently can no longer be renamed or moved (#8734, #8737, #8738). (#8735) *(@AHKSammich)*
- 🔒 Execute each approved AI assistant action only once under concurrent confirmation, by locking the scoped row and requiring the pending state so only the winning request runs the handler (GHSA-4cj8-2g3g-p4m3). (#8740) *(@pkarw)*
- 🔒 Update the Mermaid security pin from 11.16.0 to 11.17.2, addressing five Dependabot alerts for diagram denial of service and related vulnerabilities. (#8741) *(@pkarw)*
- 🔒 Show not-found instead of database UUID errors for malformed Forms and Documents detail IDs and child reads, and explain blocked OIDC discovery (#4187, #8731, #8969). (#8743) *(@pkarw)*
- 🔒 Honor entity search-strategy restrictions on direct and bulk `SearchService` writes, so a fulltext-only entity is no longer sent to a vector embedding provider. (#8758)
- 🔒 Parse create-app catalog install commands against an allowlist grammar, rebuilding them from parsed tokens instead of filtering shell characters (#8168). (#8777) *(@wojciechszyjka)*
- 🔒 Preserve the stored author of customer notes during ordinary body edits for staff and API keys, while non-key superadmins can still explicitly correct it to an active same-tenant user or null (#8759). (#8782) *(@pkarw)*
- 🔒 Enforce entity search-strategy restrictions across queued and synchronous reindex writes, with workers rechecking queued references so excluded backends receive no record payload (#8773). (#8783) *(@jakubmatwiejew-wq, @pkarw)*
- 🔒 Strip CR/LF from the subject, from, replyTo and attachment header values in the Resend channel adapter, preventing header injection (#8810). (#8811) *(@AHKSammich)*
- 🔒 Refuse to undo a resource type create while live resources are assigned to it, and reject unavailable resource types on create, update, undo and redo under per-type transaction locks (#8496) (supersedes #8497). (#8828) *(@AHKSammich)*
- 🔒 Replace the production image passwordless root `/bin/chown` grant with a root-owned `om-init-storage` helper that accepts no arguments and only changes the storage root (#8762). (#8842)
- 🔒 Enforce sandbox write boundaries in the Linux create-app harness, where Bubblewrap root and `/tmp` were writable, and diagnose a missing `unzip` with an actionable message (#8785, #8786). (#8844) *(@pkarw)*
- 🔒 Roll back user creation when role reconciliation is rejected, so a role moved to another tenant mid-request no longer returns 400 while leaving the account behind (#8850). (#8856) *(@pkarw)*
- 🔒 Reject missing or known placeholder superadmin passwords in `mercato init` when `NODE_ENV=production`, enforcing the shared password policy even when bypass flags are supplied while leaving development defaults unchanged (#7809). (#8896) *(@pkarw)*
- 🔒 Keep tenant, organization, soft-delete and visibility restrictions on customer interaction search and recurring-calendar reads by explicitly grouping their OR branches so they cannot escape the surrounding AND predicates (#8883). (#8906) *(@pkarw)*
- 🔒 Verify encryption compatibility before reusing an existing database during setup, ahead of migrations, initialization, recovery writes and MCP key provisioning, in both monorepo and standalone apps. (#8913) *(@pkarw)*
- 🔒 Keep a planned private email subject out of the shared customer next-interaction name read by People/company views, dashboards and search, while authorized interaction views still show it (#8888). (#8973) *(@pkarw)*
- 🔒 Reject callers lacking a route's required feature before the API dispatcher inspects their body, bound tenant extraction, and fail closed on cross-tenant management routes whose body cannot be inspected (#7811) (supersedes #7877). (#8988) *(@adeptofvoltron)*
- 🔒 Generate bulk dynamic-pool voucher codes in `promotions` with cryptographic randomness instead of `Math.random()`, which allowed predicting the rest of a pool from consecutive codes (#9023). (#9029) *(@pcbeingused333)*
- 🔒 Backfill `encryption_maps` for the checkout link template, link and transaction entities on tenants created before the checkout module shipped, so their data is encrypted (#8893). (#9064) *(@adeptofvoltron)*
- 🔒 Render EUDR plot names as text in Leaflet popups, preventing stored HTML injection through GeoJSON plot names (#9022). (#9068) *(@Sarthak-madan334)*
- 🔒 Derive customer portal authorization scope and CRM links from the current customer-user record, so existing sessions stop authorizing a previous company after reassignment and tenant or organization drift is rejected (#2244) (supersedes #7176). (#9124) *(@Sawarz)*
- 🔒 Reject mismatched product/variant pairs in bulk cart add with the existing `product_unavailable` outcome, deriving each variant's parent from scoped catalog records before pricing or writes (#9114). (#9126)
- 🔒 Let standalone builds on native Linux use a bridge-bound Verdaccio registry without exposing other development services, with tarball URLs following `OM_VERDACCIO_PUBLIC_URL` (#6949) (supersedes #6971). (#9133) *(@Kamyyylo)*
- 🔒 Skip onboarding and demo-feedback operator notifications and log a warning when `ADMIN_EMAIL` is unset, instead of sending submitter data to a hard-coded mailbox (#9163). (#9177) *(@Sarthak-madan334)*
- 🔒 Scope catalog dictionary reads to the caller's readable organizations and enforce key permissions, so a dictionary in an unrelated organization returns 404 instead of exposing its entries (#9157). (#9218)
- 🔒 Enforce per-entity record permissions for restricted custom entities regardless of the caller's home organization or an all-organizations selection (#9148). (#9219)
- 🔒 Preserve a supplied tenant encryption key or Vault configuration when creating the starter app env, instead of generating an extra fallback encryption key. (#9356) *(@pkarw)*
- 🔒 Bound public cart voucher guessing across rotating cart tokens with a shared per-IP and per-store attempt budget that fails closed, and reject another store's cart before repricing (#9119). (#9448)
- 🔒 Make advanced client filters narrow the route's server-enforced predicates instead of overwriting them, so a filter on the same field can no longer bypass member restrictions, deny-all IDs or server OR groups (#9016). (#9526, #10213) *(@pkarw)*
- 🔒 Reject foreign shipment and payment method/status references with HTTP 400 and bind them to the record's tenant and organization scope, so list hooks no longer load foreign names, codes or status labels (#9156). (#9585) *(@haxiorz)*
- 🔒 Enforce shared durable hourly user and tenant budgets and a daily distinct-recipient budget on external email sends across mailboxes, rejecting with `429` and `Retry-After` (or `503` on admission failure) before any message is created (#9161) (supersedes #9304). (#9598) *(@haxiorz)*
- 🔒 Reject changing an integration credential destination (URL, host or port fields) while preserving a masked write-only secret, with localized 422 field errors, so a saved secret can no longer be redirected to a new server (#9108). (#9601)
- 🔒 Keep event-triggered workflows on their server-authored trigger identity instead of identity fields in the event payload, denying execution before API-key creation or command execution (#9137). (#9639)
- 🔒 Bump `next` from 16.4.1 to 16.4.5, picking up fixes for security advisories including cross-tenant disclosure in `use cache` and cache leaks across root params. (#9715) *(@patzick)*
- 🔒 Route native inbox replies by scoped conversation provenance, so a reply without a pre-created channel link can no longer follow an arbitrary mapping when a platform thread holds several external conversations (#9739). (#9752)
- 🔒 Keep provider-native conversations such as Discord isolated from email thread-token matching, so a copied thread-token marker can no longer graft a new conversation onto another one (#9738). (#9773) *(@adeptofvoltron)*
- 🔒 Strip SQL literals and comments from Postgres span statements before exporting traces, so record content and ids from MikroORM-inlined parameters no longer leak through `db.query.text`. (#9803) *(@kmrosiek)*
- 🔒 Make MFA recovery and enrollment atomic, so concurrent requests can no longer reuse one recovery code or activate duplicate methods and emit duplicate enrollment events (#9673). (#9817)
- 🔒 Preserve concurrent email edits during auth key rotation and initial encryption by comparing the original email and lookup hash in a single pinned SQL update, aborting on a mismatch (#9538). (#9842)
- 🔒 Keep MFA enrollment, admin-reset and enforcement-policy emails sending when the optional `notifications` module is disabled, skipping in-app notifications with a warning (#9209). (#9854)
- 🔒 Enforce tool feature permissions during AI eval replay and per-case mocks, returning `tool_replay_forbidden` without revealing recorded output or invoking a live handler (#8922). (#9868)
- 🔒 Enforce project membership or management on `GET /api/staff/timesheets/time-projects/{id}/employees`, so staff holding only the global view feature can no longer enumerate another team's project membership (#8885). (#9876, #10142) *(@adeptofvoltron)*
- 🔒 Require approval for every agent write on non-agent channels in MCP approval mode and pass the channel context to nested agent tools, closing a bypass that ran writes directly, and fix the trace permission flash and MCP OpenCode docs. (#9953, #9958) *(@kmrosiek)*
- 🔒 Make `mercato auth rotate-encryption-key` fail instead of reporting success when user emails cannot be decrypted with the previous key, listing at most 20 scoped user IDs (#9537). (#10019, #10059)
- 🔒 Apply CRM private-email visibility to audit history JSON responses and CSV exports, including person and company snapshots, failing closed when live authority is missing or deleted. (#10030)
- 🔒 Serialize manual payment cancellation with capture reservations under the pessimistic row lock, refusing to cancel captured or reserved funds so cancel and capture can no longer both reach a provider (#8224). (#10047, #10058)
- 🔒 Retain section IDs when an attachment is purged after section indexing is toggled off, so the delayed deletion job no longer leaves derived text in search stores (#8926). (#10057, #10072)
- 🔒 Stop scheduler execution-history and queue-job detail reads from returning internal exception messages on database or queue failures, answering the translated generic error instead (#10166). (#10173, #10193)
- 🔒 Scope default auth rate limits by hashed account identifier when no trusted client address is available, so independent staff and customer accounts no longer share one login, signup or reset quota (#7549). (#10183) *(@pkarw)*
- 🔒 Preserve rejected organization selections when scopes are narrowed per feature, so a stale or inaccessible selected-organization cookie gets `organization_selection_invalid` instead of CRUD running under a fallback organization (#9220). (#10219, #10248) *(@haxiorz)*

## 🐛 Fixes
- 🐛 Make `mercato <command> --help` print usage instead of executing the command, so `mercato db generate --help` no longer runs a migration generation and `db migrate --help` no longer applies pending migrations (#5581). (#5660) *(@adeptofvoltron)*
- 🔄 Unregister the scheduled job when the `data_sync` schedule write fails, so a failed save no longer leaves an orphaned job running without a stored schedule (#5871). (#5916) *(@adeptofvoltron)*
- 🐛 Make `yarn mercato <module> <command>` exit with the status the command signalled via `process.exitCode`, so scripts, CI steps and `&&` chains no longer see success after a failed command (#5936). (#5961) *(@adeptofvoltron)*
- 🐛 Give inline editor edit/cancel controls on detail panels an accessible name and reveal them on touch devices, so screen-reader and phone/tablet users can reach the pencil affordance for profile fields (#5947). (#5966) *(@adeptofvoltron)*
- 🌍 Localize group headers in the column chooser and advanced-filter field picker by resolving translation-key-shaped group labels against the active dictionary, with the built-in customers groups (CRM, Contact, Profile, Notes, Socials) now translated (#5924). (#5974) *(@adeptofvoltron)*
- 🌍 Translate the "Tomorrow" label shown for upcoming planned activities in the customers section, which previously rendered a hardcoded English string on non-English locales (#5933). (#5976) *(@adeptofvoltron)*
- 🐛 Resolve API-key actors by name on sales document History tabs and in the audit log UI and CSV export, instead of showing the raw API key UUID (#6195). (#6214) *(@adeptofvoltron)*
- 🐛 Return a JSON 500 error instead of a bodyless response from the communication channels OAuth initiate endpoint when neither `OM_HUB_OAUTH_STATE_KEY` nor `KMS_MASTER_KEY` is configured. (#6251) *(@lbajsarowicz)*
- 🐛 Stop messages sent through a connected channel mailbox from also being emailed over the platform sender, which delivered every such message twice and failed outright on instances with only an OAuth mailbox. (#6260) *(@lbajsarowicz)*
- 🐛 Stop the idle 5-second progress poll in `useProgressSse` from racing a healthy SSE stream, removing needless `/api/progress/active` requests on every backend page. (#6269) *(@lbajsarowicz)*
- 🐛 Resolve the public quote-accept origin guard through `APP_URL` instead of `req.url`, so quote acceptance no longer fails behind TLS-terminating reverse proxies where the internal origin differs from the public one (#6283). (#6297) *(@adeptofvoltron)*
- 🌍 Translate the product type in the catalog global-search subtitle using the active locale (supersedes #6209). (#6404) *(@pidubiel)*
- 🐛 Route timesheet `timer-start` and `timer-stop` through the command bus so audit log, undo and list cache stay correct, cascade segments on entry soft-delete, and remember the last-used project across the timer bar and grid (#2609, #3750). (#6409) *(@Marynat)*
- 🐛 Report OCR timeouts and aborts as such instead of telling operators to check `OPENAI_API_KEY` when a page call is aborted (#6399). (#6435) *(@wojski999)*
- 🐛 Scroll the selected `TimePicker` slot into view and center it on open, instead of always opening at 00:00 when a value is already set (#6329). (#6477) *(@adeptofvoltron)*
- 🌍 Show the translated result toast after a Gmail OAuth connect on My communication channels, instead of a raw `connected`/`error` value or no toast (#6402). (#6521) *(@adeptofvoltron)*
- 🐛 Scope `POST /api/catalog/products/bulk-delete` to the selected organization rather than the caller's home organization, so non-superadmin users bulk-delete the products they actually selected (#6523). (#6534) *(@rengare)*
- 💰 Commit the sole variant automatically and hide zero catalog prices in the sales line dialog, so adding a catalog-backed line no longer dead-ends on products with one variant (#6075). (#6637) *(@adeptofvoltron)*
- 🐛 Make `mercato init --email` seed the admin and employee accounts under the derived superadmin domain, matching the printed banner instead of silently seeding `acme.com` addresses (#5806). (#6724) *(@Sawarz)*
- 💰 Recompute every affected order's paid, refunded and outstanding totals when a split payment's allocations change, instead of only the payment's primary order. (#6743) *(@AHKSammich)*
- 📦 Let a selected local tier skill replace a same-named skill from the external collection in `yarn install-skills`, so the repo's own `om-mockup-prototype` is no longer silently shadowed. (#6765) *(@SiphoChris)*
- 🐛 Render embedded `CrudForm` extra actions once, so the Staff member Edit availability form no longer shows a duplicate Cancel above the form and in the footer (#6750). (#6768) *(@pkarw)*
- 📦 Keep `pdfjs-dist` external in production builds so PDF text extraction and OCR work again and uploaded PDFs get their `attachments.content` filled instead of staying empty (#6398). (#6780) *(@adeptofvoltron)*
- 🐛 Scan a real `MetadataStorage` in the secondary table-name lookup of `resolveRegisteredEntityTableName`, restoring a lookup that never matched anything since MikroORM 7 returned a `Map` (#6725). (#6785) *(@Ramnath0521)*
- 🐛 Filter the admin Customer accounts users list by the organization selected in the switcher instead of always pinning it to the caller's home organization (#5574). (#6786) *(@adeptofvoltron)*
- 🐛 Show and persist the WMS Inventory profile card (manage inventory, default UOM, rotation strategy, lot/serial/expiration tracking, reorder point, safety stock) on product and variant create and edit forms, where the settings were missing or unsaved (#6142). (#6789) *(@adeptofvoltron)*
- 🐛 Make the `ActionsDropdown` menu reachable by keyboard with arrow-key navigation, so keyboard users no longer tab through the page footer to reach items in detail-header overflow menus (#6445). (#6792) *(@adeptofvoltron)*
- 💰 Keep an order line's stored tax rate in the sales line editor, so API-created lines no longer open as 0% VAT and a quantity-only save no longer silently drops the tax (#6461). (#6815) *(@adeptofvoltron)*
- 📦 Declare the Attachments, Currencies, Dictionaries and Entities modules as required by Catalog so incomplete standalone module selections are rejected early, and skip the commerce demo dataset when Sales is absent (#6517). (#6823) *(@haxiorz)*
- 🐛 Document encrypted list filtering and expose a development/test diagnostic so module authors can see when a missing token index makes an encrypted search return an empty successful result (#6729). (#6827) *(@haxiorz)*
- 🐛 Refuse user-task completion on a closed workflow run and close pending tasks when a run is cancelled, so submitting a task no longer revives a cancelled run. (#6830) *(@AHKSammich)*
- 🐛 Load organization-wide custom field definitions in `loadCustomFieldValues`, so values defined without an organization scope are no longer dropped (#6029). (#6836) *(@marcin-urbanski)*
- 🐛 Restore variants, prices, unit conversions and the owned option schema when a catalog product deletion is undone, instead of returning the product with no variants or prices. (#6838) *(@AHKSammich)*
- 🐛 Keep the WMS Release reservation dialog footer inside the dialog so the confirm button is no longer cut off with longer translations such as Polish (#6835). (#6842) *(@adeptofvoltron)*
- 🌍 Show a translated message in the WMS Adjust inventory dialog when a negative adjustment exceeds available stock, instead of the raw `insufficient_stock` code (#6834). (#6843) *(@adeptofvoltron)*
- 🐛 Show per-field validation errors in the IMAP connect dialog, now an embedded `CrudForm`, instead of flashing a raw zod JSON dump for missing or invalid fields (#5593). (#6845) *(@adeptofvoltron)*
- 🐛 Accept Stripe `charge.refunded`, `charge.refund.updated` and dispute webhooks instead of answering 401, and distinguish partial from full refunds so refunds made in the Stripe dashboard update the gateway transaction. (#6854) *(@AHKSammich)*
- 🐛 Honor `page` and `limit` in `GET /api/audit_logs/audit-logs/actions`, so the Audit Logs pager and Version History panel can reach older entries instead of always showing the newest rows. (#6856) *(@AHKSammich)*
- 🔧 Declare the missing module dependency in two modules that read another module's entity ids at import time, so they no longer throw while the registry is assembled with the other module disabled. (#6862) *(@michalper)*
- 🐛 Stop the customers calendar from updating state during render when dragging an empty Day or Week grid range, removing React's cross-component render warning (#6869). (#6876) *(@haxiorz)*
- 🐛 Scope the `/backend/users` list to the selected organization and its children for tenant admins, instead of listing every user in the tenant (#6803). (#6883) *(@adeptofvoltron)*
- 🌍 Complete the Spanish (es) translations for `agent_examples`, `example`, `auth`, `ai_assistant` and `sales`, replacing values still identical to English or empty (supersedes #6897, #6893). (#6895, #6896, #6901, #8586, #8956) *(@etor6233)*
- 🐛 Keep the default enabled state when `IntegrationStateService.upsert` creates a missing state row, so `webhook_custom` and `sync_excel` are no longer turned off by their first write (#6915). (#6916) *(@mikolajbogusz-they)*
- 🔄 Honor adapter batch-size defaults in CSV and Akeneo imports by letting `startDataSyncRun` pick the size when the operator omits it, while preserving explicit sizes and the 1..1000 bounds (#6464). (#6920) *(@haxiorz)*
- 🐛 Deliver replies to inbound communication channel messages instead of silently dropping them after a 404 for the channel system user (#6391). (#6921) *(@adeptofvoltron)*
- 🐛 Send the password-reset and magic-link emails requested on the customer portal, which previously returned 200 and showed "check your inbox" without sending anything (#5959). (#6924) *(@adeptofvoltron)*
- 💰 Serialize concurrent order and quote line mutations on a shared parent-row lock, so stale line graphs no longer overwrite order header totals, counts or positions (#6463). (#6925) *(@haxiorz)*
- 🌍 Localize customer dictionary labels on non-English interfaces, following the interface language for unchanged seeded labels while preserving explicit translations and operator-edited labels (#6197). (#6930) *(@haxiorz)*
- 🐛 Resolve timesheet and My Work targets through the EP-40 `staff.time_tracking.capacity_provider` registry, so registered providers' targets now show in the footer, day load bars and My Work KPIs instead of a person on leave showing "-40:00 to target" (#6934). (#6935) *(@Marynat)*
- 🔄 Refresh sibling panels on deal and person detail pages after marking an activity done, so the Planned activities panel no longer keeps showing it as planned until a full reload (#6933). (#6937) *(@Kamyyylo)*
- 🐛 Apply shipping carrier webhooks, which were dropped because the worker read the wrong payload field, and accept forward status skips such as `label_created` to `delivered`, so `shipping_carriers.shipment.delivered`/`.returned` fire and warranty RMA returns progress. (#6957) *(@AHKSammich)*
- 🐛 Keep stored `enabled`, `priority` and `version` values on partial `PUT /api/business_rules/rules` and `/sets` updates, instead of resetting them to `true`, `100` and `1` (#6940). (#6963) *(@adeptofvoltron)*
- 🐛 Let a workflow step last up to 90 days by widening `step_instances.execution_time_ms` past the 2^31 ms integer ceiling, which previously stranded runs when a long step completed. (#6966) *(@fshagent)*
- 🐛 Open the report that locks a time entry when choosing Show report from a locked entry's row menu or dialog, instead of the full reports list (#6976). (#6985) *(@adeptofvoltron)*
- 🔐 Check time-entry project access against the entry date and in the timesheet grid bulk save, so the grid refuses time logged on unassigned projects or outside assignment dates just as the entry dialog does (#6988). (#6998) *(@Marynat)*
- 🐛 Process inbound webhooks under the async (BullMQ) queue strategy, where signed requests were accepted with 200 and then never dispatched to any handler. (#7007) *(@jtomaszewski)*
- 🐛 Validate packaged module `requires` in `yarn generate` without executing TypeScript sources, so incomplete module dependency selections are reported instead of being silently swallowed (#6239). (#7008) *(@Marynat)*
- 🐛 Center the `DataTable` error state in the visible area, so the message no longer sits off-screen on tables wider than their scroll viewport. (#7009) *(@maxidragon)*
- 🌍 Show saved dictionary translations in the product unit dropdowns (base unit, default sales unit, conversion rows and preview) instead of the stored label (#6951). (#7035) *(@adeptofvoltron)*
- 🐛 Stop the Undo and Redo icons on Audit Logs rows from also opening the Action details dialog, which hid the undo result behind the dialog (#7012). (#7037) *(@adeptofvoltron)*
- 🐛 Delete a deal's custom field values when the deal is deleted, instead of leaving orphaned `custom_field_values` rows behind (#6996). (#7038) *(@adeptofvoltron)*
- 🐛 Show the employee's name instead of a raw staff-member id on the self Person filter chip in Time tracking entries (#7017). (#7039) *(@adeptofvoltron)*
- 🐛 Keep a saved view's legacy filter record when reading perspectives, so filters saved on pages using the legacy `FilterBar` are no longer lost when the view is reopened (#9033). (#7046) *(@maxidragon)*
- 💰 Keep shipping and surcharge totals when a quote is converted to an order, instead of writing them as 0 on the converted order. (#7051) *(@AHKSammich)*
- 🔄 Keep a schedule's `nextRunAt` current under `QUEUE_STRATEGY=async`, where it was never updated after the schedule fired. (#7053) *(@AHKSammich)*
- 🔄 Recover `sync_excel` CSV people re-imports after a person was deleted or an address was rejected, instead of failing on every later import. (#7054) *(@AHKSammich)*
- 🐛 Keep an executed notification action executed across dismiss and restore, so restoring a dismissed notification no longer allows its action to run again. (#7055) *(@AHKSammich)*
- 🐛 Restore a catalog category's custom field values when a category update is undone, instead of reporting success while keeping the edited values. (#7056) *(@AHKSammich)*
- 🔧 Add the missing blank line between the headers and the `multipart/alternative` body in outbound emails assembled by `communication_channels`, so strict MIME parsers no longer treat the boundary as a header continuation (#7097). (#7116) *(@adeptofvoltron)*
- 💰 Exclude failed and canceled payments from an order's paid totals, so such an order no longer shows Paid equal to the grand total, zero Outstanding, and refused shipment edits. (#7117) *(@adeptofvoltron)*
- 🐛 Honour the `First`, `Before` and `After` placement of DataTable columns injected through `data-table:<tableId>:columns` even when their widgets register late, instead of always rendering them last (#7083). (#7118) *(@adeptofvoltron)*
- 🔄 Pin one `Message-ID` across the Sent-folder copy and the delivered message in the IMAP channel, so the Sent copy matches the delivered email and replies thread correctly (#7101). (#7119) *(@adeptofvoltron)*
- 📦 Add the file extension to externalized legacy package subpaths such as `next/link` in the CLI bundle, so app backend pages importing them no longer produce a bundle that fails to load (#6993). (#7120) *(@adeptofvoltron)*
- 🐛 Keep the staff time-tracking project edit and board screens mounted while the organization scope first settles, so a pending "Request sent" state no longer flips back to an enabled "Request access" button. (#7132) *(@maxidragon)*
- 🔄 Accept deterministic uuid-formatted schedule ids that lack RFC 4122 version bits in the scheduler validators, so modules registering hash-derived schedule ids no longer get rejected (#7152). (#7157) *(@mtytula)*
- 💰 Enforce uniqueness of the `gateway_webhook_events` idempotency index, which migrated databases had recreated as a plain index, so redelivered payment gateway webhooks are dropped instead of processed twice (#7155). (#7159) *(@mtytula)*
- 🔄 Enqueue `mercato scheduler run <schedule-id>` through the queue factory like the trigger API does, so the command no longer fails with `Could not resolve 'queueService'` (#7158). (#7161) *(@mtytula)*
- 💰 Rotate payment gateway status polling so open transactions that never change status can no longer starve newer ones, including paid transactions whose webhook was lost. (#7162) *(@mtytula)*
- 🐛 Label canceled activities in the customers interaction history, so canceled planned activities no longer render like completed ones in deal and company history. (#7164) *(@wojciechszyjka)*
- 🔐 Hash the AI-chat session token before storing it in `api_keys` (new `session_token_hash` column) and stop embedding the raw token in the key name, so a database read can no longer expose live bearer credentials (#2254). (#7177) *(@Sawarz)*
- 🔄 Keep a sent Gmail email, its copy and the replies in one thread, instead of splitting them across two conversations after Gmail replaces the sent message's `Message-ID` (#7187). (#7188) *(@wojciechszyjka)*
- 🔧 Claim a PAUSED workflow instance atomically before a signal advances it, so concurrent deliveries of the same signal no longer duplicate downstream user tasks and activities (#7185). (#7190) *(@kurrak)*
- 💰 Keep pay-link usage counters (`completion_count`, `active_reservation_count`, `is_locked`) correct under concurrent payments, failed duplicate submits and undo/redo, so links no longer stay locked or accept more payments than allowed. (#7203) *(@AHKSammich)*
- 🐛 Preserve email interaction state across Person and Company delete undo, restoring message link, channel, visibility, meeting details and pin state that the delete snapshot previously dropped. (#7204) *(@AHKSammich)*
- 🔧 Keep omitted fields on partial checkout pay link and template `PUT` updates instead of resetting defaulted fields such as `status`, `themeMode` and the `send*Email` flags (#7127). (#7214) *(@lbajsarowicz)*
- 🔧 Align the `defineWorkflow` code-definition types with the engine validators, so code-defined workflows can use `WAIT_FOR_CONDITION` and the full `userTaskConfig` without type errors (#7183). (#7244) *(@kurrak)*
- 🌍 Keep translation-only module registrations from replacing the module registry when a `setup` override is declared in `modules.ts` (#7243). (#7245) *(@kurrak)*
- 🔧 Stop persisting the raw RFC 2822 message in `message_channel_links.channel_metadata`, so sent emails no longer bloat the table or keep message bodies outside the encrypted messages store (#7099). (#7246) *(@lbajsarowicz)*
- 📦 Stop `yarn dev` from retrying MCP API key provisioning every 120 seconds when `ai_assistant` is not installed, as in apps scaffolded with the `empty` or `wms` starter (#7140). (#7247) *(@lbajsarowicz)*
- 🐛 Keep an unsaved time tracking settings edit when the organization scope settles after a cold page load, so Save no longer stays disabled after the draft is overwritten (#7137, #7288). (#7248) *(@lbajsarowicz)*
- 🔧 Ignore the `err` stack printed below a non-error log entry in the dev runtime, so a single non-critical enricher timeout no longer leaves `yarn dev` marked degraded until restart (#6945). (#7254) *(@Kamyyylo)*
- 🐛 Send the optimistic-lock version on the first edit of an untouched built-in activity type, so that edit no longer fails the lock check (#7168). (#7267) *(@lbajsarowicz)*
- 🐛 Refresh the Visit availability panel in the example module when a save is blocked by a booking, so the panel shows current availability (#7167). (#7268) *(@lbajsarowicz)*
- 🐛 Return 400 with `Validation failed` details instead of 500 for invalid input on hand-written customer API routes (#7266). (#7276) *(@adeptofvoltron)*
- 🐛 Reject a malformed `tagIds` filter on sales orders, quotes and customer people/companies lists with a 400 instead of a 500 `DATABASE_ERROR` (#7265). (#7278) *(@adeptofvoltron)*
- 🔧 Keep optional catch-all path parameters such as `slug` required in the generated OpenAPI document, so standards-compliant consumers like OWASP ZAP no longer reject it (#7262). (#7279) *(@adeptofvoltron)*
- 💰 Revalidate returnable quantity when redoing a return create or undoing a return delete, refusing stale restores with a translated 409 so the same shipped units cannot be returned and credited twice. (#7280) *(@AHKSammich)*
- 🐛 Keep omitted delivery settings on partial webhook updates, so activating or deactivating a webhook no longer resets its HTTP method, retries, timeout, rate limit and auto-disable threshold. (#7281) *(@AHKSammich)*
- 📦 Keep `next/dynamic` and resolve bare `next` subpaths at the CLI entry, so CLI commands, workers and scripts loading `@open-mercato/ui` no longer crash with `ERR_MODULE_NOT_FOUND` (#7102). (#7282) *(@adeptofvoltron)*
- 🔐 Keep the staff password-reset form from submitting via GET before hydration, so the email address no longer leaks into the URL and the form posts to `POST /api/auth/reset` (#7263). (#7284) *(@adeptofvoltron)*
- 📦 Align the `@open-mercato/gateway-tpay` package version with the 0.9.0 monorepo version, fixing the failing version-alignment check. (#7285) *(@adeptofvoltron)*
- 🐛 Refuse undo of a leave request create or approval after the request was approved or rejected, so undo no longer soft-deletes it while leaving approval-created planner unavailability rules behind. (#7290) *(@AHKSammich)*
- 🔧 Serialize writes to an empty WMS inventory bucket so concurrent writes keep one `wms_inventory_balances` row, preventing phantom stock, refused moves and multiplied quantities from `verify-balances --repair`. (#7291) *(@AHKSammich)*
- 🖼️ Keep a stored attachment file until the last `attachments` row referencing it is deleted, so deleting a copied variant media or forwarded message attachment no longer breaks the others (#7309). (#7292) *(@AHKSammich)*
- 🐛 Refuse stale warranty claim-line undos and keep claim header totals in step, so undoing a line command no longer overwrites work done after it. (#7296) *(@AHKSammich)*
- 🔧 Resolve a workflow async-activity wait from the queue jobs it actually queued, so a run whose async activity failed once can be recovered by retry or rerun-from-step. (#7318) *(@AHKSammich)*
- 💰 Keep exactly one base currency through undo, redo and concurrent writes, so the currencies admin no longer leaves an organization with no base or several. (#7319) *(@AHKSammich)*
- 🔧 Skip the customers channel backfill migration when `communication_channels` is not enabled, so `mercato db migrate` and `mercato init` no longer fail with `relation "message_channel_links" does not exist`. (#7325, #9586) *(@maxidragon)*
- 💰 Attach the `escape` clause to each `ilike` in the Payment transactions search, so searching the list no longer returns a 500 syntax error for every term. (#7326) *(@marcinwadon)*
- 💰 Show a table error when Payment transactions fail to load, instead of clearing the rows and implying the transaction does not exist. (#7327) *(@marcinwadon)*
- 🐛 Reject malformed `ids` on `GET /api/directory/organizations` with a validation error instead of a bare 500. (#7328) *(@marcinwadon)*
- 🐛 Preserve each calendar interaction's time zone and original scheduled instant when undoing a Person or Company delete (#7313). (#7339) *(@haxiorz)*
- 🔄 Invalidate the global hostname cache when a custom domain mapping is deleted, so a removed hostname stops serving the previous tenant's storefront immediately (#7315). (#7340) *(@haxiorz)*
- 🐛 Allow deleting a Person that has active or revoked email conversation shares, and preserve those shares through undo and redo (#7314). (#7341) *(@haxiorz)*
- 🌍 Translate warranty claim audit action labels into the request locale instead of storing raw translation keys (#7308). (#7348) *(@haxiorz)*
- 🐛 Keep warranty grade suggestions valid for the claim type, so return-claim lines received with grade C or D stay editable instead of failing the next save with 400 (#7307). (#7353) *(@haxiorz)*
- 🐛 Allow redo of warranty claim line receiving and quarantine release (#7305). (#7357) *(@haxiorz)*
- 🐛 Keep live warranty claim line numbers unique (#7306). (#7359) *(@haxiorz)*
- 💰 Allow creating currencies and exchange rates on the first save before the organization scope initializes, including immediately after login (#7354). (#7365) *(@haxiorz)*
- 🐛 Show why an undo or redo was refused in the version history panel, instead of silently doing nothing (#7355). (#7366) *(@wojciechszyjka)*
- 🌍 Keep the locale decimal comma when numeric fields are redisplayed, so Polish `2,5` no longer turns into `2.5` after blur or reload (#6309). (#7372) *(@wojciechszyjka)*
- 💰 Prevent quote self-conflicts after local edits, so a quote converts right after its author adds a line, shipping and a surcharge while stale edits from another tab are still rejected (#7294). (#7373) *(@haxiorz)*
- 🌍 Explain a refused product-delete undo in the user's language when a variant SKU has since been given to another variant, instead of showing the English "Undo failed" (#7011). (#7374) *(@wojciechszyjka)*
- 🔄 Let admins set the Ollama base URL in the vector search settings, so a non-default Ollama host can be configured from `/backend/config/search` (#3796). (#7376) *(@wojciechszyjka)*
- 🔐 Make the integration detail page read-only for users without `integrations.manage`, instead of offering management actions to view-only roles (#6415). (#7377) *(@wojciechszyjka)*
- 💰 Refuse to re-run a WMS stock reservation for a cancelled sales order, so it no longer recreates a live reservation against stock other orders need (#4521). (#7378) *(@wojciechszyjka)*
- 💰 Refuse to cancel an order that still has shipments or unrefunded payments, returning a translated 409 instead of silently flipping the status (#4054, #4059). (#7379) *(@wojciechszyjka)*
- 🐛 Load customer edit-form dictionaries from the record's organization, so Status, Lifecycle stage, Source, Industry and Job title selects work when the picker is on All organizations (#3593). (#7384) *(@wojciechszyjka)*
- 🐛 Close the message delete confirmation when the delete hits a conflict, instead of leaving it open over a refetched version (#3681). (#7385) *(@wojciechszyjka)*
- 🐛 Reset consecutive failures when re-activating a webhook, so an auto-disabled webhook is no longer disabled again by its next failed delivery. (#7409) *(@adeptofvoltron)*
- 🌍 Add the missing entity-type label for ecommerce stores, so search results show a proper chip instead of `Ecommerce · Ecommerce Store` (#7408). (#7410) *(@adeptofvoltron)*
- 🐛 Reject non-UUID pending-action ids with 400 instead of a raw 500 on the AI assistant action routes (#7352). (#7411) *(@adeptofvoltron)*
- 🌍 Translate the session-expired and access-denied flash banners, so Polish and German backends no longer show them in English (#7381). (#7412) *(@adeptofvoltron)*
- 🔐 Treat a malformed %-escape cookie as absent on logout and session refresh instead of failing with a 500 (#7382). (#7413) *(@adeptofvoltron)*
- 🐛 Paint pinned DataTable cells with the card surface and carry the row hover tint through them, and stop the staff timesheet's sticky Project column from drawing over the top bar (#7414). (#7419) *(@Marynat)*
- 🔄 Relay `portalBroadcast`-only events across processes, so events emitted from the queue worker reach the customer portal's SSE stream (#2973). (#7420) *(@WojciechSoczynskiTHEY)*
- 🐛 Skip stale rows on AI bulk confirm and assert the previewed record version on writes, so confirming a partly stale batch no longer overwrites changed records (#7221). (#7428) *(@AHKSammich)*
- 🐛 Return 409 instead of 500 when creating a business rule with a Rule ID the tenant already uses (#7363). (#7437) *(@adeptofvoltron)*
- 🐛 Stop AI mutation-preview diffs from showing untouched fields as cleared in the "Review proposed changes" approval card. (#7438) *(@adeptofvoltron)*
- 🌍 Translate the audit log redo route's generic failure fallback instead of returning a hard-coded English `Redo failed` (#7386). (#7439) *(@adeptofvoltron)*
- 🐛 Attribute the automatic "Awaiting return" to "Received" warranty claim transition to "System" instead of "Unknown user" in the claim timeline and the raw zero UUID in the audit log. (#7440) *(@adeptofvoltron)*
- 🐛 Show a neutral result instead of the destructive "Action failed" card when an operator cancels an AI mutation proposal, dropping the raw `cancelled_by_user` code, the untranslated message and the misleading "Fix with AI" retry button. (#7441) *(@adeptofvoltron)*
- 🐛 Resolve `{{...}}` templates in the `duration` and `until` of `WAIT_FOR_TIMER` workflow steps at step entry, so a templated timer that passed validation no longer fails on every run. (#7455) *(@mstopinski)*
- 🐛 Keep defaults, enums and descriptions in AI agent tool input schemas, so defaulted fields stay optional, enum fields reject unknown values and the model sees field descriptions (#7452). (#7457) *(@mstopinski)*
- 📦 Enable `api_keys` in the empty starter preset (and the `crm` / `wms` presets that extend it), so a fresh `npx create-mercato-app` no longer fails setup with "Metadata for entity ApiKey not found". (#7473) *(@patzick)*
- 🐛 Persist markdown code-block controls immediately in the editor, so changes made through them are no longer lost (#7469). (#7477) *(@haxiorz)*
- 🌍 Show the translated "Actions" column header on the order Payments tab, matching other backend lists, instead of an empty header (#7435). (#7480) *(@haxiorz)*
- 🐛 Keep backend table columns stable during initial loading and Refresh, and release the base table with a localized reload instruction when the client injection registry fails instead of showing "Loading table" forever (#7436). (#7484) *(@haxiorz)*
- 🐛 Answer `400` instead of a bare `500` when `POST /api/messages` compose or `GET /api/messages` list validation fails, such as a missing subject, non-UUID recipient or disallowed action `href`. (#7508) *(@adeptofvoltron)*
- 🔧 Stop empty `$in`/`$nin` filters from producing invalid SQL, so a `?ids=` filter matching nothing returns an empty page instead of a `500` on query-engine-backed list APIs (#7502). (#7509) *(@adeptofvoltron)*
- 🐛 Keep `api_keys` optional for authorization-state locks, so apps that disable the module no longer crash on the first user, role or ACL write with "Metadata for entity ApiKey not found" (#7444). (#7511) *(@adeptofvoltron)*
- 🐛 Refuse undoing `eudr.statements.create` when it would delete an archived statement, one past its amendment window or one still referenced by another statement (#7506). (#7512) *(@AHKSammich)*
- 🐛 Refuse audit-log undos in `staff` timesheets that would change or delete a time entry locked by a closed report, which previously bypassed the `time_entry_locked` check (#7507). (#7515) *(@AHKSammich)*
- 🔐 Clear the organization-scope cookies on logout, so the next user of the same browser no longer inherits "All organizations" and the staff Timesheet "my projects" list stops querying with an empty string (#7465). (#7516) *(@Marynat)*
- 🐛 Stop parallel `POST /api/customers/people` requests that share a new job title, status or source from failing with `500 DATABASE_ERROR`, by inserting the dictionary entry atomically. (#7521) *(@mtytula)*
- 🐛 Restore the previous override state when undoing `feature_toggles.overrides.changeState`, instead of leaving the changed value in place, and evict the cache through a properly loaded toggle (#7554). (#7568) *(@AHKSammich)*
- 🐛 Name the conflicting SKU or handle when undoing `catalog.products.delete` collides with another product, instead of the generic "Undo failed" message. (#7571) *(@adeptofvoltron)*
- 🐛 Keep `id` in `webhookUpdateSchema` so `PUT /api/webhooks/webhooks` works instead of always answering `400 Invalid id` (#7504). (#7572) *(@adeptofvoltron)*
- 🐛 Let people and companies that carry labels be deleted, instead of failing with `409 FOREIGN_KEY_VIOLATION`, by removing label assignments in the delete transaction and restoring them on undo. (#7575) *(@AHKSammich)*
- 💰 Keep a price kind's `displayMode` on partial `PUT /api/catalog/price-kinds` updates, so renaming or toggling an including-tax kind no longer silently switches it to excluding-tax (#7555). (#7586) *(@AHKSammich)*
- 🐛 Default the quote "Send to customer" dialog to the quote's existing `validUntil` instead of a hardcoded 14 days, so sending no longer overwrites a different validity period (#7468). (#7603) *(@adeptofvoltron)*
- 🐛 Restore the empty preview in the Company/Person/Deal linking dialog after deselecting the last entry, instead of keeping the removed entry focused (#7492). (#7604) *(@adeptofvoltron)*
- 🐛 Stop the Activity History "More" action from crashing with `Cannot read properties of undefined (reading 'saveIcon')` when opening an Event or custom activity type in `ScheduleActivityDialog` (#7486). (#7605) *(@adeptofvoltron)*
- 🔧 Add a `--no-demo-users` flag to `mercato init` so fresh production bootstraps can skip seeding the derived admin and employee demo accounts (#7517). (#7607) *(@adeptofvoltron)*
- 🐛 Save the condition displayed for new Form Studio visibility rules instead of an empty `eq` value, and fit the rule controls inside the 320px Properties panel (#7565). (#7610) *(@haxiorz)*
- 🐛 Prune released and abandoned payment-session initialization claims, which previously accumulated indefinitely, while protecting live leases and the 24-hour completed-session replay window (#4888). (#7623) *(@haxiorz)*
- 🐛 Lock the `customer_entities` row before cleanup in `customers.people.delete` and `customers.companies.delete`, so concurrently inserted child rows no longer cause a `409 FOREIGN_KEY_VIOLATION`. (#7628) *(@adeptofvoltron)*
- 🐛 Stop AI mutation cards from polling forever after a 404, and fix idempotency-key collisions that caused `duplicate key` errors on retried tool calls (#7550). (#7630) *(@adeptofvoltron)*
- 🔧 Declare the undeclared setup-time module dependencies of `customers`, `portal` and `workflows` in `requires`, so apps missing them fail clearly instead of with "Metadata for entity Dictionary not found" during init. (#7631) *(@adeptofvoltron)*
- 🐛 Refuse a stale undo of `feature_toggles.overrides.changeState` that would discard a later admin change, and fix the null `resourceId` on override actions (#7584). (#7632) *(@adeptofvoltron)*
- 🔧 Make the command bus compare an object referenced twice in a snapshot by value, so the action log no longer lists fields that did not change. (#7646) *(@dawid-walkiewicz)*
- 🐛 Log only the columns that actually changed in `sales.orders.update` and `sales.quotes.update`, instead of always listing snapshot, `customFields` and `metadata` columns as edited. (#7647) *(@dawid-walkiewicz)*
- 🐛 Refuse organization undos and redos that would form a parent cycle in the hierarchy, instead of writing back stale parent ids (#7677). (#7678) *(@AHKSammich)*
- 🐛 Respect a column's custom cell renderer over the `DataTable` `_at` date-name heuristic, so columns with such ids no longer render blank or ignore their `cell` (#7640). (#7681) *(@adeptofvoltron)*
- 🐛 Let `ConfirmDialog` reopen after being cancelled with Escape, instead of staying hidden until the host component remounts (#7639). (#7684) *(@adeptofvoltron)*
- 🐛 Keep DataTable column headers visible while scrolling long backend lists, including virtualized tables and embedded or padded scroll panels (#7702). (#7713) *(@haxiorz)*
- 🐛 Preserve the original creation timestamps of resource comments and activities across undo and redo (#7666). (#7715) *(@haxiorz)*
- 🐛 Soft-delete the toggle when undoing `feature_toggles.global.create`, retaining its tenant overrides, and restore the same row on redo, matching normal global deletion (#7664). (#7716) *(@haxiorz)*
- 🐛 Preserve the original ID and exact value of a tenant feature-toggle override when its creation is redone, instead of creating a new UUID (#7665). (#7717) *(@haxiorz)*
- 🐛 Remove a variant's prices when its `catalog.variants.create` is undone, instead of leaving orphaned prices with a null `variant_id` (#7722). (#7723) *(@AHKSammich)*
- 🐛 Invalidate the `catalog.offer` list cache on product update and its undo, so `GET /api/catalog/offers?productId=…` no longer serves stale offers with `ENABLE_CRUD_API_CACHE=true` (#7721). (#7736) *(@adeptofvoltron)*
- 🐛 Break organization sibling ties by name instead of comparing a name against the other sibling's raw id, so sibling order is alphabetical as intended (#7718). (#7737) *(@adeptofvoltron)*
- 🌍 Reword the catalog merchandising assistant panel description in all five locales, which wrongly claimed it was a read-only demo where no writes are applied (#7735). (#7738) *(@adeptofvoltron)*
- 🐛 Accept a null `subtitle` on catalog product update validation, so the merchandising assistant `catalog.update_product` and `catalog.bulk_update_products` tools no longer fail with "Invalid input" (#7730). (#7739) *(@adeptofvoltron)*
- 🌍 Localize the seeded checkout service-package custom field fieldset, sections, labels and help text in link and template editors, while preserving tenant-authored copy (#7748). (#7754) *(@haxiorz)*
- 🐛 Mount the four advertised sales stage-bar and closure injection slots and run the shared response enrichers on quote headers, so UMES extensions now render on sales documents (#7781, #7782, #7783). (#7784) *(@pkarw)*
- 🐛 Add the Duplicate row action to the deals list view, matching the Kanban card menu. (#7789) *(@WojciechSoczynskiTHEY)*
- 🐛 Refuse to set a disconnected channel as primary in `POST /api/communication_channels/channels/{id}/set-primary`, which previously promoted any owned channel regardless of status (#7799). (#7800) *(@AHKSammich)*
- 🔧 Stop Turbopack-built production servers from crashing every Redis-backed cache call with a `Class constructor Redis cannot be invoked without 'new'` error, by resolving the real `Redis` class before the module namespace (#7869). (#7878) *(@adeptofvoltron)*
- 🐛 Refresh the customer name on a warranty claim when an update changes only `customerId`, instead of leaving the previous customer's name on the claim (#7848). (#7889) *(@Tomeckyyyy)*
- 💰 Keep the contact, billing/shipping addresses and address snapshots on `PUT /api/sales/orders` and `PUT /api/sales/quotes` when the payload resends the same `customerEntityId`, instead of clearing them (#7899). (#7900) *(@AHKSammich)*
- 🐛 Name the workflow in the Retry and Cancel confirmation dialogs on the workflow instances list instead of showing a literal `{{workflowId}}` placeholder in every locale (#7890). (#7907) *(@oskarwoj)*
- 🌍 Translate the user and role grant check errors in `auth`, so org-restricted admins using a non-English UI get localized messages instead of English `403` text (#7368). (#7909) *(@oskarwoj)*
- 🐛 Claim the action status atomically when `PATCH /api/inbox_ops/proposals/{id}/actions/{actionId}/complete` completes an inbox action externally, so concurrent requests can no longer overwrite each other's status (#7912). (#7913) *(@AHKSammich)*
- 🐛 Refuse `PUT /api/entities/records` for unknown or soft-deleted record ids instead of updating or resurrecting them (#7917). (#7918) *(@AHKSammich)*
- 🐛 Keep rejected customer task edits open with the attempted values and suppress the false success notice after a conflict is rejected (#7858). (#7930) *(@haxiorz)*
- 🐛 Detect calendar double-booking when the same user owns a task and participates in an overlapping meeting, in both the calendar grid and the event editor, for the `all` and `mine` scopes (#7862). (#7931) *(@haxiorz)*
- 🐛 Stop offering "Show more" on a Kanban lane once every deal matching the currency filter is loaded, while keeping the all-currency summary and currency choices intact (#7860). (#7936) *(@haxiorz)*
- 🐛 Let the CRM AI assistant list, update and delete activities immediately after creating them, with accurate approval snapshots and versions (#7863). (#7937) *(@haxiorz)*
- 💰 Keep a single default tax rate per organization when undoing an update or delete of a tax rate in `sales`, instead of leaving two defaults (#7942). (#7943) *(@AHKSammich)*
- 🐛 Preserve a customer task's description, priority, due date, title and unrelated custom fields when it is completed or reopened (#7853). (#7945) *(@haxiorz)*
- 🐛 Restore the delivery company, building number and flat number on each address when undoing the deletion of a person or company (#7854). (#7946) *(@haxiorz)*
- 🐛 Restore a customer tag's original person and company memberships when undoing the tag deletion (#7855). (#7948) *(@haxiorz)*
- 🐛 Let users with `warranty_claims.claim.view` open claim details without `attachments.view`, instead of failing on the optional attachment-count request and raising a forbidden notice (#7846). (#7949) *(@haxiorz)*
- 🐛 Refresh the customer claim tracker in the warranty portal when staff update status or comments, preserving an unfinished reply and ignoring stale responses (#7847). (#7951) *(@haxiorz)*
- 🐛 Restore conflict recovery when staff submit stale RMA receiving or return-label actions, by keeping the structured error body that conflict detection needs (#7845). (#7953) *(@haxiorz)*
- 🐛 Load every line page of a warranty claim in the claims desk, so accepted claims with 101-200 lines stay inspectable, receivable and selectable for vendor recovery (#7844). (#7974) *(@haxiorz)*
- 💰 Reject warranty claim order changes that are incompatible with retained claim lines, validating every retained live line against the new order instead of only the header (#7843). (#7976) *(@haxiorz)*
- 🐛 Retain the customer's failure description from inbound InboxOps emails in warranty claim notes, by hydrating the email body that the `inbox_ops.email.received` event does not carry (#7842). (#7977) *(@haxiorz)*
- 🐛 Retry failed warranty email claim intake by rethrowing claim creation failures, so the persistent event worker fails the delivery and the queue retries it (#7841). (#7978) *(@haxiorz)*
- 🐛 Enforce sold-quantity limits when undoing a warranty claim-line edit, preventing a restore from claiming more units than the linked order line sold (#7840). (#7981) *(@haxiorz)*
- 🐛 Persist editor changes before creating a named document version, so saving a version right after editing no longer snapshots the earlier body (#7839). (#7984) *(@haxiorz)*
- 🐛 Make the collaborative document editor wait for its initial sync before accepting input, so fallback after the six-second timeout no longer replaces the editor and drops typed content (#7838). (#7985) *(@haxiorz)*
- 🐛 Stop deal undo and redo from restoring a pipeline stage that has since been deleted, in all three snapshot-restore paths (#8000). (#8001) *(@AHKSammich)*
- 🐛 Keep resource undo and redo working after a tag in the audit snapshot has been deleted, instead of failing with a `400` on the missing tag (#8003). (#8004) *(@AHKSammich)*
- 🐛 Honour injected tab priority against built-in tabs on customer company, person and deal detail pages (supersedes #7020). (#8020) *(@lchrusciel, via @pkarw)*
- 🌍 Fix the ungrammatical Polish `ui.advancedFilter.empty.noMatches` heading shown when a filtered list returns no rows (#7893). (#8024) *(@marcinwadon)*
- 🐛 Keep the duration of a custom Note-based CRM activity unchanged when only its title is edited, instead of adding a default 30-minute duration (#8026). (#8028) *(@haxiorz)*
- 🐛 Restore claim line removal in warranty claims, making it reachable from the row actions menu again (#8012). (#8032) *(@haxiorz)*
- 🐛 Allow undo of a warranty replacement order after approval initialization, accepting the initial `null -> pending_approval` version change while still refusing undo after genuine edits (#8014). (#8033) *(@haxiorz)*
- 🐛 Match pinned list columns on warranty Claims, Registrations, Troubleshooting guides and Vendor policies to their card surface in light and dark themes, including header and row hover (#7997, #8064). (#8035) *(@haxiorz)*
- 🐛 Preserve native Enter/Space activation on notification action and dismiss buttons, with the enclosing card handling keyboard activation only when it is the event target (#7983). (#8036) *(@haxiorz)*
- 🐛 Stop ecommerce storefront resolution from using a store's default channel whose sales channel was deleted (#8053). (#8054) *(@AHKSammich)*
- 🐛 Recover the agent Tasks list's last-execution health after the event bridge reconnects, so a run started during reconnection no longer leaves a stale Failed status. (#8071) *(@haxiorz)*
- 🔧 Isolate inbound webhook receipt deduplication by endpoint, message ID, verified tenant and organization, so the same message ID in another verified scope is ingested independently (#7830). (#8075) *(@haxiorz)*
- 🐛 Keep unsaved project team assignments available to save when the translation context refreshes on the staff projects page. (#8082) *(@haxiorz)*
- 🐛 Keep the calendar event editor pristine after related-record labels load, so Escape closes an untouched editor without a discard confirmation. (#8083) *(@haxiorz)*
- 🔧 Guard dev sessions with an atomic canonical-workspace lock with stale-owner recovery, and pick a free MCP port when the preferred one is occupied, propagating the endpoint to the app and OpenCode (#8046, #8044). (#8100) *(@pkarw)*
- 🐛 Anchor planner availability `DTSTART` to the declared timezone with consistent DST disambiguation, falling back to UTC for unresolvable legacy labels and skipping dates a timezone skips entirely (supersedes #5868). (#8110) *(@marcinwadon, via @pkarw)*
- 📦 Keep comments, blank lines and commented-out entries in `src/modules.ts` when running `yarn mercato module add` and `module enable` (#8111). (#8114) *(@wojciechszyjka)*
- 📦 Stop `yarn mercato module add` from duplicating modules that a standalone app registers behind env flags, such as `storage_s3` behind `OM_ENABLE_STORAGE_S3` (#8112). (#8116) *(@wojciechszyjka)*
- 📦 Treat `yarn mercato module add` and `module enable` of an already enabled module as a no-op success instead of exiting with code 1 (#8121). (#8122) *(@wojciechszyjka)*
- 🐛 Stop a slow Tillio operator detach from overwriting an operator attached concurrently while the token revocation call is in flight (#8126). (#8127) *(@AHKSammich)*
- 🐛 Stop channel-ingested emails from being echoed back to their sender by honouring an explicit `sendViaEmail: false` from internal message producers (#6089) (supersedes #6090). (#8133) *(@mobinea, via @pkarw)*
- 🐛 Make custom-record `POST` create-only, so posting an existing record UUID can no longer replace a newer document without the version check enforced by `PUT` (#7815). (#8163) *(@haxiorz)*
- 📦 Use only a command's own warning for catalog collision warnings in `create-mercato-app`, even when object prototypes contain matching keys (#8169). (#8189) *(@wojciechszyjka)*
- 🐛 Preserve an organization's lifecycle state when its creation is undone and redone in the directory module, instead of losing it on replay (#7663). (#8217) *(@haxiorz)*
- 🔐 Let user-bound API keys read their personal dashboard layout and profile, resolving the bound user within the key's tenant and organization and answering 403 for missing, malformed, deleted or out-of-scope bindings instead of failing UUID lookups (#7261). (#8219) *(@haxiorz)*
- 🔄 Fix recurring data-sync schedules not dispatching by resolving a queue's owning module from the module registry entry that declares its worker instead of splitting the worker id on `:` (supersedes #6341). (#8254) *(@maxidragon, via @pkarw)*
- 💰 Store the unit net before discounts for gross-only order and quote lines, so adding or editing another line no longer applies the discount a second time, including for fractional quantities (supersedes #8249). (#8267) *(@matkowalski, via @pkarw)*
- 🐛 Repair the CRM UMES extension flow so contributor fields keep hydrated values, run lifecycle callbacks, save through their owning APIs and stay visible after reload on person, company and deal detail pages (#6736) (supersedes #6931). (#8269) *(@haxiorz, via @pkarw)*
- 💰 Keep a gross-only price edit at `/backend/catalog/prices/[id]/edit`, deriving net from the edited gross and tax rate instead of recomputing gross from the unchanged net (#8248). (#8270) *(@adeptofvoltron)*
- 🔐 List tenant-wide API keys alongside organization keys for unrestricted actors and superadmins, while restricted actors keep organization-only visibility (supersedes #6307). (#8273) *(@okwasniewski, via @pkarw)*
- 🐛 Open Markdown containing code blocks in the rich-text editor, with a translated Plain text fallback for untagged blocks, and persist code-block language changes and deletions on immediate save (#6997) (supersedes #7036). (#8274) *(@adeptofvoltron, via @pkarw)*
- 🌍 Preserve unknown inbound message timestamps as `null` in communication channels and show a translated "Unknown date" label instead of the import date (#5326) (supersedes #5446). (#8285) *(@jarekdrabek, via @pkarw)*
- 🔄 Index and read declared tenant-global entity types under the null tenant in `query_index`, retiring legacy scoped projections on reindex so platform-wide catalogues stay searchable from any selected organization (supersedes #5723). (#8287) *(@Geeknauts-company, via @pkarw)*
- 🐛 Show negative discount amounts as explicit positive markups on sales documents with externally supplied amounts, and expose the reason for disabled line edit/delete controls through keyboard-focusable tooltips (#8240). (#8288) *(@pkarw)*
- 🐛 Show the optimistic-lock "Record changed" conflict bar above open modal dialogs, drawers and sheets, so a stale save no longer leaves a blurred, unclickable bar under the overlay and a dialog that will not close (#8289). (#8290) *(@pkarw)*
- 🐛 Stop custom entity record lists from looping on render and re-requesting the same page while custom-field definitions are still loading (#8271). (#8300) *(@pkarw)*
- 🐛 Preserve a child control's own disabled state in `FormField`, so WMS locks, warranty-claim controls and role-limited fields keep the state their callers set (supersedes #6403). (#8335) *(@mat-kruk, via @pkarw)*
- 🔧 Keep `mercato server dev` on the lightweight dev-supervisor manifest in standalone apps, no longer bootstrapping the whole application for the entire `yarn dev` session (about 300 MB of memory). (#8337) *(@andrzejewsky)*
- 📦 Pin the Documents TipTap runtime train to the reviewed `3.32.0` graph and convert on the server with `happy-dom@21.0.4`, fixing standalone installs that failed the five-day dependency quarantine. (#8349) *(@pkarw)*
- 💰 Expire catalog promotional prices at the exclusive end instant, using a half-open `[startsAt, endsAt)` validity window so a contract price wins exactly when the promotion ends (#8102) (supersedes #8244). (#8364) *(@pidubiel, via @pkarw)*
- 🐛 Fix the customers task drawer so status options align their icon and color indicator on one row, and let Cmd/Ctrl+Enter resubmit the task dialog after an optimistic-lock rejection (#8319, #8320). (#8369) *(@pkarw)*
- 🐛 Load translations and injection registries on the login page so modules can render alternative sign-in widgets on the `auth.login:form` spot, mirrored into the standalone app template (supersedes #8237). (#8370) *(@lbajsarowicz, via @pkarw)*
- 🐛 Recover communication channel polling after an expired access token by forcing a refresh instead of immediately marking the channel `requires_reauth` on a 401 when the refresh grant is still usable (supersedes #6433). (#8372) *(@KamilMichalski0, via @pkarw)*
- 🔄 Clear only the reindexed scope in a fulltext reindex, so reindexing one entity type or organization on Meilisearch no longer drops every other entity type or organization from the tenant index (#8395). (#8396) *(@AHKSammich)*
- 💰 Keep a used-up static promotion code inactive when undoing `promotions.code.update`, instead of restoring its pre-update `active` flag and re-enabling a spent code (#8398). (#8399) *(@AHKSammich)*
- 📦 Regenerate `yarn.lock` so the nodemailer ranges of the SES and SMTP workspaces match their manifests, fixing immutable installs that failed on `main`. (#8428) *(@pkarw)*
- 🐛 Deprecate the unrendered `SearchResultPresenter.badge` and `VectorResultPresenter.badge` fields, still accepted and stored, with migration guidance for search module authors and removal no earlier than 0.11 (#5716) (supersedes #5731). (#8433) *(@adeptofvoltron, via @pkarw)*
- 🌍 Make the translation checkers follow the locales each application actually serves, so adding a language is checked and dropping one no longer creates unwanted placeholder files (supersedes #6114). (#8437) *(@SiphoChris, via @pkarw)*
- 🐛 Look up the inline option schema template through the forked entity manager when updating product fields together with an option schema, keeping it off the manager holding pending product edits (supersedes #6533). (#8438) *(@rengare, via @pkarw)*
- 🐛 Keep organization branding scoped to the selected organization, clearing pending edits on scope switch, ignoring late reads and uploads from the previous scope, and showing a single-organization prompt for All organizations (#6802) (supersedes #6814). (#8439) *(@haxiorz, via @pkarw)*
- 🔧 Add an opt-in `setup.onOrganizationCreated` hook so new organizations get their schedules and defaults, and have standalone CLI workers load the bootstrap registration runner so webhook handlers are registered (#7980, #7982). (#8440) *(@pkarw)*
- 🔐 Reject API-key creation for an organization that differs from the creator's account organization before issuing a key or secret, showing a localized Organization field error (#6809) (supersedes #6816). (#8442) *(@haxiorz, via @pkarw)*
- 🐛 Bind the staff project access acknowledgement to the request scope, keeping it during matching hydration and resetting it with stale actions hidden when tenant, organization or project changes (#6776) (supersedes #6821). (#8448) *(@haxiorz, via @pkarw)*
- 🌍 Localize the date range picker to the app locale (month names, week start, labels) and keep its calendar and Cancel/Apply reachable on narrow screens instead of overflowing the viewport (#6852) (supersedes #6882). (#8464) *(@adeptofvoltron, via @pkarw)*
- 🔐 Let admins choose the organization for a new portal user in the Create Customer User dialog, validating the target, permission, roles and company ownership within the caller's tenant and allowed scope (#5576) (supersedes #6922). (#8470) *(@adeptofvoltron, via @pkarw)*
- 🐛 Keep the customers task dialog open when Escape is pressed inside a nested Status list or date picker, so the first Escape closes the popup and the draft is no longer discarded (#8456). (#8477) *(@pkarw)*
- 🐛 Skip WMS vendor label enrichment when the optional `customers` module is absent, instead of throwing on `E.customers.customer_entity` (#8478). (#8480) *(@adeptofvoltron)*
- 📦 Expose root entry types for the AI assistant package by adding a `types` condition pointing at `src/index.ts`, so standalone apps loading `@open-mercato/channel-discord` can resolve its types (#8211). (#8483) *(@pkarw)*
- 🔧 Deduplicate shared-worker shutdown listeners so closing a lazy queue worker mapped to more than ten queues no longer emits `MaxListenersExceededWarning` (#8411). (#8484) *(@pkarw)*
- 🌍 Refine the Spanish Discord interaction error replies with consistent past-tense wording and clearer phrasing (supersedes #6898). (#8487) *(@etor6233, via @pkarw)*
- 🔄 Make skipped fulltext indexing visible by logging a warning and a status-log row, once per tenant, job type and reason per worker, when no search strategy is registered (supersedes #5720). (#8492) *(@Geeknauts-company, via @pkarw)*
- 🐛 Hide the internal todo source identifier in the Customer tasks dashboard widget, showing only title, customer and date while keeping external task links working (#6946) (supersedes #6960). (#8495) *(@adeptofvoltron, via @pkarw)*
- 🐛 Resolve tenant-defined claim reason codes to their dictionary labels in the customer portal claim tracker, falling back to the raw code when unknown or unavailable (#6944) (supersedes #6961). (#8501) *(@adeptofvoltron, via @pkarw)*
- 💰 Enable server-side sorting for sales orders and quotes by document number, item count, totals and date, resetting pagination on sort change and carrying the sort into exports (supersedes #6962). (#8506) *(@adeptofvoltron, via @pkarw)*
- 🐛 Show navigation count badges on main sidebar group parent and child links, including compact sidebar corner chips (#6972) (supersedes #6983). (#8508) *(@adeptofvoltron, via @pkarw)*
- 🐛 Contain long Messages subjects and bodies on narrow screens by scrolling the inbox table and wrapping long tokens in detail subjects and both body renderers (#8296). (#8514) *(@pkarw)*
- 🐛 Keep code block language and delete controls in a row above editable code that wraps within narrow Markdown editors (#7471) (supersedes #7476). (#8515) *(@haxiorz, via @pkarw)*
- 🌍 Show a translated "Unknown date" label for customer activities without an occurrence date instead of their creation time, ordering dated rows before undated ones (#8286). (#8516) *(@pkarw)*
- 🐛 Show the translated action-button label instead of the internal action id in the notification bell panel's completed caption after Undo (supersedes #7606). (#8517) *(@adeptofvoltron, via @pkarw)*
- 🌍 Keep reloaded `CrudForm` number fields locale-aware, showing `1,5` in Polish and `1.5` in English while preserving the stored value on unchanged resubmission (#7387) (supersedes #7569). (#8529) *(@adeptofvoltron, via @pkarw)*
- 🐛 Collapse dense overlapping events in the CRM calendar Week/Day grid into a "+N more" block whose popover lists every hidden meeting with its full title (#7500). (#8530) *(@zielivia)*
- 🐛 Seal the sticky `CrudForm` dialog footer to the dialog edge so the scrolled form no longer shows through a 24px gap beneath it (#7497). (#8533) *(@zielivia)*
- 🐛 Keep the Link deals modal footer inside the zero-padding dialog instead of overflowing 24px past both edges (#7495). (#8534) *(@zielivia)*
- 🐛 Render `ConfirmDialog` with the design-system status-modal chrome, including a leading status badge, proper title size and separated actions. (#8535) *(@zielivia)*
- 🐛 Align person and company activity tabs with the deal layout, giving them the same inline composer, planned activities and filterable timeline instead of the legacy activities card (#7494, #9619). (#8536) *(@zielivia)*
- 🐛 Turn the linked people search-and-sort toggle into a labelled disclosure with an expanded state, and lay linked people out as a sortable table that fits its card (#7493). (#8539) *(@zielivia)*
- 🐛 Tidy the person detail header into a name, PRIMARY badge and facts row like the deal header, and fold extra tabs into a More menu. (#8540) *(@zielivia)*
- 🐛 Show role overlap in the assign-role dialog as an informational "Already assigned" note instead of an error-styled "Conflict" badge, since assigning a second role is allowed (#7491). (#8541) *(@zielivia)*
- 🐛 Render dictionary values as plain quiet pills with color only on statuses, instead of an icon box, label and color swatch that looked like a status. (#8542) *(@zielivia)*
- 🐛 Mount pending work and related documents as CRM detail tabs on person, company and deal pages instead of detached cards stacked under the layout (#7488). (#8544) *(@zielivia)*
- 🐛 Fold overflowing CRM company and deal detail tabs into a More menu, removing the horizontal scrollbar that clipped the last tab (#7487). (#8545) *(@zielivia)*
- 🐛 Equalize KPI tile heights on the company detail page so tiles with a trend caption no longer stand taller and their bottom borders line up (#7485). (#8546) *(@zielivia)*
- 🐛 Close `LookupSelect` after a pick and show a selection summary, instead of leaving the list open with the typed query and a thin border as the only sign of selection (#6196). (#8547) *(@zielivia)*
- 💰 Let the document's "Send to" e-mail take precedence over the customer record's e-mail when sending a quote, instead of ignoring it whenever the customer has any address (#8459). (#8548) *(@zielivia)*
- 🐛 Hide the empty order lines card on the quote create form, where the line editor renders nothing for quotes. (#8550) *(@zielivia)*
- 🐛 Make adding an additional address on a sales document a single obvious path: with no saved addresses the form opens on the address fields, otherwise a "Saved address / New address" switch is offered, and the submit reads "Save address" (#6194). (#8551) *(@zielivia)*
- 🐛 Restore the Markdown editor toolbar dropdowns and popovers inside dialogs, so selecting a heading keeps the composer open, Escape closes the dropdown before the dialog, and page interaction returns once the dialog closes (supersedes #7479). (#8556) *(@haxiorz, via @pkarw)*
- 🔄 Prevent `query_index` coverage-pruning initialization deadlocks by making concurrent global coverage refreshes and counter writes take the scope advisory lock before touching NULL-tenant coverage rows (#8348, #8559). (#8561) *(@pkarw)*
- 🔧 Stop the telemetry pg instrumentation probe from hanging when a failed connection closes before its query is submitted, by ending the failed client first so the query rejects deterministically (#8526). (#8563) *(@pkarw)*
- 🐛 Keep collapsed sidebar groups across the asynchronous backend-navigation bootstrap, by waiting until saved groups can be restored before writing sidebar preferences (#3514) (supersedes #7654). (#8566) *(@haxiorz, via @pkarw)*
- 🌍 Translate the CRM schedule duration options in English, Polish, German, Spanish and Korean, and shorten the title when duplicating a long deal from the list or Kanban so it fits the 200-character limit (#7797, #8048). (#8569) *(@pkarw)*
- 🐛 Reset Kanban pagination when sort, filters, pipeline or organization change, stop stale requests from appending old cards, keep the currency filter on load-more, and fit long filter values on narrow screens (#7859) (supersedes #7932). (#8570) *(@haxiorz, via @pkarw)*
- 🖼️ Transfer product and variant draft media in sequential batches of at most 100 attachment IDs, warning when a batch fails or is only partly acknowledged while still keeping the created record (supersedes #7728). (#8571) *(@pgaluszk, via @pkarw)*
- 🐛 Separate the example login-provider probe status sentences so the claim and confirmation no longer render joined as `domain.Probe`, in both the app widget and the create-app template (#8523). (#8573) *(@pkarw)*
- 🐛 Restore Markdown code-block gutter alignment under a production CSP by passing the document nonce to CodeMirror for fenced code blocks and source/diff editors (#8520). (#8577) *(@pkarw)*
- 🌍 Translate the attachments "load more" button label into Spanish ("Cargar más") (supersedes #6900). (#8587) *(@etor6233, via @pkarw)*
- 🌍 Translate the Debug log level in the business-rule action editor into Spanish ("Depuración") while keeping the persisted level `debug` (supersedes #6902). (#8591) *(@etor6233, via @pkarw)*
- 🐛 Keep the global legal footer links clear of the fixed demo feedback button on phone-width screens by reserving the same bottom safe area as page content (#8596). (#8600) *(@pkarw)*
- 💰 Accept decimal commas in promotion budgets, discount values and rule thresholds, and preserve the stored UTC calendar date so an end date no longer shows or reopens a day late in Poland (#7705, #7711). (#8611) *(@pkarw)*
- 🔧 Make `yarn setup` verify PostgreSQL, Redis and Meilisearch access before database work, let it skip AI configuration, and ask before reusing existing infrastructure, leaving accepted containers untouched. (#8612) *(@pkarw)*
- 🔄 Forward `AWS_SESSION_TOKEN` to the Bedrock embedding client so embeddings work with temporary AWS credentials such as SSO, assumed roles and STS instead of being rejected as an invalid security token. (#8618) *(@pcbeingused333)*
- 📦 Fix the setup errors and warnings found by testing every README install path in fresh microVMs, including `--preset wms` failing at `db:migrate` with a missing `message_channel_links` relation. (#8624) *(@pkarw)*
- 📦 Scope CommonJS harness fixtures locally so the create-app harness runs on Node 24 on macOS without failing with `ERR_INVALID_PACKAGE_CONFIG` on extensionless fake executables (#8625). (#8654) *(@pkarw)*
- 🔄 Preserve `agent_orchestrator` reconnect catch-up through execution events, so task lists recover executions whose broadcast was missed while the event bridge was disconnected (#8583). (#8656) *(@haxiorz)*
- 🐛 Keep credential saves pending through the authoritative reload to prevent lost edits and duplicate submissions, constrain long progress titles on mobile, distinguish failed or cancelled operations from completed ones, and translate integration state labels. (#8657) *(@pkarw)*
- 🔐 Return a translated validation error beside the name field when creating a role whose name already exists in the tenant instead of a generic 500, and correct the business-rule Rule ID placeholder to `ORDER_APPROVAL_CHECK` (#7364, #7787). (#8659) *(@pkarw)*
- 🐛 Prevent a notification card from being activated, marking it read or navigating, while one of its actions is still pending, including a second click or Enter/Space after a double-click (#8604). (#8666) *(@haxiorz)*
- 🌍 Treat only ISO 639-1 language-code files as app dictionaries in the translation checkers, so files like `faq.json` or `app.json` are no longer reported as missing locales or filled with placeholders by `--fix` (#8436). (#8668) *(@kmrosiek)*
- 🐛 Resync the `PhoneNumberField` input to the parent-normalised value on blur, so what the user sees matches what the form holds when a parent rewrites the number such as collapsing a `00<dialcode>` prefix (#8648). (#8681) *(@adeptofvoltron)*
- 🐛 Bump the optimistic-lock version on tag-only edits of companies and people and custom-field-only edits of people, so a stale second tab can no longer silently overwrite them (#8643). (#8682) *(@adeptofvoltron)*
- 🐛 Keep the `CrudForm` submit lock held through a success redirect, so a second click, Enter or Cmd+Enter while navigating no longer creates a duplicate record (#8645). (#8683) *(@adeptofvoltron)*
- 🐛 Limit `FlashMessages` URL flash reading to the primary host, so a non-primary host can no longer consume `?flash=` and `type` parameters and cause the message to never show after a redirect (#8471). (#8685) *(@adeptofvoltron)*
- 🐛 Fill available OCR worker slots before counting pending jobs against the wait-queue limit, and stop edit forms from showing the "record changed by another user" dialog for unique-key and foreign-key constraint errors (#7074, #7104). (#8690) *(@pkarw)*
- 🔄 Preserve the caller PostgreSQL transaction in `buildIndexDoc` when optional translation tables, columns or permissions are unavailable, recording the failure in indexer diagnostics and telemetry (#8637) (supersedes #8684). (#8697) *(@adeptofvoltron, via @pkarw)*
- 🔄 Select only the scope columns a table actually has in the search subscriber scope lookup, add probe-error telemetry, and localize Search settings hints with responsive layout and confirmation fixes. (#8698) *(@pkarw)*
- 🔧 Stop the data engine from issuing `ON CONFLICT` against `custom_entities_storage`, which logged a PostgreSQL error several times during tenant setup on fresh installs. (#8699) *(@pkarw)*
- 🐛 Associate `CrudForm` field labels with their controls through stable ids so screen readers announce field names and clicking a label focuses its control, in both backend and portal forms (#5360). (#8705) *(@adeptofvoltron)*
- 🐛 Stop the WMS ASNs, Lots and Putaway queue list tables from flashing the loading state every time the browser window regains focus. (#8706) *(@kmrosiek)*
- 🔄 Keep concurrent `communication_channels` polls from regressing the channel cursor, so an older job no longer overwrites a newer one and re-fetches consumed pages or starts duplicate drain chains (#8710). (#8711) *(@AHKSammich)*
- 🐛 Stop "Save as new" from overwriting an existing personal perspective view of the same name, returning a translated duplicate error and keeping the form open for correction (#8630) (supersedes #8631). (#8721) *(@AHKSammich, via @pkarw)*
- 🔄 Renew the skipped fulltext indexing warning and status diagnostic when a later skipped job arrives at least five minutes after the previous one, so an ongoing configuration issue becomes visible again (#8493). (#8722) *(@pkarw)*
- 🔐 Return HTTP 400 with a localized Name field validation when renaming a role to a name already used in its tenant, rolling back the transaction instead of failing generically (#8707). (#8723) *(@pkarw)*
- 🔐 Offer the last-operation Undo only to users with the effective `audit_logs.undo_self` permission, and make staff logout return 303 See Other so a native POST lands on the login page without resubmitting on reload (#7371, #7383). (#8749) *(@pkarw)*
- 🐛 Restore only the recipient row when undoing a recipient-only message deletion, preserving a later sender deletion for everyone, and make concurrent deletions claim the row atomically so each undo reverses its own operation (#8057, #8059) (supersedes #8058). (#8750) *(@AHKSammich, via @pkarw)*
- 🐛 Show the tenant-defined rejection reason label instead of its raw code for rejected warranty claims in the customer portal, falling back to the code if the lookup fails (#8502). (#8753) *(@pkarw)*
- 💰 Locale-parse company annual revenue so decimal-comma locales no longer have it multiplied by 100 on create or in the inline editor, and wrap long company display names (#8642). (#8764) *(@adeptofvoltron)*
- 🐛 Return the localized HTTP 409 duplicate-key response instead of 500 when creating or renaming a dictionary onto a deleted or archived dictionary key, and localize the dialog feedback (#7904) (supersedes #7905). (#8781) *(@AHKSammich, via @pkarw)*
- 🌍 Collapse empty backend banner, table-header and frontend-footer slot wrappers while keeping injection targets available, and add five-locale catalog SEO helper copy (#8394, #8794) (supersedes #8412). (#8795) *(@Hejnas, via @pkarw)*
- 🐛 Fix the duplicate `getTelemetryRuntime` import that broke the main build of the warranty claim detail page, and support `ci-full` on same-repository PRs for full stabilization runs. (#8806)
- 🔄 Make saved, edited, disabled and deleted workflow triggers take effect in already-running app and worker processes by no longer caching the trigger list per-process (#7401). (#8807) *(@haxiorz)*
- 🐛 Enforce the `DOCUMENTS_MAX_FOLDERS_PER_ORGANIZATION` folder cap when undoing a folder delete, so users can no longer exceed the limit through a delete, create, undo cycle (#8813). (#8814) *(@AHKSammich)*
- 🌍 Translate the WMS ASN, receiving and putaway screens into Polish, German, Spanish and Korean, and use translated messages for empty-field and nonpositive-quantity validation (#8691) (supersedes #8704). (#8823) *(@kmrosiek)*
- 🐛 Offer no undo when linking an already-linked company to a person, and keep the relationship and prior primary state when undoing a primary company change (#7857) (supersedes #7908). (#8827) *(@Sarthak-madan334, via @pkarw)*
- 🌍 Localize Search settings fulltext environment hints and embedding-provider diagnostics per request in English, Polish, German, Spanish and Korean (#8826). (#8833) *(@pkarw)*
- 🔧 Clean up orphaned dev sessions after Ctrl+C by escalating on surviving descendant processes, and offer interactive recovery for verified orphaned sessions. (#8837) *(@pkarw)*
- 🐛 Stop offering "Share & notify" on document comments for mentioned recipients whose role denies Documents view access, and tell the commenter after saving when a recipient cannot be notified (#8207). (#8847) *(@haxiorz)*
- 🐛 Initialize `updated_at` on new customer roles so their first concurrent edit returns the structured 409 conflict instead of silently winning the race (#8846). (#8849) *(@adeptofvoltron)*
- 🐛 Show completed notification actions in a neutral status badge beside the card title, replacing the small italic footer, so readers see a pending notification was already handled (#7558). (#8853) *(@pkarw)*
- 🐛 Preserve concurrent Gmail push state in `communication_channels` by committing history sync, push registration and teardown from a fresh row under a pessimistic write lock, so a stale page can no longer overwrite an advanced cursor or launch a duplicate drain (#8712). (#8890) *(@pkarw)*
- 🐛 Align the `mercato init` credentials panel across terminal widths by replacing the drifting boxed layout with a wrapping horizontal panel that keeps emojis and long values readable. (#8894) *(@pkarw)*
- 🔐 Let a parent-scoped administrator undo and redo an authorized child-organization action in `audit_logs` while the parent stays selected, by checking the descendant-expanded scope instead of a single selected organization (#7370). (#8907) *(@haxiorz)*
- 🐛 Strip NUL characters from text extracted from uploaded PDFs and text files, which previously failed the upload with a 500 `Failed to save attachment attributes` and saved neither the row nor the file (#8105). (#8911) *(@pgaluszk)*
- 🐛 Fix cramped or overlapping emoji icons in setup and dev logs on terminals that give text-default emoji one column, and keep the initialization credentials visible. (#8927) *(@pkarw)*
- 🐛 Offer to clean up a conflicting dev session and continue in `yarn dev`, `yarn dev:greenfield` and `yarn setup`, instead of stopping hard with "Another Open Mercato dev session already owns this workspace". (#8929) *(@pkarw)*
- 💰 Load the product when `PUT /api/catalog/prices` updates a price without `productId`, which previously answered 403 `Forbidden` (or `Cross-tenant relation forbidden` with `offerId`) for every role including superadmin (#8103). (#8939) *(@pgaluszk)*
- 🐛 Show an expired Gmail push watch as expired in My communication channels instead of "Push active", and expose "Re-register push" so users can recover a dead subscription (#8943). (#8944) *(@WojciechSoczynskiTHEY)*
- 🔄 Stop gating full-text indexing on the vector auto-indexing switch, so the default `OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING=true` no longer silently skips queueing full-text jobs (#8935). (#8945) *(@pcbeingused333)*
- 🔧 Claim the redo source log atomically for every command handler, so concurrent redos of one undone action run once instead of each re-running it and writing duplicate action logs (#8947). (#8948) *(@AHKSammich)*
- 🔄 Clear mapped custom fields in `sync_akeneo` once a value is removed in Akeneo, and stop product and variant writes sharing one EntityManager concurrently, so cleared PIM values no longer linger locally (#8951). (#8952) *(@AHKSammich)*
- 🐛 Contain Form Studio locale controls and toolbar actions within narrow panels, let warranty stage markers scroll beneath sticky breadcrumbs, and fix a stale metadata autosave status (#8934, #8937). (#8983)
- 🐛 Preserve server refusal messages for quote Send and Convert in sales, and stop enterprise record locking from opening a false concurrent-edit dialog on ordinary business-rule 409 responses (#8966, #8967). (#8986)
- 🐛 Claim outbound webhook deliveries atomically before sending, so a job that runs twice no longer sends duplicates, under-counts `attemptNumber` or rewrites a delivered or in-flight record (#9002). (#9003) *(@AHKSammich)*
- 🐛 Restore the Delete control on the customer role detail form for persisted, non-default roles, which `CrudForm` had treated as new records (#9009). (#9024) *(@adeptofvoltron)*
- 🌍 Localize the role rename and tenant-move rejection messages in `auth.roles.update`, which were still hard-coded English 400 errors (#8980). (#9025) *(@adeptofvoltron)*
- 🐛 Preserve promotion-code exhaustion when redoing an edit, and keep tax-rate edit versions correct so undo and redo no longer reactivate exhausted codes (#8861, #8863). (#9032)
- 🐛 Unify customer role assignment and reassignment into one dialog that keeps the role fixed, preselects its current holder and saves explicitly (#7490) (supersedes #8543). (#9034) *(@zielivia)*
- 🔧 Refuse undoing a `communication_channels` conversation reassignment that a newer reassignment superseded, so the first operator can no longer silently replace the current owner (#9042). (#9043) *(@AHKSammich)*
- 🌍 Translate resource capacity validation errors for fractional, zero, negative and non-numeric values, which showed default English Zod messages even on Polish installs (#8858). (#9046) *(@oskarwoj)*
- 🐛 Keep the staff timesheet period selector within a 375px viewport by letting its label shrink and truncate, so the page no longer scrolls sideways on phones (#8769). (#9048) *(@oskarwoj)*
- 🐛 Sort sibling catalog categories by name, fixing a comparison against the sibling's id that left `childIds` and the category tree order effectively arbitrary (#9001). (#9049) *(@oskarwoj)*
- 🔧 Release watched generator state between edits in long-lived standalone dev sessions, reducing retained memory after structural edits without disabling modules, workers or metadata. (#9052) *(@andrzejewsky)*
- 🌍 Translate the injected Catalog SEO helper sentence for Polish, German and Spanish by defining its key in the example module locale files instead of only the app-level overlay (#8793). (#9061) *(@adeptofvoltron)*
- 🌍 Localize the resource availability section heading on the resource detail page, which showed the English "Availability" fallback in Polish and every other non-English locale (#8835). (#9063) *(@adeptofvoltron)*
- 🐛 Keep the translated "No results" message visible, with a screen-reader status, when a topbar search finds nothing, and contain phone calendar event peeks within the viewport (#9075). (#9103)
- 🔧 Coalesce concurrent first-request ORM initialization so it no longer builds duplicate ORM instances, entity metadata and connection pools. (#9123) *(@andrzejewsky)*
- 🌍 Translate `messages.priority.*` values in every supported locale so `PriorityBadge` tooltips and aria-labels no longer fall back to hard-coded English (#8800). (#9166) *(@adeptofvoltron)*
- 🐛 Stop treating an InPost parcel complaint (`claimed`) as a cancelled shipment, so it no longer freezes the shipment as `cancelled`, emits a cancelled event or refuses a later `returned_to_sender` (#9173). (#9174) *(@AHKSammich)*
- 🐛 Return 400 for invalid planner availability windows before replacing existing hours, so equal, inverted, out-of-range, impossible-date and collapsed DST windows no longer wipe saved hours (#9171) (supersedes #9172). (#9175) *(@AHKSammich)*
- 🐛 Return a translated 400 instead of a 500 from `GET /api/notifications` for invalid filters such as an unknown `status`, non-numeric `page` or `pageSize` over 100 (#9221). (#9222) *(@AHKSammich)*
- 🌍 Answer generic `makeCrudRoute` errors (validation 400, database-unavailable 503, foreign-key 409, fallback 500) in the request's language instead of always English (#9223). (#9224) *(@AHKSammich)*
- 🐛 Keep warranty claim tenant setup, SLA escalation and portal attachments working when `dictionaries`, `notifications` or `attachments` is disabled, instead of aborting setup, never escalating or returning 500 (#9214). (#9254) *(@AHKSammich)*
- 🐛 Keep non-ASCII characters in attachment display names, so `Karta techniczna źródło.pdf` is no longer shown as `Karta_techniczna_r_d_o.pdf` in lists, previews and downloads (#8727). (#9257) *(@oskarwoj)*
- 💰 Keep the shipping and payment method on a sales order or quote when only its code or snapshot is updated, which previously cleared the method id and dropped provider-priced shipping from totals (#9284). (#9285) *(@AHKSammich)*
- 🐛 Make `eq` and `ne` custom field rules work on integer and float fields by comparing numeric values with the text the field editor saves, instead of rejecting every value or never rejecting (#9291). (#9292) *(@AHKSammich)*
- 🐛 Fail the workflow instance when a step fails outside the main executor loop, instead of leaving the run `RUNNING` or `PAUSED` without an error message, `WORKFLOW_FAILED` event or compensation (#8791). (#9293) *(@kurrak)*
- 🐛 Preserve rapid edits in the shared address form and reject stale address writes in customer and staff records, instead of overwriting earlier changes (#8080). (#9315) *(@adeptofvoltron)*
- 💰 Compute tax on the discounted price for percentage cart and order promotions, so `taxTotalAmount` no longer stays at full price and `net + tax` matches `gross` (#8425). (#9316) *(@adeptofvoltron)*
- 🐛 Allow a warranty claim line update to resubmit its own unchanged line number when a legacy duplicate row shares it, while still rejecting a changed number that collides (#8155). (#9318) *(@adeptofvoltron)*
- 🐛 Keep route manifest registries on `globalThis` so `CALL_OPEN_MERCATO` business-rule actions no longer fail with "requires a currently available /api/* endpoint" after a backend page renders (supersedes #7196). (#9319) *(@zawstudio, via @haxiorz)*
- 🐛 Resolve code-defined workflow definitions on sub-workflow resume and milestones, which previously got `null` for runs with no `workflow_definitions` row (#9298). (#9324) *(@pgaluszk)*
- 🐛 Keep `/api/translations/locales` working on installs without the `configs` module, instead of answering 500 from both GET and PUT (#9213). (#9325) *(@pgaluszk)*
- 🔄 Keep full-text and vector reindex and cancel endpoints working when the `progress` module is disabled, instead of answering HTTP 500 (#9208). (#9327) *(@pgaluszk)*
- 🐛 Skip EUDR lifecycle notifications when the `notifications` module is disabled, instead of failing and dead-lettering background jobs on statement and risk events (#9198). (#9351) *(@pgaluszk)*
- 🐛 Skip the `inbox_ops` proposal notification when the `notifications` module is disabled, instead of dead-lettering the `proposal-notifier` subscriber for every processed email (#9200). (#9352) *(@pgaluszk)*
- 🐛 Move the person portal account status into its own tab placed after built-in tabs, keeping the person form at full width (#7499) (supersedes #8532). (#9358) *(@zielivia, via @pkarw)*
- 🐛 Stop `GET /api/ai_assistant/ai/conversations` pagination from skipping conversations, returning a `nextPageToken` cursor so empty and same-`lastMessageAt` conversations are no longer lost (#9373). (#9374) *(@AHKSammich)*
- 🐛 Reject mutations of non-active WMS reservations, such as `POST /api/wms/inventory/release` returning `409 invalid_reservation_state`, instead of silently altering inventory balances (#5418) (supersedes #5419). (#9385, #10140) *(@Paul-Mlodochowki, via @haxiorz)*
- 🐛 Guard workflow user task completion with a compare-and-set, so concurrent submissions have one winner and no longer duplicate the completion event or advance the run twice (#9286) (supersedes #9287). (#9393) *(@AHKSammich)*
- 🐛 Display API-key expiry dates picked in the create form as the selected calendar day across time zones, and translate load failures (#8968) (supersedes #9255). (#9394) *(@oskarwoj)*
- 🐛 Add an `id` tiebreaker to the admin payment transactions list, so paging no longer repeats or skips rows that share a `createdAt` timestamp (#9399). (#9400) *(@AHKSammich)*
- 🐛 Preserve a still-visible URL-sourced flash toast when the primary `FlashMessages` host unmounts, instead of letting it silently vanish (#8701). (#9402) *(@adeptofvoltron)*
- 🐛 Downgrade the benign client-initiated streamed-response cancellation to a warning, so the dev-runtime diagnostics banner no longer reports it as a persistent error (#8409). (#9406) *(@adeptofvoltron)*
- 🐛 Stop the warranty claims portal order picker from repeating or skipping orders that share a `placed_at` timestamp, by adding a stable tiebreaker to paging (#9407). (#9408) *(@AHKSammich)*
- 🐛 Return a 400 validation error instead of a 500 when a WMS putaway, ASN or reservation action receives a malformed non-UUID id (#9413). (#9414) *(@AHKSammich)*
- 🐛 Clear the old project's task when a time entry moves to another project through a PUT naming only `timeProjectId`, so hours are no longer billed to one project and rolled up on another's task (#9415). (#9416) *(@AHKSammich)*
- 🐛 Make parallel workflow branches stop or follow their configured error route when a destination step fails after asynchronous activities finish, cancelling sibling work for unhandled failures (#9297) (supersedes #9300). (#9440) *(@pcbeingused333)*
- 🔧 Restore main compilation by removing the duplicate `id` declaration in `ComboboxInput` while keeping ID and ARIA forwarding, and stabilize the Deals footer integration test that raced a router navigation. (#9455)
- 🐛 Show the assigned colleague's name or email in the closed Channel info selector on channel-message detail, including when that colleague is outside the first 50 picker options (supersedes #9422). (#9467) *(@kmrosiek)*
- 🐛 Compare real paths when detecting whether a repository CLI is the entry point, so the Stryker scripts and enterprise contribution guard no longer silently exit 0 on Windows or in checkout paths containing spaces or symlinks (supersedes #6911). (#9478) *(@SiphoChris, via @haxiorz)*
- 🐛 Let tenant initialization (`yarn initialize`, `mercato init`, onboarding and `mercato planner seed-unavailability-reasons`) finish when `planner` is enabled but `dictionaries` is disabled, instead of failing with missing `Dictionary` metadata (#9202). (#9479) *(@AHKSammich)*
- 🐛 Clear the stale `product_unavailable` flag when a product becomes visible again and the buyer updates or re-adds the line, so the line counts in cart totals and promotions and the cart stops warning it is unavailable (#9493). (#9494) *(@AHKSammich)*
- 🔄 Embed vector search queries with the Cohere `search_query` input type instead of `search_document`, improving retrieval quality for Cohere v3+ embedding models. (#9505) *(@pcbeingused333)*
- 🔧 Restore the `ComboboxInput` `id` prop so `main` compiles again after the `prepare` job failed with `Cannot find name 'id'` and type errors in `CrudForm`. (#9511) *(@haxiorz)*
- 🐛 Require a database error signal before `isUniqueViolation` reports a unique violation, so non-DB errors that merely mention "unique constraint" fail as 500 instead of a false 409, and inspect nested causes (#9510). (#9519) *(@oskarwoj)*
- 🐛 Compare a time entry update's `taskId` with the resolved project row so a valid task sent with an upper-case project id is accepted on update as on create, and an unchanged project no longer counts as changed (#9474). (#9520) *(@oskarwoj)*
- 🐛 Keep webhooks working when the `integrations` module is disabled, so outbound dispatch no longer fails with `Metadata for entity IntegrationState not found` and retries forever (#7444, #9215). (#9532) *(@pgaluszk)*
- 🐛 Let promotions evaluate when the `catalog` module is disabled, so `promotionsService.evaluate()`, `POST /api/promotions/evaluate` and `POST /api/promotions/free-products` no longer fail on a missing category assignments relation (#9204). (#9533) *(@pgaluszk)*
- 🐛 Answer 503 instead of 500 from the customer-portal support-ticket attachment routes when the `attachments` module is disabled (#9383). (#9534) *(@pgaluszk)*
- 🐛 Keep catalog price and tax class writes working when the `sales` module is disabled, so `catalog.prices.create`/`update` and tax-class-dependent pricing no longer fail with a 500 (#9190). (#9544) *(@AHKSammich)*
- 🐛 Keep the Kanban pipeline filter popover usable on short viewports by capping its height to the available space and scrolling only its body, so Apply stays reachable. (#9558)
- 🐛 Preserve later edits when undoing EUDR updates by locking and comparing the recorded state, returning `409 eudr.errors.undoConflict` for a stale undo and recomputing completeness when undoing evidence submissions (#9128) (supersedes #9129). (#9562) *(@AHKSammich)*
- 🐛 Refuse form undos (rename, archive, restore, distribution update or close, draft edit, version archive) with 409 when a restored field changed since the action, instead of overwriting a newer change (#9563). (#9564) *(@AHKSammich)*
- 🐛 Preserve equals signs inside CLI option values by sharing one `parseModuleCliOptions` helper across 27 module CLIs, so values with embedded or trailing equals signs and explicit empty values are no longer truncated (#9539). (#9570) *(@wojski999)*
- 🐛 Skip the optional channel-label lookup in product offer enrichment when the `sales` module is disabled, so offers and pricing remain available instead of failing on missing `SalesChannel` metadata (#9545). (#9571) *(@wojski999)*
- 🌍 Detect untranslated error literals returned through a local `json()` response helper in the advisory i18n hardcoded-string scanner (#9240). (#9572) *(@wojski999)*
- 🐛 Clear the dependent task when a time entry's project is cleared and reject incompatible task/project combinations, so task rollups no longer attribute project-less hours to the old task (#9472). (#9575) *(@wojski999)*
- 🐛 Reject an unparseable WMS inventory CSV quantity such as `"1,000"` or `abc` with `quantity_invalid` instead of treating it as 0, which skipped rows or zeroed on-hand stock in reconcile mode (#9579). (#9580) *(@AHKSammich)*
- 🐛 Validate AI agent mutation input against the tool's `inputSchema` before staging it for approval, so invalid input yields a tool error instead of an approval card that fails after Confirm with `schema_drift` (#9583). (#9584) *(@AHKSammich)*
- 💰 Treat `lineNumber` as a target position on `sales.orders.lines.upsert` and `sales.quotes.lines.upsert`, so reordering document lines through repeated upserts converges instead of silently doing nothing. (#9589) *(@haxiorz)*
- 🐛 Recompute `nextRunAt` when a disabled schedule is re-enabled, so the local scheduler no longer runs the job immediately on a stale past time (#9591). (#9592) *(@AHKSammich)*
- 🐛 Log and report gateway payment outcomes that fail to update the checkout transaction, such as a capture on an expired transaction or a DB error, instead of silently swallowing them (#9596). (#9597) *(@AHKSammich)*
- 🐛 Add `id` as a sort tiebreaker to the webhook delivery log so deliveries created in the same millisecond no longer appear twice or go missing across pages (#9606). (#9607) *(@AHKSammich)*
- 🐛 Allow `forms` to be generated without `customer_accounts` or `attachments`, and answer a translated 503 for theme-logo uploads when attachment storage is unavailable (#9199). (#9636) *(@wojski999)*
- 🐛 Keep proposed fields that are missing from the before-snapshot in fallback AI mutation previews, showing them with an undefined before value for single-record and batch patches (#7442). (#9637) *(@wojski999)*
- 🐛 Exclude price creations that were later undone from Omnibus lowest reference prices, for both the baseline and the selected window (#6419). (#9644)
- 📦 Stop new standalone apps from installing `@open-mercato/channel-discord` while its module registration is disabled, with the commented registration telling users to install the package before enabling it (#4983). (#9645)
- 🐛 Deliver the `pushOptions.image` option to iOS devices through the APNs adapter, so visible pushes carry the image instead of a plain alert while reporting `sent` (#9649). (#9650) *(@AHKSammich)*
- 🐛 Add `id` as a sort tiebreaker to `GET /api/progress/jobs` so jobs sharing a sort timestamp no longer appear on two pages while another never shows (#9652). (#9653) *(@AHKSammich)*
- 🐛 Quote InPost `locker_standard` and `courier_c2c` rates with the same template parcel `createShipment` buys, so the quote matches the parcel actually purchased (#9658). (#9659) *(@AHKSammich)*
- 🐛 Preserve offers created or edited independently after a catalog product update when that update is undone, and contain the Metadata header actions on mobile (#7679) (supersedes #7680). (#9662) *(@AHKSammich)*
- 🐛 Re-check the optimistic-lock version under the row lock in `DELETE /api/sales/invoices`, answering 409 for a stale delete and 404 for a missing invoice instead of a 500. (#9663) *(@mikolajbogusz-they)*
- 🐛 Keep catalog settings, Omnibus config and `mercato catalog omnibus:backfill` working when the `configs` module is disabled, instead of returning 500 or crashing with an `AwilixResolutionError` (#9609). (#9665) *(@Kamyyylo)*
- 🐛 Drop an entry's stored task in `POST /api/staff/timesheets/time-entries/bulk` when a row moves it to another project without naming a `taskId`, sharing the rule with single-entry updates (#9473). (#9666) *(@Kamyyylo)*
- 🌍 Translate the leave-request "not found" and "already finalized" errors returned by the update, delete, approve and reject commands instead of always answering in English (#9669). (#9670) *(@AHKSammich)*
- 🐛 Stop re-running the catalog price-kind seed from soft-deleting tenant price kinds and resetting `regular` and `sale` to defaults, which also skipped cache invalidation and the action log (#8104). (#9672) *(@pgaluszk)*
- 🔧 Skip the Main Snapshot Release and Enterprise Contribution Guard workflow jobs in forks, which can never pass there and sent failure emails on every fork sync. (#9737) *(@kmrosiek)*
- 🐛 Preserve the Markdown preference and metadata drafts in the product editor, so saving from the title field no longer forces `metadata.__useMarkdown` to false and drafts are no longer lost (#9679). (#9772) *(@adeptofvoltron)*
- 🐛 Stop Sales "Add line" lookups from showing a zero-character minimum hint, and skip the optional failed-webhook notification when `notificationService` is unregistered (#9763, #9764). (#9782, #9947)
- 📦 Restore fresh standalone builds with newer MikroORM releases by deriving the `findOne` query argument type from the installed signature in the shared data engine. (#9789)
- 🐛 Report an IMAP channel send as failed when the SMTP server rejects some recipients, matching the SMTP channel adapter, instead of marking the message sent (#9795). (#9796) *(@AHKSammich)*
- 🐛 Wrap the audit-log action toolbar (Refresh, "Undoable only" and "Undo last action") on phone widths instead of overflowing the card (#9740). (#9897, #9915) *(@patzick)*
- 🐛 Stop long push status tags such as "Push expired — re-register" from being clipped in the Push column of the profile communication channels page (#9802). (#9898, #9917) *(@patzick)*
- 🐛 Reject a resource capacity of 0 on the create and edit pages instead of silently saving it as empty (#9792). (#9899, #9916) *(@patzick)*
- 🐛 Surface Approve and Reject errors on already-decided or deleted leave requests as flash messages instead of an uncaught promise rejection with no feedback (#9791). (#9900, #9924) *(@patzick)*
- 🐛 Refuse `POST /api/webhooks/deliveries/{id}/retry` for a delivery that is still being sent, so a second worker can no longer send the same event while the first request is in flight (#9005). (#9901, #9943) *(@patzick)*
- 🐛 Restore the standard vertical gap between the shipment section and injected tracking cards, including InPost, on the sales order Shipments tab (#9774). (#9918, #9925)
- 🐛 Skip audit entries for order and quote updates that change nothing, so an integration re-sending an unchanged document no longer logs an update naming the whole `Order` (#9719). (#9921, #9930)
- 🐛 Keep the customer create submit locked through navigation so a second click or keyboard submit can no longer create a duplicate company or person, with `successRedirect` accepting a synchronous resolver (#9718). (#9922, #9931)
- 🐛 Keep the timesheet timer bar note editable after Enter, warn when an unsaved draft is dropped, and handle stale windows and slow re-reads without false "changed elsewhere" conflicts (#9079). (#9926) *(@patzick)*
- 🌍 Show address-type dictionary labels on address cards, widen inline address forms, and complete address hint, loading and error translations in all five locales plus Polish staff Cancel/Back labels. (#9932)
- 🐛 Restore in-app security alerts when notification metadata is registered through another bundle, and show the comparison caption on KPI cards independently of the trend badge so My work targets reappear (#9939, #9950). (#9941, #9959)
- 🐛 Stop the Discord AI auto-reply from re-sending or re-proposing a reply when the events worker retries delivery of an inbound message that already has one (#8277). (#9945) *(@haxiorz)*
- 🐛 Keep the week timesheet grid readable at phone width by giving day columns a minimum width, so headers and hour inputs no longer overlap (#9946). (#9949, #9955) *(@patzick)*
- 🔐 Keep the Change password form and show a translated error on a wrong current password, which now returns 400 instead of a 401 that triggered a session refresh and an empty reload (#9940, #9942). (#9952, #9963) *(@patzick)*
- 🐛 Contain the My work Today's entries table on mobile with a horizontal scroll wrapper, so it no longer widens the page beyond a 390 px viewport (#9951). (#9954, #9957)
- 🐛 Reject a date-only catalog price edit whose end date is before its start date (#9960). (#9961, #10126) *(@AHKSammich)*
- 🐛 Show the saved From Currency when opening an exchange-rate edit page with autofocus, including options labeled with the bare currency code such as `USD` (#9965). (#9972, #9979)
- 💰 Let catalog variant prices entered with a decimal comma such as `149,99` save, and show the translated validation error beside the affected price field instead of hiding it (#9967). (#9973, #9980)
- 🌍 Localize Tpay, Stripe and Akeneo credential forms in Polish, translating field labels, options, help text, Stripe webhook instructions, category and hub labels and validation messages (#9966). (#9974, #9977)
- 🐛 Show rejected AI pending actions with the Rejected badge and an informational reason alert instead of a red "Execution failed" alert, hiding the alert when no reason was given (#9989). (#9993, #10028)
- 🐛 Hide rows whose before and after values are both empty in the shared `FieldDiffCard`, so comment edit previews no longer show an empty `dealId` row (#10001). (#10002, #10027)
- 🐛 Accept `description: null` in catalog product create and update validation, so confirming an AI product update with an empty description no longer fails with `Invalid input` (#10003). (#10004, #10026)
- 🌍 Localize sales history field labels and show order and quote totals once, including changes recorded only in the exact-value field, with `lines` reusing the Items label (#10017). (#10024, #10060)
- 📦 Restore fresh standalone app builds with Awilix 13.0.6 and newer by no longer binding `resolve` to its container, which caused TS2769 and lost generic types in search workers. (#10073, #10108)
- 🌍 Return localized 400 and 404 errors for invalid, expired or missing TOTP setups instead of generic 500s, and translate Polish MFA setup and login strings and relative times. (#10074)
- 💰 Persist custom fields, including unchecked checkboxes, on new sales order and quote lines and make them readable immediately from the line list (#9724). (#10317, #10346) *(@haxiorz)*

## 🛠️ Improvements
- 🛠️ Track `.husky/pre-commit` as an executable file and add a guard test so the commit hook's auto-fix steps (i18n sync, template sync) are no longer skipped on a clean clone, and the release-prepare workflow honors it (#5120). (#5141) *(@adeptofvoltron)*
- 🛠️ Add a browser-level regression test asserting a customer appears exactly once, as a clickable row that navigates, in the ⌘K global-search palette (#5547). (#5658) *(@adeptofvoltron)*
- 🛠️ Add a real-browser integration test covering the client-side `modules.ts` override dispatch performed by `ClientBootstrap` (#5844). (#5953) *(@adeptofvoltron)*
- 🛠️ Bump `colord` from 2.9.3 to 2.10.0. (#6206)
- 🛠️ Bump `image-size` from 2.0.2 to 2.0.4. (#6485)
- 🛠️ Stabilize the TC-CRM-028 customer sync test by draining the local queue with a single consumer and waiting for completed outbound sync, removing intermittent null-priority failures (#5646). (#6891) *(@haxiorz)*
- 🛠️ Bump `@opentelemetry/instrumentation-pg` from 0.71.0 to 0.73.0. (#7025)
- 🛠️ Bump `prosemirror-view` from 1.42.2 to 1.42.3. (#7026)
- 🛠️ Bump `@modelcontextprotocol/sdk` from 1.30.0 to 1.31.0. (#7028)
- 🛠️ Scope `markCancelled` test fixtures to the caller tenant in the progress service tests, fixing the failing `develop` test job (#7043). (#7045) *(@wojciechszyjka)*
- 🛠️ Add four Univio contributors, `mateusz-lewandowski` (Fast White Cat) and `KamilGrocholski` (8lines, replacing Idego) to the certified partner registry and allowlist `kmrosiek` in the enterprise contribution guard. (#7253, #7446, #9086, #9814) *(@matgren, @adeptofvoltron, @patzick)*
- 🛠️ Give the OAuth initiate route test a logger mock with `warn`, fixing the `oauthStateLogger.warn is not a function` failure in the core test suite. (#7257) *(@lbajsarowicz)*
- 🛠️ Pin the clock in the `EventTypePanel` re-render test, which failed every day between 10:00 and 10:59 America/New_York (#7286). (#7287) *(@adeptofvoltron)*
- 🛠️ Flag English text in `CrudHttpError` and JSON error bodies in the `yarn i18n:check-hardcoded` scanner, which previously only checked `Error`, `createCrudFormError`, `raiseCrudError` and `toast` calls. (#7297) *(@AHKSammich)*
- 🛠️ Remove the stray `output/pdf` startup-guide PDF committed by accident and ignore `/output/` so generated files no longer land in the repo root. (#7466) *(@patzick)*
- 🛠️ Stabilize the flaky `@open-mercato/queue` delayed-job polling unit test that intermittently failed the CI test job on unrelated PRs (#7522). (#7527) *(@adeptofvoltron)*
- 🛠️ Add a browser regression test for feature-gated catalog injection widgets, covering the same product form for granted and denied users (#4398). (#7627) *(@haxiorz)*
- 🛠️ Add integration tests for resources undo and redo covering full snapshots, custom fields, child collections, tag membership and consumed undo tokens (#2577). (#7659) *(@haxiorz)*
- 🛠️ Add integration tests for feature toggle undo and redo covering global create, update and delete and tenant override create, change and clear (#2581). (#7661) *(@haxiorz)*
- 🛠️ Add integration tests for directory organization undo and redo covering scalar fields, hierarchy, custom fields and consumed undo tokens (#2580). (#7662) *(@haxiorz)*
- 🛠️ Consume `om-auto-sec-report` and `om-auto-sec-report-pr` from the shared open-mercato/skills collection instead of shipping local copies. (#7693) *(@adeptofvoltron)*
- 🛠️ Consume `om-app-spec-writing` and `om-gap-analysis` from the shared open-mercato/skills collection instead of shipping local copies. (#7694) *(@adeptofvoltron)*
- 🛠️ Consume `om-auto-qa-scenarios` and `om-figma-design-with-ds` from the shared open-mercato/skills collection instead of shipping local copies. (#7695) *(@adeptofvoltron)*
- 🛠️ Consume `om-pre-implement-spec`, `om-smart-test` and `om-create-agents-md` from the shared open-mercato/skills collection instead of shipping local copies. (#7696) *(@adeptofvoltron)*
- 🛠️ Consume `om-help`, `om-judge-agent-session` and `om-share-this-session` from the shared open-mercato/skills collection instead of shipping local copies. (#7697) *(@adeptofvoltron)*
- 🛠️ Replace the local `om-skill-creator` skill with the shared `om-create-skill` from the open-mercato/skills collection. (#7698) *(@adeptofvoltron)*
- 🛠️ Bump `baseline-browser-mapping` from 2.10.8 to 2.11.29. (#7733)
- 🛠️ Add a workflow that automatically applies the `partner-request` label when a certified partner opens or reopens a pull request or issue. (#7747) *(@patzick)*
- 🛠️ Move release handling to release lines, with `main` as the trunk and `release/vX.Y.x` lines taking fixes through `backport` labels, and retire `develop`. (#7752) *(@patzick)*
- 🛠️ Bump `follow-redirects` from 1.16.0 to 1.16.1. (#7769)
- 🛠️ Dedupe `prosemirror-view` so the document editor mounts again, fixing the "Failed to load document." error and TC-DOCUMENTS-013, 015 and 017 failing on `main`. (#7785) *(@patzick)*
- 🛠️ Stabilize the flaky TC-SX-009, TC-WC-037 and TC-WF-006 integration specs that failed intermittently in ephemeral integration runs (#7896). (#7897) *(@AHKSammich)*
- 🛠️ Bump `zod` from 4.4.3 to 4.6.6. (#7921) *(@pkarw)*
- 🛠️ Add database integration coverage for reverse CRM company linking, preserving organization scope and covering concurrent-link races for `customer_accounts` (#7861). (#7933) *(@haxiorz)*
- 🛠️ Fix the strict-mode locator in the TC-WMS-IMPORT-UI-001 spec and the TC-CHANNEL-EMAIL-HUB-005 timeout that failed integration shards on `main`. (#8016) *(@mobinea)*
- 🛠️ Stabilize the main integration setup and live-update checks that failed CI shards 4, 5 and 15. (#8030) *(@haxiorz)*
- 🛠️ Stabilize the TC-PHONE-HUB-006 phone-call cache integration check by using a run-unique synchronous `providerKey` filter instead of racing deferred full-text tokens. (#8062) *(@pkarw)*
- 🛠️ Make the Todo priority-validation integration test wait for the injected form widget before selecting severity. (#8095) *(@haxiorz)*
- 🛠️ Make the TC-SALES-ADDR-CONTACT-002 scenario wait for the sales form to be interactive before clicking the address switch (#7562). (#8176) *(@haxiorz)*
- 🛠️ Make both TC-TRANS-009 UI save/undo scenarios complete reliably within the existing 20-second test budget (#7561). (#8178) *(@haxiorz)*
- 🛠️ Make the TC-WF-011 workflow integration test click the node title instead of the whole node, so it no longer opens the Triggers modal and times out before reaching Customize on read-only code workflows (#7563). (#8196) *(@haxiorz)*
- 🛠️ Await in-flight snapshot I/O in the shared resource-usage tests so they stop failing intermittently with `ENOTEMPTY` when removing the temp directory. (#8239) *(@mikolajbogusz-they)*
- 🛠️ Stub `getKysely` in the sales update-customer-unchanged test's entity manager mock, fixing 24 unit test failures on `main` caused by the new order-line row lock. (#8256) *(@pkarw)*
- 🛠️ Restore reliable `main` CI by retrying only duplicate transparency-log signatures when publishing snapshots, sharing a 45-minute deadline across snapshot workflows, and stabilizing two flaky integration tests. (#8294) *(@pkarw)*
- 🛠️ Halve peak memory of `mercato generate` (about 2.8 GB in a standalone app) by batching AST edits, cutting the largest process at `yarn dev` startup. (#8336) *(@andrzejewsky)*
- 🛠️ Load node-only server dependencies as Next.js externals in dev, shrinking the Turbopack module graph and lowering dev server memory in standalone apps and the monorepo, and keep the application CSP regression tests loading both Next.js configurations with the shared server external packages dependency. (#8338) *(@andrzejewsky)*
- 🛠️ Start the dev MCP server only on its first request, so `yarn dev` no longer keeps an idle MCP process (about 520-540 MB plus its Yarn wrapper) resident. (#8339) *(@andrzejewsky)*
- 🛠️ Bump the dev dependency `glob` from 13.0.6 to 14.0.6 across five Dependabot updates. (#8350, #8403, #9279, #9469, #9480)
- 🛠️ Restore CI coverage aggregation after an intentionally skipped audit job, run all 15 integration shards plus full typecheck and unit tests for workflow edits, and keep superseded runs cancellable. (#8373) *(@pkarw)*
- 🛠️ Stabilize the empty quote document integration test by waiting for the empty state and accepting both the toolbar and empty-state Add item buttons. (#8391) *(@pkarw)*
- 🛠️ Bump `sanitize-html` from 2.17.5 to 2.18.1 in `packages/core` and `packages/shared`. (#8402) *(@pkarw)*
- 🛠️ Stabilize the standalone app integration lane on `main`, aligning specs with what the standalone launcher actually provides after it failed 157 tests on every commit. (#8452) *(@pkarw)*
- 🛠️ Add a self-contained Playwright regression covering customers task conflict recovery from a stale-version conflict through a Ctrl+Enter retry (#8469). (#8476) *(@pkarw)*
- 🛠️ Make `drainIntegrationQueue` check automatic-worker mode before choosing the standalone runner, so standalone tests with managed workers no longer start a second consumer on the same queue (supersedes #8017). (#8528) *(@mobinea, via @pkarw)*
- 🛠️ Align standalone CI snapshot workers with the Playwright process and make catalog media-transfer tests wait for rendered uploads, fixing queued operations that never completed and flaky media-transfer runs. (#8585) *(@pkarw)*
- 🛠️ Stabilize the `CrudForm` transformation test by also waiting for the transformed text input value, removing an intermittent failure (#8522). (#8607) *(@pkarw)*
- 🛠️ Stabilize the TC-CAT-042 media-warning test by asserting the warning before the 3-second flash auto-dismisses, removing an intermittent CI failure. (#8609) *(@pkarw)*
- 🛠️ Stop cancelling in-progress CI runs on pushes to `main`, `release/v*` and `feat/wms`, so the full suite can finish instead of being cancelled by each merge, while PR runs still cancel on new pushes. (#8610) *(@pkarw)*
- 🛠️ Retire stale GitHub Actions registrations for the removed Develop Release, Canary Release and historical eval workflows, and clarify the main snapshot workflows. (#8614) *(@pkarw)*
- 🛠️ Add a `ci-full` label that forces all 15 integration shards regardless of changed paths, with unrelated label events kept in separate concurrency groups so they cannot cancel a full run. (#8623) *(@pkarw)*
- 🛠️ Add durable native-browser coverage for `agent_orchestrator` task-list recovery after an execution broadcast is missed while the event bridge is disconnected (#8584). (#8662) *(@haxiorz)*
- 🛠️ Stabilize the main sidebar group visibility test by waiting for the preferences save, restoring visibility in `afterEach` with its own teardown budget, and normalizing stale state. (#8739) *(@pkarw)*
- 🛠️ Harden the TC-TT-017 request-access test against its recurring intermittent CI timeout on the "Request sent" button (#6107). (#8742) *(@adeptofvoltron)*
- 🛠️ Add the missing API integration regression proving the per-user messages list cache is isolated between users (#4835). (#8745) *(@pkarw)*
- 🛠️ Keep the enterprise quote-session record-locks test selectors compatible with real accessible labels by adjusting two placeholder-based selectors (#8724). (#8752) *(@pkarw)*
- 🛠️ Run full validation automatically on same-repository `stabilize/*` PRs and stop label additions from triggering CI, restoring one concurrency group per ref. (#8788) *(@pkarw)*
- 🛠️ Isolate `FORCE_FULL_SUITE` in the workflow test fixture and stabilize several full-suite UI tests exposed after the main build fix. (#8834)
- 🛠️ Add Playwright coverage for Retry and Cancel confirmations on the workflow instances list in English and Polish, including keyboard confirmation and long identifiers at 390px (#8825). (#8836) *(@pkarw)*
- 🛠️ Fix an intermittent teardown race in the web-research-browser egress proxy test that checked remote sockets before the peer had handled EOF. (#8840) *(@mikolajbogusz-they)*
- 🛠️ Add browser coverage for the dictionaries reserved-key 409 conflict feedback, including the retained create dialog and localized flash (#8780). (#8852) *(@adeptofvoltron)*
- 🛠️ Stabilize the TC-WF-010 first-attempt Customize/Reset test by warming the heavy visual editor route, removing an intermittent 20-second timeout (#8505). (#8854) *(@adeptofvoltron)*
- 🛠️ Add a browser regression test that checks the checkout Service package editors render correctly in Polish (#8572). (#8886) *(@haxiorz)*
- 🛠️ Add a self-contained browser regression test for currency-filtered Kanban pagination in customers, so a lane with multiple currencies no longer offers a bogus extra page (#8576). (#8897) *(@haxiorz)*
- 🛠️ Add browser coverage ensuring the sales payment row-menu column is labelled "Actions" in English and "Akcje" with the real Polish resources (#8521). (#8914) *(@haxiorz)*
- 🔧 Give the ephemeral integration harness a production-valid superadmin password, so `ephemeral-integration` shards run again now that production `mercato init` refuses a missing or placeholder password. (#8916) *(@pkarw)*
- 🛠️ Restore the atomic GitHub claim operations (`get-lock`, `acquire-lock`, exact-SHA `release-lock`) and missing review/CI routing operations in the agent-pipeline tracker descriptor, so automerge no longer stops before claiming a PR. (#8928)
- 🛠️ Disambiguate the `TC-ADMIN-003` audit-log test so its Action column header no longer matches the row Actions column and trips Playwright strict mode. (#8931) *(@pkarw)*
- 🛠️ Keep V8 coverage recording on the ephemeral application and test processes while removing `NODE_V8_COVERAGE` from package builds, generation and the app build, avoiding build-tool coverage collection (supersedes #7538). (#8957) *(@patrykbojczuk)*
- 🛠️ Stabilize the `TC-CRM-032` customers integration test by matching the Views sidebar Close button by its visible text instead of a global locator that also hit an unrelated alert dismiss button. (#8970)
- 🛠️ Teach agent skills, the review checklist and reference modules about backend request-path cost, and stop them modelling patterns that repeat expensive work on every call. (#8996) *(@pjagielski)*
- 🛠️ Isolate the `TC-STAFF-SUP-011` customerless support routing fixture so it no longer assumes the fallback project is a pristine seed. (#9008)
- 🛠️ Add native-browser coverage that WMS ASN, Lots and Putaway queue lists no longer flash a loading state on window-refocus background refetches (#8941). (#9028) *(@adeptofvoltron)*
- 🛠️ Extend the CLASSIC DI guard to scan host-app DI registrations and the create-app template, with a fixture detecting a destructuring factory that omits `.proxy()` (#4394) (supersedes #7173). (#9051) *(@Sawarz)*
- 🛠️ Bump `korthout/backport-action` from 4.7.0 to 4.7.1 in the backport workflow. (#9085)
- 🛠️ Speed up Redis cache tag invalidation by replacing blocking `KEYS` with `SCAN`, batching reads with `MGET`, grouping deletions and deferring tag reconciliation. (#9087) *(@WojtekKrzyzanowski)*
- 🛠️ Keep CI-generated random bootstrap passwords from starting with `--` and being parsed as CLI flags, by placing the password-policy characters before the random bytes. (#9090)
- 🐳 Include the required upstream `AGENTS.md` and `BACKWARD_COMPATIBILITY.md` guides in QA preview Docker builds, which failed while packaging the CLI. (#9125)
- 🛠️ Mark standalone test processes as isolated by passing `OM_INTEGRATION_TEST=true` to Playwright, so Main Snapshot Release portal scope regressions pass their safety guard. (#9176)
- 🛠️ Seed agent activity in `TC-AGENT-OVERVIEW-001` so the Agent trust card appears instead of the empty state. (#9238) *(@zielivia)*
- 🛠️ Make `TC-STAFF-051` independent of the employee's remembered project when opening the TimerBar picker, and add a backfill rollback note to the upgrade notes. (#9278) *(@Marynat)*
- 🛠️ Add native-browser coverage for backend/frontend layout wrappers collapsing when empty while keeping injection and record-lock portal targets mounted (#8792). (#9281) *(@adeptofvoltron)*
- 🛠️ Stabilize the `TC-WF-006` workflow definition integration test by searching through the definitions list Filters panel instead of a sidebar control that issues no such request. (#9288)
- 🛠️ Add browser regression coverage that EUDR plot map popups show literal GeoJSON plot names without rendering supplied markup (#9105). (#9340) *(@pkarw)*
- 🛠️ Refresh agent pipeline tracker mutations to use REST for labels, assignments and title/body writes, avoiding legacy GraphQL project-field failures, and document the pipeline safely. (#9360) *(@pkarw)*
- 🛠️ Add a browser and API regression test for server-side sorting on the sales orders and quotes lists, including sorting from page 2 (#8507). (#9386) *(@pkarw)*
- 🛠️ Add browser and API regression tests for duplicate role recovery with translated Name errors and for manual business-rule IDs (#8700). (#9387) *(@pkarw)*
- 🛠️ Add real-browser coverage of localized `PriorityBadge` priority tooltips in messages (#9277). (#9404) *(@adeptofvoltron)*
- 🛠️ Add SSR-safety regression coverage for `safeLocalStorage`, documenting that the Node `ExperimentalWarning` on `localStorage` is not a code defect in this repository (#8408). (#9405) *(@adeptofvoltron)*
- 🛠️ Bump `fast-xml-parser` from 5.10.1 to 5.12.0. (#9468)
- 🛠️ Add a real-browser regression test for the portal claim detail page that checks the reason label rendered in the title for dictionary, seeded and fallback labels (#8503). (#9509) *(@adeptofvoltron)*
- 🛠️ Tolerate fresh snapshot tarball propagation in the Main Snapshot Release workflow by retrying the standalone install when Yarn hits a transient 404 (`YN0035`) right after publishing. (#9588)
- 🛠️ Give the replacement-order undo integration tests an isolated copy of the stock approval definition with explicit grants, so they no longer time out after event payload actors stopped granting workflow authority. (#9657)
- 🛠️ Add a Playwright regression test checking that the catalog Metadata header stays contained on phone-width cards in English and Polish (#9654). (#9667) *(@Kamyyylo)*
- 🛠️ Stabilize the messages priority tooltip locale test against layout shifts caused by a background-operation banner mounting between the coordinate calculation and the hover. (#9694)
- 🛠️ Stabilize main's validation by giving cold application startup a bounded worker fixture and tightening flaky communication-channel and customer tests without weakening their behavioral checks. (#9729)
- 🛠️ Add a self-contained Playwright regression test for the rendered resource Availability section heading across locales (#9517). (#9734) *(@adeptofvoltron)*
- 🛠️ Stop two integration specs (customer picker recipient removal and company tax ID) from racing the page on slow runners. (#9744) *(@zielivia)*
- 🛠️ Add `yarn test:create-app:presets` to verify every shipped starter preset by scaffolding, installing, migrating and initializing it against locally built packages and a fresh database. (#10079, #10100) *(@pkarw)*

## 📝 Specs & Documentation
- 📝 Document the canonical person, deal and company create-form hosts and their compatibility guidance in the `customer_accounts` module guide (#5882). (#5915) *(@adeptofvoltron)*
- 📝 Add the spec for an opt-in `ledger.importDefaultChartOfAccounts` command and backend-page button that bulk-creates a Polish starter chart of accounts for the `ledger` module. (#6137) *(@mikoajp)*
- 📝 Add the spec for Documents record links, letting Documents link any authorized searchable entity by default with an explicit component-injection contribution path. (#6731) *(@pkarw)*
- 📝 Add the spec proposal for unified CRM email history and context, giving Person and Company pages one shared Emails tab, conversation reader and composer backed by explicit conversation links. (#6744) *(@AHKSammich)*
- 📝 Add the accessibility program spec targeting WCAG 2.2 AA and EN 301 549, with a guardian skill draft and Storybook quality gate proposals. (#6872) *(@zielivia)*
- 📝 Add the Phase 1 feature spec for the OAuth2 grant-lifecycle core, defining the implementation contract for the App Spec. (#6910) *(@mikolajbogusz-they)*
- 📝 Add the tax providers roadmap and the sales tax provider contract spec, moving tax computation beyond the product-owned rate. (#6918) *(@matkowalski)*
- 📝 Add the spec for helpdesk support tickets in the `staff` module, letting Customer Portal users register tickets, follow their status, converse with the team and exchange files. (#6965) *(@WojciechSoczynskiTHEY)*
- 📝 Add the spec for production Docker images that exclude the Turbopack build cache, which `next start` never reads but every image currently carries. (#6980) *(@pmadajthey)*
- 📝 Add the spec for a project-only mode of the time entry dialog, limited to the caller's accessible projects with an optional task, and for exporting its props schema. (#7000) *(@Marynat)*
- 📝 Move the `financial_pl` integration contracts and accounting package specs from `official-modules` into Core ahead of archiving that repository. (#7070) *(@wojciechszyjka)*
- 📝 Add provider-neutral, TLS-first production-readiness guidance for standalone apps, linking the VPS and Railway runbooks and the Open Mercato Readiness Scanner, and route go-live requests to it from the generated agent harness (#6956). (#7125) *(@pkarw)*
- 📝 Document and route standalone module creation and npm/GitHub publication through `create-mercato-module` in the standalone agent harness and framework docs, including installing a module into another app, with harness sandbox and runner compatibility fixes. (#7126) *(@pkarw)*
- 📝 Add the spec for Brevo and Mailjet outbound-only email provider connectors, giving EEA operators that need EU-only data hosting a built-in choice beyond Resend and SES (#5556). (#7129) *(@pkarw)*
- 📝 Add the spec for installing modules with `mercato module add` from a GitHub `owner/repo` or URL, with an optional `@version` suffix and an npm-first lookup for scoped packages. (#7139) *(@pkarw)*
- 📝 Add the spec for the Schedule Planner (`shift_scheduling`) module, letting supervisors plan their employees' shifts for a team on a planning board. (#7194) *(@mnpositiveengineer)*
- 📝 Align the availability contract spec and its consumer specs with the shipped `resolveAvailability()` entry point and `availability.reserve/release/commit` commands instead of the nonexistent `availabilityService` DI key. (#7211) *(@lbajsarowicz)*
- 📝 Fix the storefront specs' cache keys and invalidation so count-facet keys include tenant, store and locale, no surface keys on the whole buyer digest, and invalidation uses tags that are actually produced. (#7213) *(@lbajsarowicz)*
- 📝 Add the spec for a module source collision policy covering modules with the same runtime ID from different npm packages or repositories, including installation, enable/disable, imports, updates and ejection. (#7289) *(@pkarw)*
- 📝 Point the ecommerce suite specs at the tax-providers roadmap, answering the group-tax resolver question and the timing of tax calculation in cart and checkout. (#7298) *(@matkowalski)*
- 📝 Add the App Spec for a read-only Xero integration importing Xero Contacts as Companies and sales invoices into Open Mercato. (#7334) *(@mikolajbogusz-they)*
- 📝 Add the Xero Phase 1 feature spec for connecting and importing contacts, and align the Xero App Spec with the shipped design. (#7335) *(@mikolajbogusz-they)*
- 📝 Add the draft spec for an opt-in Codabox CODA integration module that retrieves CODA bank statements through the Codabox Connect API (V2) for bank reconciliation. (#7443) *(@leonbahley)*
- 📝 Add the spec for opt-in zstd/gzip compression of `@open-mercato/cache` values in the Redis and SQLite strategies, to cut Redis memory and traffic for large per-user entries such as sidebar navigation. (#7445) *(@mtytula)*
- 📝 Add the design-only spec for a provider-neutral AI decision model port that returns typed answers with per-option probabilities, such as TypeSafe Jev through the OpenRouter Decisions API. (#7464) *(@adeptofvoltron)*
- 📝 Add the spec and clickable prototype for a new `property_management` module covering buildings, spaces, leases, bookings, lease invoicing through the sales flow and customer portal pages for coworking operators. (#7472) *(@WojciechSoczynskiTHEY)*
- 📝 Correct the sales module agent guide to state that the quote step is optional for orders and that quotes are deleted on conversion, matching the code. (#7475) *(@WojciechSoczynskiTHEY)*
- 📝 Add the spec for notifying MFA administrators, scoped by tenant and organization with daily deduplication, when an emergency bypass is observed. (#7618) *(@haxiorz)*
- 📝 Add the spec for a tenant-configurable deal status vocabulary with an environment default, preserving the shipped `win`/`won`/`lost`/`loose`/`closed` behavior and historical reads. (#7624) *(@haxiorz)*
- 📝 Document the real `yarn mercato queue worker --all` and `queue status` commands in the scheduler docs and CLI, replacing the non-existent `worker:start` and `worker:status` (#7649). (#7650) *(@pgaluszk)*
- 📝 Fix the full-app Docker docs' Postgres backup and restore commands and volume names for the `mercato-postgres-${DEPLOY_ENV:-local}` container, and add the attachments volume (#7651). (#7652) *(@pgaluszk)*
- 📝 Add the spec for resources undo/redo integration coverage, including full snapshots, custom fields, child collections, tag membership and consumed undo tokens. (#7657) *(@haxiorz)*
- 📝 Add the spec for feature toggle undo/redo integration coverage, covering global CRUD, tenant overrides and consumed-token rejection. (#7658) *(@haxiorz)*
- 📝 Add the spec for directory organization undo/redo integration coverage, including hierarchy restoration, custom fields and consumed undo tokens. (#7660) *(@haxiorz)*
- 📝 Add the spec for recurring sales orders, where a quote or order carries a schedule and a scheduled job invoices each period in advance, with configurable cancellation settlement. (#7765) *(@WojciechSoczynskiTHEY)*
- 📝 Document that every PR carries a release-note label and that review applies it, so generated release notes group PRs correctly. (#7779) *(@patzick)*
- 📝 Add the spec for immutable `Money` and `Currency` value objects in `@open-mercato/shared`, for new code only. (#7795) *(@WojciechSoczynskiTHEY)*
- 📝 Document running the Open Mercato Readiness Scanner locally, in CI and inside staging and production workloads via `npx`. (#7798) *(@pkarw)*
- 📝 Add the phase 1 spec for the CRM field model, covering classification, company enrichment, hierarchy, identifiers and relationship types, with bounce preservation, guarded currency-null manual-line recovery and lifecycle, health and renewal slices (#7700). (#7820) *(@haxiorz)*
- 📝 Document a copy-paste "Minute 10" quick start, the Start the Coding Agent step, module publishing and Change Open Mercato Core flows in the README. (#7849) *(@wojciechszyjka)*
- 📝 Add the spec for ingesting inbound email attachments in `inbox_ops`, storing them, passing them to LLM extraction and showing them on the proposal instead of silently dropping them. (#7954) *(@mikolajbogusz-they)*
- 📝 Clarify in the Users guide, REST API reference and OpenAPI description that the staff directory is tenant-wide for non-superadmins rather than organization-scoped (#7832). (#7994) *(@haxiorz)*
- 📝 Add the design-only prototype and spec for a Deals close-date Timeline tab, showing open deals by expected close date for forecast review. (#7999) *(@WojciechSoczynskiTHEY)*
- 📝 Add the spec for an opt-in product configurator (CPQ) module that lets admins describe configurable products. (#8031) *(@KamilNahotko)*
- 📝 Add the carried-forward bookings module spec, an extensible foundation for people, equipment and rooms with occupancy and conflict detection, aligned with reviewed platform contracts (supersedes #7004). (#8063) *(@JacekZ96, via @pkarw)*
- 📝 Document the Open Mercato Modules catalog for module discovery, install and listing instead of the archived `official-modules` repository. (#8120) *(@wojciechszyjka)*
- 📝 Add the spec for letting staff cancel pending portal invitations while preserving existing organization scope and protecting cancellation against acceptance and resend races. (#8209) *(@haxiorz)*
- 📝 Add the spec for exporting named props schemas for the nine time-tracking components, so replacement authors can import the host contract (supersedes #8291). (#8562) *(@Marynat, via @pkarw)*
- 📝 Add the Open Mercato QA extension for `om-auto-qa-pr`, a QA risk checklist from recurring manual-QA findings, and automerge human lanes for the QA automation. (#8588) *(@droalina)*
- 📝 Document the conditional-write (`If-None-Match: *`) requirement for S3-compatible storage endpoints and the signed-upload quota cost when no size is requested, with a disposable-bucket verification procedure (#4838, #4839). (#8606) *(@pkarw)*
- 📝 Simplify the README quickstart by removing the redundant `docker compose up` before `yarn setup` and explaining setup infrastructure reuse and `--no-infra` for externally managed services. (#8608) *(@pkarw)*
- 📝 Add the spec for configurable Markdown code-block languages, letting module and app customizers add, hide or rename the shared language choices through an optional prop and component props transforms (#8258). (#8621) *(@haxiorz)*
- 📝 Add the spec for a shared focus/reveal behavior that makes a rejected save message visible in long `CrudForm` forms and the staff task drawer (#8204). (#8671) *(@haxiorz)*
- 📝 Add the spec for identifying audit log rows with historical record names, safe change summaries, sticky undo actions, seconds and localized row labels. (#8673) *(@haxiorz)*
- 📝 Add the spec for an organization-scoped default quote validity setting used by the quote send dialog and omitted-value send requests, keeping the 14-day initial default. (#8688) *(@haxiorz)*
- 📝 Document the real scheduler start output, supported options, exit codes, enqueue behavior and registered queue subcommands, with a regression guard checking queue commands across docs pages (#8510, #8511) (supersedes #8626). (#8695) *(@pgaluszk, via @pkarw)*
- 📝 Remove references to a third-party sandbox project from the Autopay spec and package comment, citing only the official Autopay Online v1.1 documentation. (#8716) *(@autopaylab)*
- 📝 Align the scheduler CLI reference with the source, covering actual `list`/`status` output, supported filters, database commands, defaults and locking (#8651). (#8751) *(@pkarw)*
- 📝 Add the spec for module dependency integrity, making an app enabled module set verifiable so presets and custom module selections cannot silently depend on a disabled module. (#8790) *(@haxiorz)*
- 📝 Add the spec for an Enterprise-only resumable, encrypted-by-default backup and restore CLI in a planned `backups` module. (#8910) *(@pkarw)*
- 📝 Add the spec for a sales invoice write path for imported invoices, so `sales.invoices.create` and `sales.invoices.update` keep custom fields, accept negative line amounts and replace lines on update. (#8984) *(@mikolajbogusz-they)*
- 📝 Document scheduler diagnostic commands that keep PostgreSQL and Redis credentials out of process arguments visible via `ps` or argv-capturing monitors (#8787). (#9169) *(@adeptofvoltron)*
- 📝 Document accurately in `CONTRIBUTING.md` that same-repository PRs labelled `ci-full` get full typechecking, unit tests and all 15 integration shards. (#9273)
- 📝 Add the design-only spec for version pinning of code-defined workflows (#7184). (#9295) *(@kurrak)*
- 📝 Add the spec for an Enterprise data verification gate for protected key rotation, built on the planned resumable encrypted backup. (#9328) *(@pkarw)*
- 📝 Add the enterprise spec and proof for PostgreSQL tenant row-level security set on the current connection pool client. (#9353) *(@pkarw)*
- 📝 Add the spec for sign-in activity, covering a login IP/user-agent seam and an enterprise sign-in log for successful and failed logins (#8106). (#9435) *(@pkarw)*
- 📝 Add the spec for typed CRM company-to-company relationships with tenant-defined relationship types, a Relationships tab on the company page and server-enforced invariants against self-relations, duplicates, second parents and cycles (supersedes #8007). (#9503) *(@WojciechSoczynskiTHEY, via @haxiorz)*
- 📝 Add the spec for server-side sorting of the payment transactions list by Updated, Status, Amount or Provider with validated query fields and stable UUID tie-breaking (#7788). (#9513) *(@pkarw)*
- 📝 Add the spec for configuring native integration admin and employee role credentials through existing initialization variables (#8475). (#9560) *(@pkarw)*
- 📝 Add the spec for linking a person to multiple companies from the person create/edit form without changing the `CompanySelectField` scalar contract. (#9593) *(@haxiorz)*
- 📝 Add the spec for multi-dimensional analytical tags on a journal entry line, with locked per-owner replacement of a line's dimension tags and a fiscal-period lock check (supersedes #5972). (#9745) *(@mikoajp, via @haxiorz)*

## 👥 Contributors

- @mkadziolka
- @WojciechSoczynskiTHEY
- @autopaylab
- @jtomaszewski
- @pkarw
- @Marynat
- @mikolajbogusz-they
- @wojciechszyjka
- @adeptofvoltron
- @mtytula
- @patrykbojczuk
- @mateusz-lewandowski
- @pat-lewczuk
- @maxidragon
- @nowekontotestowe2026-web
- @haxiorz
- @Hejnas
- @zielivia
- @shimmy-aga
- @ddiarassouba94140-blip
- @Geeknauts-company
- @Sawarz
- @AHKSammich
- @mstopinski
- @jakubmatwiejew-wq
- @pcbeingused333
- @Sarthak-madan334
- @Kamyyylo
- @patzick
- @kmrosiek
- @lbajsarowicz
- @pidubiel
- @wojski999
- @rengare
- @SiphoChris
- @Ramnath0521
- @marcin-urbanski
- @michalper
- @etor6233
- @fshagent
- @kurrak
- @marcinwadon
- @dawid-walkiewicz
- @Tomeckyyyy
- @oskarwoj
- @lchrusciel
- @mobinea
- @matkowalski
- @okwasniewski
- @jarekdrabek
- @mat-kruk
- @andrzejewsky
- @KamilMichalski0
- @pgaluszk
- @zawstudio
- @Paul-Mlodochowki
- @matgren
- @pjagielski
- @WojtekKrzyzanowski
- @mikoajp
- @pmadajthey
- @mnpositiveengineer
- @leonbahley
- @KamilNahotko
- @JacekZ96
- @droalina

---
# 0.9.0 (2026-10-09)

## Highlights

Open Mercato 0.9.0 is led by **ecommerce Release 2**: the shared **availability contract** (a provider registry with a catalog-only fallback, an `availability` module for sell policies, and a safety-stock-aware `wms` provider) ships together with **customer groups and B2B terms**, joined by a backend admin UI for per-customer, per-group, quantity-tier and validity-window **pricing rules** — until now reachable only by writing database rows — and bulk-create endpoints for catalog products and categories with checkpoint/resume and per-row failure isolation. The official **`forms` questionnaire module moves into `@open-mercato/core`** (versioned definitions, Form Studio, public runners, PDF snapshots, GDPR anonymization), and a scoped suite of ecommerce specs lays out the roadmap that follows.

**Communications become genuinely two-way and team-aware.** Operators can finally reply on inbound channel threads, a user can share their personal mailbox with teammates — one conversation or the whole channel as a team mailbox, reversibly — the Messages composer gains a **"Send from"** selector that sends through the author's own connected mailbox, and Gmail joins IMAP with **years-deep history import**. Ingested messages now carry the provider's own timestamps, stay deliverable after a conversation is assigned, and route to the right per-user channel owner. CRM deal ownership becomes assignable from the deal detail view, both creation paths and a bulk "Reassign owner" action, and data sync's overloaded "Retry" button splits into three distinct operator actions.

**Security and isolation get another consolidated pass.** A hardening sweep from coordinated private reports tightens tenant and organization isolation across directory mutations, auth undo/redo, SSE identity revalidation, attachment and progress-job authorization, encryption-map writes and interceptor route matching; "All Organizations" requests now narrow to organizations where the caller holds every required feature, and an explicitly empty organization scope denies access everywhere. Fields declared only by an organization-scoped encryption map no longer land on disk in plaintext at the tenant-wide scope, ciphertext sealed under a different key is rejected instead of silently nested, AI assistant chat history is encrypted at rest, revoked customer-portal sessions stop authenticating, and `next` is bumped past a critical `next/og` remote-code-execution advisory.

Correctness and platform work round it out: undoing an order-level action no longer hard-deletes the shipments, payments and returns recorded after it, sales gross totals recompute on every price/quantity/discount/tax edit, and a bundler-renamed DI parameter that had **silently disabled optimistic-lock protection** in published builds is fixed. Observability gains opt-in **browser RUM telemetry** through a same-origin OTLP proxy and OTLP support across every Docker topology. Several of these changes need downstream attention — the encryption-map uniqueness migration, the `unaccent` / `pg_trgm` PostgreSQL extensions for catalog search, and `customers` now requiring `progress` among them — so read [`UPGRADE_NOTES.md`](UPGRADE_NOTES.md) before deploying. Enjoy!

## ✨ Features
- ✨ Add opt-in browser RUM telemetry for the backoffice, exporting document-load and fetch spans through a same-origin, authenticated, per-user-budgeted OTLP proxy so the collector credential never reaches the browser; off by default via `TELEMETRY_BROWSER_ENABLED`. (#5195) *(@jtomaszewski)*
- ✨ Add `POST /api/catalog/products/bulk-create` and `POST /api/catalog/categories/bulk-create`, with batch pre-validation, checkpoint/resume, and per-row failure isolation for large imports. (#5610) *(@adeptofvoltron)*
- ✨ Let a user share their personal-mailbox email with teammates, either one `Person` conversation or the whole channel as a team mailbox, as an owner-controlled, retroactive, and reversible read grant. (#5756) *(@WojciechSoczynskiTHEY)*
- ✨ Support the optional OTLP telemetry mode across every Docker topology (root Compose, Traefik overlay, create-app template) with a pinned collector profile, and fail fast with a clear error instead of silently falling back when an explicitly selected OTLP backend can't load its packages. (#5799) *(@haxiorz)*
- ✨ Add a `hiddenGroupIds` prop to `CrudForm` so hosts can hide built-in groups by their stable id instead of copying the whole form to build a smaller one. (#5886) *(@adeptofvoltron)*
- ✨ Let a host hide a Kanban/List/Map deals view via a `section:customers.deals.viewTabs` component override and the new `visibleViews` prop, instead of forking the deals list pages (#5923). (#6037) *(@adeptofvoltron)*
- ✨ Echo the new `updatedAt` from `PUT /api/catalog/products`, so the product edit page reads its optimistic-lock version from the save response instead of issuing an extra `GET` after every save. (#6123) *(@adeptofvoltron)*
- ✨ Add an optional `listDocumentIds` method to the fulltext search driver interface, implemented for Meilisearch, so a future caller can page through every indexed document id for an entity/tenant without Meilisearch's `maxTotalHits` search-hit cap (#5931). (#6128) *(@adeptofvoltron)*
- ✨ Add Gmail backlog history import (`importHistory`), and widen the hub's import-history limits to 3650 days / 50000 messages (env-overridable), so a Gmail channel can import years of historical mail the way IMAP already does. (#6257) *(@lbajsarowicz)*
- ✨ Add a "Send from" selector to the Messages composer so an external email can be sent through the author's own connected mailbox via `sendAsUser`, correctly wiring thread mapping for inbound replies instead of always using the platform sender. (#6262) *(@lbajsarowicz)*
- ✨ Add a backend admin UI for per-customer, per-group, quantity-tier and validity-window product pricing rules, previously reachable only by inserting database rows directly, and harden the pricing resolver registry with currency- and multi-customer-group-aware matching. (#6268) *(@adeptofvoltron)*
- ✨ Add `useAppEventCoalesced`, a leading+trailing debounced variant of `useAppEvent`, and adopt it in the messages inbox so an ingest burst of dozens of messages triggers one list refresh instead of one reload per message. (#6270) *(@lbajsarowicz)*
- ✨ Split the overloaded data sync "Retry" button into three named operator actions — Retry/Resume, Retry from the beginning, and Run again — and show where a retry will resume from on the run detail page (supersedes #6187). (#6318) *(@jtomaszewski, via @wojciechszyjka)*
- ✨ Let a deal's owner be assigned from the detail view, both creation paths and a new bulk "Reassign owner" action on the deals list, not just the Pipeline board. (#6442) *(@WojciechSoczynskiTHEY)*
- ✨ Add an optional `describeProgressJob` hook so a data-sync adapter whose runs are a long-lived feed can customize or hide the progress job its runs create, instead of leaving a never-finishing, cancellable job in everyone's top bar. (#6681) *(@maxidragon)*
- ✨ Add optional `canEditNote`/`canDeleteNote`, `readOnly`, and `contextLabel`/`contextHref` props to `NotesSection` so hosts outside the CRM can reuse it with per-note permissions, read-only mode, and a generic linked-record context. (#6694) *(@kurrak)*
- ✨ Ship ecommerce Release 2: the availability contract (a provider registry with a catalog-only fallback, an `availability` module for sell-policy CRUD and resolution, and a safety-stock-aware `wms` provider) together with customer groups and B2B terms, with organization-scope checks on group membership and explain-terms access. A first landing was reverted and re-shipped here. (#6339, #6411, #6709) *(@adeptofvoltron)*
- ✨ Move the official `forms` questionnaire module (versioned definitions, Form Studio, public runners, PDF snapshots, GDPR anonymization) into `@open-mercato/core`, fixing a critical cross-tenant scoping gap in `AnonymizeService` found during the port. (#6770) *(@pkarw)*
- ✨ Group the admin Notification Delivery matrix's types by category with localized headings and a translated "Other notifications" fallback group, instead of listing every notification type in one flat table. (#6825) *(@haxiorz)*

## 🔒 Security
- 🔒 Narrow "All Organizations" CRUD requests to only the organizations where the caller holds every required feature, closing a gap where authorization was checked against one organization while data was read from a broader set. (#5778) *(@haxiorz)*
- 🔒 Always re-check session liveness on customer-portal API requests, including legacy sessionless tokens, which previously kept authenticating a customer after every one of their sessions had been revoked (#5952). (#6032) *(@adeptofvoltron)*
- 🔒 Fix tenant-wide encrypt/decrypt to honor every organization-scoped encryption map, so a field declared only at the organization scope is no longer written to disk in plaintext — or handed back still sealed — when a row is saved or read at the tenant-wide scope (#5949). (#6066) *(@adeptofvoltron)*
- 🔒 Point security vulnerability reports at the dedicated `security@openmercato.com` mailbox instead of the shared `info@openmercato.com` inbox, so the file's 48-hour acknowledgment SLA is achievable (#6078). (#6096) *(@KamilMichalski0)*
- 🔒 Encrypt AI assistant chat messages and pending-action payloads at rest when tenant data encryption is enabled, instead of storing them as plaintext (#6332). (#6697) *(@adeptofvoltron)*
- 🔒 Bump `brace-expansion`, `engine.io`, `joi`, `nodemailer` and `undici` to clear 9 high-severity audit advisories blocking CI's `audit` gate, including a `nodemailer` v10 upgrade with a fix for its dropped `MailComposer` export that the IMAP channel's SMTP client relies on. (#6759) *(@WojciechSoczynskiTHEY)*
- 🔒 Bump `next` to 16.3.6, fixing a critical remote-code-execution advisory in `next/og`'s `ImageResponse`, and `@grpc/grpc-js` to 1.14.5, fixing a bug that could report unauthorized certificates as authorized, clearing CI's `audit` gate. (#6777) *(@adeptofvoltron)*
- 🔒 Add an "Enterprise Contribution Guard" CI check that fails any PR containing a commit under `packages/enterprise/` from an author outside an explicit allowlist, enforcing a commercial-contribution policy that had been manual-only. (#6813) *(@patzick)*
- 🔒 Block IMAP/SMTP host configuration that embeds an internal IPv4 address inside an IPv6 literal (NAT64, 6to4, IPv4-compatible forms) or zone-scoped variant, closing an SSRF gap where the connect-time pinning layer treated them as valid external targets and probed internal ports (#3830). (#6844) *(@adeptofvoltron)*
- 🔒 Harden tenant and organization isolation across directory mutations, auth command undo/redo, SSE identity revalidation, attachment and progress-job authorization, encryption-map writes and interceptor route matching, consolidating fixes from coordinated private security reports. (#6932) *(@pkarw)*

## 🐛 Fixes
- 🐛 Let operators reply to and deliver messages on an inbound channel thread, which previously answered `403 Access denied` for every operator or silently failed to send (#5535). (#5645) *(@wojciechszyjka)*
- 🔐 Stop the ACL editor from showing deny-all and unrestricted organization scopes identically, so an operator can no longer save a silent total permission loss (#5642). (#5659) *(@adeptofvoltron)*
- 🐛 Stop the customer portal root from rendering the logged-out header and shell over an active session, which also silently disabled the portal SSE bridge and sidebar navigation. (#5686) *(@pat-lewczuk)*
- 🔄 Rebuild the `search_text` search aggregate from the decrypted index document instead of ciphertext, so a customer's name is searchable through the aggregate instead of silently indexing tokens nothing can ever match (#5625). (#5711) *(@adeptofvoltron)*
- 🐛 Collapse the ever-widening row of provider "Connect…" buttons on My communication channels into a single `Connect channel` dropdown menu (#5595). (#5735) *(@adeptofvoltron)*
- 🔄 Replace hot-row document-number claims with PostgreSQL sequences and serialize the nullable-tenant coverage-counter initialization under an advisory lock, preventing lost first adjustments and duplicate coverage rows (supersedes #5613). (#5766) *(@adeptofvoltron, via @pkarw)*
- 🐛 Add an Organization column to the admin customer users list so staff can tell which organization each customer user belongs to (#5575). (#5775) *(@adeptofvoltron)*
- 🐛 Make a saved DataTable view fully determine visible columns, including custom fields and late-registering injected columns, so columns no longer flicker during hydration (#5117). (#5823) *(@adeptofvoltron)*
- 🔧 Make Awilix CLASSIC DI registrations, including the CRUD mutation guard factory, immune to bundler parameter renaming (Turbopack's `em` → `em2`), which had silently disabled optimistic-lock and RBAC guard resolution — and with it lost-update protection on every CRUD update and delete — in published builds. (#5861, #6231) *(@pat-lewczuk, @lbajsarowicz)*
- 📦 Declare the MIT license in the `@open-mercato/telemetry`, `channel-resend` and `channel-ses` package manifests, and add a guard so any future publishable package missing a license fails its own PR (#5878). (#5879) *(@adeptofvoltron)*
- 🐛 Let field widgets registered against the customers company form host participate in company creation, not just editing (#5875). (#5881) *(@adeptofvoltron)*
- 🐛 Fix the opt-in `OM_SEARCH_USE_ILIKE_FOR_NON_ENCRYPTED_FIELDS` search path so multi-word queries match correctly instead of returning wrong records or the whole table (#5803). (#5884) *(@adeptofvoltron)*
- 🔧 Retry `yarn install` in CI when it crashes inside Yarn's bundled HTTP client, so a transient upstream race no longer fails required jobs — and skips the coverage gate — on PRs unrelated to the failure (#5889). (#5891) *(@adeptofvoltron)*
- 🔧 Harden the WMS Playwright `fillCombobox` helper so a slow suggestions response fails loudly instead of silently leaving a combobox field uncommitted (#5847). (#5892) *(@adeptofvoltron)*
- 🔐 Show a clear "this email already has a portal account" message when accepting a customer portal invitation for an address that already has one, instead of an unhandled server error (#5899). (#5918) *(@adeptofvoltron)*
- 🐛 Stop the schedule/activity edit dialog from seeding its date from the completion timestamp, which silently overwrote a planned activity's due date on every save (#5939). (#5977) *(@adeptofvoltron)*
- 🐛 Include widget-injected columns (`accessorFn` + `id`, no `accessorKey`) in the DataTable column chooser so they can be hidden and shown like any other column (#5928). (#5981) *(@adeptofvoltron)*
- 🌍 Localize `PhoneNumberField`'s country dropdown names instead of always showing English, and let `createPrimaryPhoneField` forward a custom `countries` list to it (#5927). (#5983) *(@adeptofvoltron)*
- 🔄 Make a workflow event trigger's `Debounce (ms)` setting actually debounce rapid repeated events for the same record, instead of being accepted, stored and displayed with no runtime effect (#5922). (#5992) *(@adeptofvoltron)*
- 🌍 Localize the customers email-validation error message instead of showing Zod's hardcoded English default on every locale (#5925). (#5993) *(@adeptofvoltron)*
- 🐛 Fix deleting a Company whose last Person-Company link was already soft-deleted, which previously violated a foreign key and returned HTTP 500 instead of succeeding (#5965). (#6018) *(@adeptofvoltron)*
- 🐛 Run a `makeCrudRoute`'s `hooks.afterList` before serializing CSV/JSON/XML/Markdown exports, so downloads reflect the same hook-patched values as the JSON list instead of silently ignoring the mutation (#5969). (#6019) *(@adeptofvoltron)*
- 🐛 Add `ATTACHMENTS_STORAGE_ROOT` so the local attachment store resolves from explicit configuration instead of `process.cwd()`, fixing attachments that became unreadable after a redeploy ran from a different working directory (#5946). (#6020) *(@adeptofvoltron)*
- 🐛 Log a WARN when an encrypted custom field is written as plaintext because the tenant encryption key could not be resolved, instead of failing silently (#5921). (#6022) *(@adeptofvoltron)*
- 🐛 Resolve tenant-wide (org-NULL) custom field definitions on the write path so an `encrypted` field is actually encrypted at rest instead of silently stored as plaintext (#5919). (#6026) *(@adeptofvoltron)*
- 🔄 Pass each custom field's `kind` when decrypting query-index and full-text search documents, so an encrypted string field like `"123"` no longer comes back as a number or boolean and risks being nulled out on the next save (#5968). (#6027) *(@adeptofvoltron)*
- 🐛 Make every portal navigation crossing the authenticated/public boundary a full page load so the server layout always recomputes the chrome and session, and add a guard test so the rule survives without reviewer vigilance (#5958). (#6028) *(@adeptofvoltron)*
- 🐛 Let a task be saved without a due date instead of forcing every activity type through the same required date/time validation (#5941). (#6030) *(@adeptofvoltron)*
- 🐛 Fix `widgets.components` overrides so a replaced or disabled component stays overridden after the page hydrates instead of flickering back to the module default (#5864). (#6031) *(@adeptofvoltron)*
- 🐛 Stop a record's custom field values from duplicating after it moves to a different organization: a write now updates the existing value across the record's scope instead of silently inserting a second, unreadable row (#5970). (#6034) *(@adeptofvoltron)*
- 🔐 Carry the resolved tenant through password reset so a user lands on their own tenant's login page, with its banner and branding, instead of the generic login form (#5901). (#6036) *(@adeptofvoltron)*
- 🐛 Let `PUT /api/customers/interactions` re-link an interaction to a different person or company via `entityId`, which the update schema previously stripped silently so the only fix was delete-and-recreate (#5938). (#6050) *(@adeptofvoltron)*
- 🐛 Validate a recurring data-sync schedule's interval format on the field before submit, with a translated error, instead of round-tripping to the API and flashing a raw English scheduler error as a toast (#5872). (#6053) *(@adeptofvoltron)*
- 🌍 Make the activity-scheduling dialog's date and time pickers follow the app's locale for week start, month names and the 12/24-hour clock (#5942). (#6058) *(@adeptofvoltron)*
- 🐛 Render widgets registered on the customers module's declared `crud-form:customers.person`/`crud-form:customers.company` hosts inside the sales document's "Create person"/"Create company" quick-create dialogs, the last surfaces where they went dark (#6017). (#6063) *(@adeptofvoltron)*
- 🐛 Reject re-encrypting ciphertext already sealed under a different tenant key instead of nesting it into unrecoverable data and silently breaking its lookup hash (#5951). (#6067) *(@adeptofvoltron)*
- 🐛 Fix three extension runtime gaps: resolve registered DataTable transforms/wrappers at the render boundary, run after-interceptors in the handwritten `GET /api/catalog/categories` handler, and resolve a deal owner's label from the auth profile when the optional `staff` module is disabled. (#6077) *(@wojciechszyjka)*
- 🔄 Sweep orphaned `search_tokens` rows during a query-index reindex purge, so records no longer covered by the rebuild stop leaving queryable tokens with no presenter behind (#6072). (#6088) *(@pkarw)*
- 🔧 Make `communication_channels` declare `progress` as a required module dependency, so an app that enables it without `progress` fails fast at `yarn generate` instead of the import-history worker failing silently on every retry (#6094). (#6100) *(@adeptofvoltron)*
- 🐛 Make catalog product search accent-insensitive so a plain-ASCII query like `hustawka` also matches accented titles like `huśtawka`, including in the sales line-item product lookup (#6074). (#6103) *(@adeptofvoltron)*
- 🌍 Localize a notification's title and body in `NotificationDispatcher` before reactive handlers run, so toast/popup handlers that forward `notification.title`/`.body` show translated text instead of raw i18n keys. (#6104) *(@mobinea)*
- 🐛 Date ingested channel messages and their CRM interactions with the provider's timestamp instead of the ingest time. `messages.messages.compose` accepts a server-only `sentAt`, channel ingest passes the adapter's `timestamp` through it, the hub carries that timestamp on its `message.received` / `.sent` events, and the customers `link-channel-message` subscriber dates `CustomerInteraction.occurredAt` from it (falling back to the link's creation time). `POST /api/messages` strips a client-sent `sentAt`, so a browser caller cannot backdate a message. The MIME normalizer now prefers the provider's receipt time (`receivedAt`: Gmail `internalDate`, IMAP `INTERNALDATE`) over the sender-written `Date` header, and ignores a header that is unparsable or more than a day in the future, so a forged header cannot misplace a message. Before this a history import showed a 90-day mailbox as one block on the import day, in import order, and a person's activity timeline put every email on one date. (#6095). (#6115) *(@KamilMichalski0)*
- 🐛 Stop dropping inbound channel messages once their conversation is assigned. Ingest addresses an inbound message to the conversation's assignee, but the compose validator rejected any recipient on a public message, the worker classified the error as permanent, and every message after the first assignment (which a single reply from the panel triggers via `send-as-user`) was silently skipped. `messages.messages.compose` now takes a server-only `inboundFromChannel` flag that waives the recipients rule for channel-ingested messages; `POST /api/messages` strips a client-sent value, so user-composed public messages are validated exactly as before. Compose no longer forces email delivery for such a message (ingest passes `sendViaEmail: false`), and the `messages.new` notification the assignee now receives names the external correspondent rather than the channel's system user. (#6093). (#6116) *(@KamilMichalski0)*
- 🔄 Re-register a data-sync scheduled job when the flush that soft-deletes its `SyncSchedule` row fails, so a transient error no longer strands a live, enabled schedule with no backing job (#5999). (#6117) *(@adeptofvoltron)*
- 🐛 Fix the portal user admin page's Linked Person/Linked Company pickers to call the real customers API endpoints and read the real response field names, instead of 404ing silently or rendering a raw UUID (#5954). (#6124) *(@adeptofvoltron)*
- 🔄 Sort list results by a numeric custom field (`?sortField=cf_<key>`) in numeric order instead of lexicographic, and add a stable tiebreak so paginated results no longer repeat or skip rows (#5674). (#6126) *(@adeptofvoltron)*
- 🌍 Localize warranty_claims error responses raised from the command/lib layer, closing the last raw-i18n-key leak, and fix the same gap platform-wide in the shared CRUD factory's generic error handler (#5727). (#6130) *(@adeptofvoltron)*
- 📦 Stop a failed telemetry flush on CLI exit from overriding the command's own exit code, so a collector outage no longer fails an otherwise-successful `mercato` command run under `set -e`. (#6131) *(@jtomaszewski)*
- 🐛 Stop `LinkTemplateForm` money fields and `ProductUomSection` quantity fields from re-parsing and re-serializing the typed value on every keystroke, which dropped the in-progress decimal separator and corrupted locale decimals typed character by character (#5828). (#6136) *(@adeptofvoltron)*
- 🐛 Make `customers.manage_deal_comment` and `customers.manage_deal_activity` able to write to a deal. The comment tool populated `personEntity` / `companyEntity` on the deal link tables, relations the entities define as `person` / `company`, and filtered them by `tenantId`, a column the link tables do not have, so MikroORM rejected the lookup for every deal; the activity tool read a `deal.entity` field `CustomerDeal` does not have and always reported "no associated person/company". Both now resolve the timeline owner through the same link-table helper, queried by the already scope-checked deal id: primary linked person first, then the oldest person, then the oldest linked company, otherwise an instruction to link a contact. (#6119) (supersedes #6120). (#6156) *(@KamilMichalski0, via @pkarw)*
- 🐛 Let the standalone MCP server load API routes that import `next/server`. `mcp:serve-http` / `mcp:serve` / `mcp:dev` / `mcp:list-tools` run in plain Node, whose ESM resolver cannot resolve the bare subpath `next/server` (`next` ships no `exports` map), so every tool backed by such a route (287 route modules on 0.7.0, e.g. `customers.get_deal`, `customers.get_person`) failed with `Failed to load route module: Cannot find module '…/next/server'`. The `mercato ai_assistant` commands now install a `node:module` resolve hook that retries `next/<subpath>.js` after a failed bare `next/<subpath>`; it touches nothing else and steps aside once `next` resolves on its own. (#6118) (supersedes #6122). (#6157) *(@KamilMichalski0, via @pkarw)*
- 🐳 Fix `init-or-migrate.sh` so a failed migration on an already-seeded container restart exits with that failure status instead of silently reporting success and starting the app against a half-migrated database. (#6160) *(@adeptofvoltron)*
- 🐛 Stop the Upgrade Actions panel from offering — and the API from running — an upgrade action whose owning module is disabled (#6151). (#6161) *(@adeptofvoltron)*
- 📦 Make `yarn mercato seed:defaults` respect an app's `overrides.setup.seedDefaults: false` entry instead of silently seeding the module anyway (#6149). (#6162) *(@adeptofvoltron)*
- 🐛 Stop the message composer from forcing `sendViaEmail: true` for every public-visibility message, forwarding the "Also send via email" toggle's actual state like reply and forward already do (#6110). (#6163) *(@adeptofvoltron)*
- 🔄 Heal a reconnected Discord channel in place instead of creating a duplicate row: the connect command now derives channel identity from the adapter's own identifier, so reconnecting clears `requires_reauth` and heals the existing channel rather than leaving a stuck duplicate (#4977). (#6173) *(@wojciechszyjka)*
- 🐛 Route an inbound message on a per-user channel (Discord, Gmail, IMAP) to its owner when no assignee exists yet, so the channel owner actually sees inbound messages in their own Messages inbox (#6106). (#6186) *(@wojciechszyjka)*
- 🐛 Stop the product edit page from showing the "No options yet" empty-state hint when the product already has variants without an option schema (#6175). (#6211) *(@pidubiel)*
- 🌍 Give the customers module's website/LinkedIn/Twitter URL validators a localized error message key instead of Zod's raw English "Invalid URL" text. (#6212) *(@pidubiel)*
- 📦 Rewrite `node:`-prefixed builtin imports to their bare form for both webpack and Turbopack in create-app's scaffolded `transpilePackages` config, defensive hardening against a bundler resolution failure reported in issue #6132 that could not be reproduced. (#6213) *(@adeptofvoltron)*
- 🔐 Skip the portal ACL sync in `auth sync-role-acls` when `customer_accounts` is disabled, so `mercato init` no longer fails on deployments without the portal module. (#6225) *(@maxidragon)*
- 🐛 Accept dot-namespaced dictionary keys (e.g. `planner.unavailability-reasons.staff`) in `POST /api/dictionaries`, fixing an opaque HTTP 500 when creating most module-owned system dictionaries. (#6230) *(@lbajsarowicz)*
- 📦 Fix the standalone-app agent-manifest generator to emit public `@open-mercato/enterprise` type imports instead of monorepo-relative paths, fixing a `TS2307` compile error for scaffolded apps with the Agent Orchestrator enabled (#6236) (#6227). (#6253) *(@Sawarz)*
- 📦 Fix `@open-mercato/shared/lib/location/countries` import failing under Node ESM and an undeclared production dependency, by generating a committed `countries.generated.ts` instead of importing the registry's JSON at runtime (#6235). (#6254) *(@Sawarz)*
- 🔄 Refresh the query index after a `sales.orders.update`/`sales.quotes.update` custom-fields write, fixing stale `customValues` shown on the next list read (#6217). (#6255) *(@Sawarz)*
- 🐛 Convert CLI migration reindex imports to `file:` URLs on every platform so cwd-relative `node_modules/.../Migration.js` paths are no longer treated as bare package names and `queryIndexReindexEntityTypes` declarations are read after `db migrate`. (#6233, #6238). (#6259) *(@Sawarz)*
- 🐛 Thread `AbortSignal` through the `SEND_EMAIL`, `EMIT_EVENT`, `UPDATE_ENTITY` and `EXECUTE_FUNCTION` workflow activities, so an activity timeout now aborts them too instead of only `CALL_API`/`CALL_WEBHOOK` while the underlying work kept running unrecorded (#5148). (#6263) *(@Sawarz)*
- 🐛 Fall back to the auth-users roster, scoped to the active organization, for CRM owner columns, filters and the Change owner dialog when the optional `staff` module is disabled, instead of leaving the roster empty (#6183). (#6265) *(@Sawarz)*
- 🔐 Remove the legacy `credentials._client` OAuth fallback for Gmail token refresh, closing a defense-in-depth gap where client secrets could be smuggled in on a per-user blob instead of the hub-supplied `oauthClient` slot (#3828). (#6266) *(@Sawarz)*
- 🔐 Make the communication-channels OAuth `state` cookie single-use, closing a replay window where a captured cookie or replayed callback URL could re-drive the flow and create/reattach channels for up to five minutes (#3836). (#6267) *(@Sawarz)*
- 🔧 Add a stable `code` field (`DATABASE_ERROR`, `PERSISTENCE_ERROR`, `INTERNAL_ERROR`) to unexpected CRUD 500 responses, and give the transient-database 503 the same `requestId` correlation the 500 already has. (#6275) *(@lbajsarowicz)*
- 📦 Add the `integrations`, `channel_imap` and `channel_gmail` modules to the `crm` starter preset, so a CRM-preset scaffolded app can actually connect a mailbox in the Communications Hub instead of showing connect buttons that never exist (#6169). (#6296) *(@adeptofvoltron)*
- 💰 Stop inbox order/quote proposals from raising an unfollowable "configure a sales channel with a default currency" discrepancy for every email that doesn't state a currency, since sales channels have no such setting to configure (#6272). (#6298) *(@adeptofvoltron)*
- 🐛 Fix bigint-backed cost and byte-count columns (`AgentRun.costMinor`, `ProcessInstance.costMinor`/`subjectValueMinor`, attachment quota bytes) to hydrate as JS numbers, restoring cost and byte-count reporting that silently collapsed to zero (#6237). (#6299) *(@adeptofvoltron)*
- 🐛 Self-heal a missing `inbox_settings` row by bootstrapping it on `GET`/`PATCH /api/inbox_ops/settings`, so a tenant provisioned before `inbox_ops` existed no longer dead-ends on a generic "Failed to load settings" error. (#6300) *(@adeptofvoltron)*
- 🔧 Fix two catalog product-edit-page test suites that were failing on `develop` with `useLocale is not a function`, unblocking CI for every open PR. (#6317) *(@wojciechszyjka)*
- 🔧 Restore the `useLocale` export in the product edit page's test i18n mock, unbreaking the `test` CI check that was failing every PR touching `packages/core`. (#6319) *(@wojciechszyjka)*
- 📦 Fingerprint the standalone source-mirror files generator discovery actually reads, so the CLI generator correctly tracks source/dist authority transitions while preserving app override precedence. (#6352) *(@andrzejewsky)*
- 📦 Fix `yarn typecheck` failing in consuming apps the moment any enabled module ships a `runtime.ts`, by casting the generated registry's emitted runtime value to `Module['runtime']`. (#6356) *(@jtomaszewski)*
- 🌍 Let a host app's own locale file override a module-defined translation key: `loadDictionary` now merges the host app dictionary last, so it is authoritative instead of silently losing to a colliding module key (#5995). (#6364) *(@adeptofvoltron)*
- 🔧 Declare `progress` as a required dependency of `customers`, and add it to the `wms` starter preset, fixing deal bulk-update jobs that returned a 200 and then failed silently on every retry when `progress` wasn't enabled (#6302). (#6365) *(@adeptofvoltron)*
- 🐛 Release a failed encryption-map read from `TenantDataEncryptionService`'s in-flight cache so a transient database error no longer permanently breaks decryption for that entity/tenant/organization until the process restarts (#6334). (#6476) *(@adeptofvoltron)*
- 🔄 Add a 120-second deadline to coalesced channel credential refreshes, so a hung refresh (a token exchange whose response never settles) no longer stalls every later caller for that channel until the process restarts (#6333). (#6478) *(@adeptofvoltron)*
- 🌍 Give the Discord, Resend and Amazon SES permission groups in the role/user Access editor proper translated headings instead of a raw module id or hardcoded English text (#6369). (#6479) *(@adeptofvoltron)*
- 🐛 Fix undo failing with a MikroORM validation error for records whose snapshot includes a `Date` field (e.g. a scheduled activity's `occurredAt`), by reviving ISO date strings back to `Date` before they're assigned to entities (#6336). (#6483) *(@adeptofvoltron)*
- 🐛 Stop the activity schedule dialog from resetting a completed activity's status back to `planned` on every edit, which had re-opened done activities in conflict detection, AI tasks, and overdue counts (#6481). (#6484) *(@adeptofvoltron)*
- 🐛 Fix catalog product search, channel, category and tag filters returning zero results under "All organizations", by scoping their prequeries to the same multi-organization scope as the main list query instead of a single organization (#6466). (#6486) *(@adeptofvoltron)*
- 🌍 Translate the `Calendar` component's navigation arrows, caption and month/year grid aria-labels, and honor caller-supplied `labels.labelPrevious`/`labelNext`, so screen-reader users in a non-English deployment hear them in their own language (#6327). (#6487) *(@adeptofvoltron)*
- 🐛 Fix undoing a sales order or quote update wiping its custom fields, by restoring them under their real definition keys instead of writing a new `cf_<key>` row (#6449). (#6488) *(@adeptofvoltron)*
- 🐛 Stop custom notification renderers from re-executing an already-actioned notification's action; clicking it now just navigates to the action's own link, matching the generic renderer's behavior (#6436). (#6489) *(@adeptofvoltron)*
- 🐛 Opt `inbox_ops` e-mail extraction out of OpenAI's strict structured outputs, fixing every inbound e-mail failing with HTTP 400 under `OM_AI_PROVIDER=openai` because the extraction schema has optional fields OpenAI's strict mode rejects (#6287). (#6518) *(@adeptofvoltron)*
- 🐛 Stop saving an interaction from the calendar editor from rewriting participant status: a stored `accepted`, `declined` or `organizer` now survives an unrelated edit instead of being collapsed to `pending` (#6324). (#6519) *(@adeptofvoltron)*
- 🐛 Validate inbox action edits against the action type's registered `payloadSchema` instead of a private schema map, so an app that overrides an action type's payload shape can still edit its proposals (#6279). (#6520) *(@adeptofvoltron)*
- 🐛 Stop Escape from also cancelling the message composer when it only closed a nested dropdown (the "Action type" or "Send from" select), which previously discarded the unsent message (#6447). (#6522) *(@adeptofvoltron)*
- 🐛 Pass a channel's real, possibly-null `organizationId` to adapter `fetchHistory` calls instead of substituting the tenant id, so an adapter that scopes its own storage or provider queries by organization no longer looks in a bucket that doesn't exist (#6331). (#6633) *(@adeptofvoltron)*
- 📦 Fix the MCP tool registry loader to resolve a standalone app's `@/*` import alias against `src/` as its `tsconfig.json` declares, so `mercato ai_assistant mcp:serve-http` registers app module tools instead of silently falling back to Code Mode tools only (#6575). (#6635) *(@adeptofvoltron)*
- 🐛 Make the portal logo on public auth pages a full page load, so a signed-in customer clicking it lands on the dashboard instead of the logged-out landing page (#6362). (#6636) *(@adeptofvoltron)*
- 🐛 Collapse the communication channel profile table's six scattered per-row action buttons into a single row-actions menu, fixing clipped and unusable "Team access" controls once the table grew past roughly nine columns. (#6685) *(@WojciechSoczynskiTHEY)*
- 📦 Exclude the sandboxed `agent_examples` scripts and tools from the create-app template's `tsconfig.json`, fixing a fresh `create-mercato-app` scaffold failing `yarn typecheck` and `yarn build` with 18 errors out of the box (#6321). (#6695) *(@adeptofvoltron)*
- 🐛 Load the catalog price-kind currency selector's options from the currencies module's own API instead of the customers module, removing catalog's dependency on `customers.people.view` for what is a currencies concern (#6691). (#6696) *(@adeptofvoltron)*
- 🔐 Require `sales.documents.number.edit` to move the sales order/quote document-number counter, closing a path where `sales.settings.manage` alone let a user rewind a live sequence and produce duplicate document numbers (#6367). (#6698) *(@adeptofvoltron)*
- 🐛 Let the staff timesheet `CalendarPicker` take an optional reference date and follow the application locale, fixing "This week"/"Last week" and the "today" highlight disagreeing with the organization's calendar when a client's device clock is behind (#6325). (#6699) *(@adeptofvoltron)*
- 🔧 Add a shared `buildEncryptionMapBackfillSql` helper and a `db:generate` warning, so adding a field to an encryption map on an already-deployed module no longer silently leaves existing tenants writing it as plaintext with no backfill migration (#6701). (#6702) *(@kurrak)*
- 💰 Accept decimal variant prices (e.g. `19.95`) on the product create form instead of blocking submission on the browser's default integer step validation. (#6704) *(@AHKSammich)*
- 🐛 Reject a WMS cycle count whose negative variance would drive `quantity_available` below the stock already reserved or allocated, with `409 insufficient_stock`, closing the one stock-reducing path that let on-hand go negative against committed reservations. (#6706) *(@AHKSammich)*
- 🐛 Fix currency and exchange-rate delete to also read `id` from the request body, matching what the backend UI sends; previously every delete failed with 400 and nothing was removed. (#6713) *(@Sawarz)*
- 🐛 Validate a `SUB_WORKFLOW` step's output against the child's own declared ports before applying `outputMapping`, fixing a renamed output mapping that always failed with "Required port ... is missing" even though the child produced the value. (#6714) *(@AHKSammich)*
- 🐛 Fix 10 custom notification renderers (sales quotes/orders, proposals, checkout, warranty claims, WMS, conversations) to navigate to the record instead of silently re-posting an already-actioned action on every later click (#6436). (#6721) *(@Sawarz)*
- 🐛 Keep a `LookupSelect`'s hydrated selection visible when its empty-query browse fetch replaces the list, so a selected record outside the first page no longer appears unselected. (#6722) *(@mat-kruk)*
- 🔐 Fix "Inherit from selected scope" on the API key create page to omit `organizationId` instead of sending `null`, so the key follows the organization switcher instead of always becoming tenant-wide (#6732). (#6734) *(@kmrosiek)*
- 🐛 Forward an `id` to the deal-create form's status select so its "Status" label actually names the control, fixing a missing accessible name for screen readers and a label click that did nothing (#6425). (#6737) *(@adeptofvoltron)*
- 🐛 Show the standard localized optimistic-lock conflict bar, with a reload action, when toggling "Share with team" or "Make private" on a stale communication-channel tab, instead of a raw `record_modified` toast (#6720). (#6738) *(@adeptofvoltron)*
- 🐛 Make Escape on the message composer's "To" recipient suggestions close only that list, instead of discarding the whole draft (#6682). (#6739) *(@adeptofvoltron)*
- 🐛 Restore the "Add task" action on the legacy company and person detail pages' Tasks tab, fixed by moving the action reset into the tab-change handler instead of a child/parent effect race that wiped it (#6358). (#6740) *(@adeptofvoltron)*
- 💰 Page through all order and quote lines in the sales document Items section instead of loading only the first 100, so a document with more than 100 lines shows every line and matches its totals (#6460). (#6741) *(@adeptofvoltron)*
- 🔧 Make `yarn mercato test:ephemeral`/`test:integration` ignore a placeholder `JWT_SECRET` inherited from a freshly copied `.env.example` and fall back to a safe ephemeral default, instead of refusing to boot the app (#6747). (#6748) *(@kurrak)*
- 🐛 Render a `KpiCard`'s `footer` prop in its empty state too, instead of silently dropping it when the value is null. (#6753) *(@michalper)*
- 🔧 Fix `detect-locale-narrowed.test.ts` to clear the locale registry in `beforeEach`, removing a flake where its result depended on which sibling suite ran first in the same Jest worker. (#6754) *(@michalper)*
- 🐛 Give each phone country option a plain `textValue` of just its localized name, so typing letters in the open country picker jumps to a matching country instead of doing nothing because the searchable text started with a flag emoji. (#6756) *(@kmrosiek)*
- 🐛 Stop a multi-file upload retry from re-uploading files the server already saved and from hiding them until a page reload, fixing duplicate attachments in the library dialog and a dropped-file race in the record Files tab after a partial failure (#6397). (#6772) *(@AHKSammich)*
- 🐛 Fix the communication channels hub test-send failing with a raw 502 for tenant-wide system email channels (SMTP, SES, Resend) created by the env preset, by resolving their provider credentials even without a `credentials_ref`. (#6778) *(@adeptofvoltron)*
- 🔧 Map `test-seed`'s `ingest-inbound` action failures to structured JSON error responses instead of an empty 500 body, matching every neighbouring case in the same route (#6392). (#6779) *(@adeptofvoltron)*
- 🐛 Normalize the recipient field to an address list at the send boundary in the SES and Resend channel adapters, fixing every test-send through those providers failing with "Email send requires at least one recipient" because they only accepted an array. (#6781) *(@adeptofvoltron)*
- 🔄 Pass a communication channel's real organization — not the tenant id substituted in its place — to push-notification and reaction adapters in the Gmail history-sync and reaction-processor workers (#6634). (#6782) *(@adeptofvoltron)*
- 🐛 Fix undo failing with a 400 for any person or company with a planned next-interaction date, by reviving the snapshot's `nextInteractionAt` back to a `Date` before the undo handler assigns it (#6336). (#6784) *(@AHKSammich)*
- 🐛 Fix saving a single-value custom field to collapse an echoed-back array payload to one value, healing pre-existing duplicate per-organization rows instead of re-creating them on every form save (#6468). (#6787) *(@adeptofvoltron)*
- 📦 Generate one dynamic `import()` per web-research adapter and skip any package not installed where the registry runs, fixing every worker, scheduler and CLI process crashing with `ERR_MODULE_NOT_FOUND` — which was silently skipping all app-level DI registrations — on a production image built with `yarn workspaces focus`. (#6788) *(@adeptofvoltron)*
- 🐛 Make `GET /api/version` report the installed `@open-mercato` platform version, adding `platform` and `app` fields, instead of the deployment shell's own `package.json` version, which could drift behind it (#5380). (#6790) *(@adeptofvoltron)*
- 🐛 Stop a partial `PUT` on an organization (e.g. saving just a branding logo) from detaching it from its parent and children, by applying `parentId`/`childIds` only when present in the input. (#6791) *(@AHKSammich)*
- 🌍 Fix the product Units of Measure section to show one locale-formatted preview per conversion row, removing a duplicate line that always printed a dot decimal separator regardless of locale (#6313). (#6793) *(@adeptofvoltron)*
- 🐛 Run the `sync_excel` upload and import endpoints through the platform mutation-guard registry, so a registered guard like a record lock or approval gate can now block, rewrite the payload of, or react to these writes, which previously bypassed every guard (#3312). (#6794) *(@adeptofvoltron)*
- 🔐 Scope checkout pay-link and pay-link-template undo/redo lookups to the caller's own tenant and organization, so a weaker-scoped upstream regression can no longer let an admin undo or redo another tenant's record (#3831). (#6795) *(@adeptofvoltron)*
- 🐛 Stop notification emails from being pinned to the `.env.example` placeholder sender (`ops@your-domain.com`) forever once seeded, so the configured `NOTIFICATIONS_EMAIL_FROM` is honored again (#5444). (#6796) *(@adeptofvoltron)*
- 🔧 Fix a flaky local-queue directory-recreation regression test that raced an unbounded polling loop against a fixed timeout, making filesystem-watcher rewake coverage reliable under slow CI I/O (#6775). (#6817) *(@haxiorz)*
- 🌍 Reject unparseable numeric input (e.g. `abc`, mixed decimal separators) with a localized error on checkout price-list fields and catalog unit-of-measure fields, instead of silently saving 0 or showing Zod's raw English message (#6311). (#6822) *(@adeptofvoltron)*
- 🐛 Fix OpenAI-compatible AI agent presets (DeepInfra, Groq, Together, Fireworks, OpenRouter, LiteLLM, Ollama, LM Studio, Requesty) to call the Chat Completions endpoint instead of the Responses API those backends don't implement, which made every agent chat turn fail with a 404 (#4638). (#6826) *(@adeptofvoltron)*
- 🔐 Fail closed when no auth token secret is configured outside `development`/`test`, instead of silently hashing session-refresh and password-reset tokens with a public dev-only secret in staging, preview, or QA (#2248). (#6831) *(@adeptofvoltron)*
- 🐛 Make the import-history route's documented OpenAPI schema read from the same env-driven schema used for validation, so the two can no longer drift after an `OM_IMPORT_HISTORY_MAX_*` change, and document that Gmail's `importHistory` only sweeps the INBOX label (#6273). (#6832) *(@adeptofvoltron)*
- 💰 Stop undoing an order-level action from hard-deleting shipments, payments, notes, tags and returns recorded on the order afterward, which could silently destroy later work or fail with a foreign-key violation partway through. (#6833) *(@AHKSammich)*
- 🐛 Fix a time entry billed on two closed reports (via "include already reported") disappearing from one report's sheet/exports, and being unlocked for editing while the other closed report still quotes it. (#6840) *(@AHKSammich)*
- 🐛 Restore the sibling address that was demoted to non-primary when undoing a customer address create or update, instead of leaving the customer with no primary address at all. (#6841) *(@AHKSammich)*
- 🐛 Stop the KMS derived-key fallback warning from logging a truncated fingerprint of the fallback secret, removing a deterministic verifier that could support offline candidate testing (#2241). (#6847) *(@pkarw)*
- 🔄 Fire embedded workflow event triggers only from a definition's latest published version, fixing duplicate instance starts and triggers that kept firing from older, superseded versions. (#6855) *(@AHKSammich)*
- 🐛 Remove the duplicated Add action button on customer Deals and company People tabs, keeping one Add button beside Link existing across classic and v2 pages (#6859). (#6874) *(@haxiorz)*
- 🐛 Show an informational message on Organization Branding instead of a loading failure when "All organizations" is selected, since the branding endpoint requires a single organization (#6860). (#6875) *(@haxiorz)*
- 🐛 Restore a saved view's advanced filter on Companies, People, and Deals when revisited through a bare sidebar URL, fixing a view that showed as selected while the list stayed unfiltered (#6870). (#6877) *(@haxiorz)*
- 🐛 Surface the server's refusal message when linking a person or company to a deal is rejected, and keep the linking dialog open for retry instead of showing a generic error and closing as though the save succeeded (#6871). (#6878) *(@haxiorz)*
- 📦 Bump the create-app template's stub `yarn.lock` to metadata version 10, matching the pinned Yarn 4.17.1, fixing `yarn setup` failing immediately after scaffolding a new app with `npx create-mercato-app` (#6849). (#6879) *(@adeptofvoltron)*
- 🐛 Fix the docs site's sitemap, canonical links and `og:url` advertising the dead `docs.open-mercato.dev` host instead of the live `docs.openmercato.com`. (#6880) *(@adeptofvoltron)*
- 📦 Fix `om-start` to rebuild workspace packages after `generate`, so a fresh clone no longer crashes with `ERR_MODULE_NOT_FOUND` on `packages/core/dist/generated`; re-running the starter now also repairs an already-broken checkout (#6848). (#6881) *(@adeptofvoltron)*
- 🐛 Keep keyboard focus trapped inside the calendar's month/year selector, fixing Tab from moving focus to the hidden day grid underneath and raising a covered day number visually above the month tiles (#6853). (#6884) *(@haxiorz)*
- 🐛 Allow grouped quantities (e.g. `1 234,56`) to be typed into the product creation wizard's units-of-measure fields instead of stripping the grouping space on every keystroke (#6312). (#6888) *(@haxiorz)*
- 🌍 Localize the 39 built-in unit-of-measure labels on the catalog product create and edit forms, which previously always showed English names regardless of the active language (#6315). (#6889) *(@haxiorz)*
- 🐛 Update the communication-channel share-conflict regression test to open the row-actions menu for "Share with team", fixing 2 failing tests left after an earlier PR moved that action out of the visibility column (#6886). (#6904) *(@adeptofvoltron)*
- 🐛 Escape LIKE metacharacters after unaccenting a product search term, fixing fullwidth `％`/`＿`/`＼` characters from folding into live SQL wildcards and matching the entire catalog instead of the literal text (#6465). (#6905) *(@adeptofvoltron)*
- 🔧 Pin the clock in the Gmail client's HTTP-date `Retry-After` test so it stops failing intermittently on loaded CI runners (#6437). (#6908) *(@adeptofvoltron)*
- 🔧 Scope the CI dependency audit to a PR's own net changes and compare advisories against a baseline lockfile, so a PR no longer fails on unrelated `develop` drift or pre-existing advisories it didn't introduce. (#6919) *(@patzick)*
- 💰 Recalculate order and quote line (and document header) gross totals whenever quantity, price, discount or tax rate changes, fixing a stale gross total left behind by a pricing edit that only recomputed net (#6459). (#6923) *(@haxiorz)*
- 🔐 Scope the message-reactions response enricher to the caller's own participant messages, so a non-participant in the same organization can no longer see another channel thread's reactor names and ids (#3834). (#6927) *(@adeptofvoltron)*
- 🔐 Bind the queued catalog bulk-delete worker's command context to the job's tenant, so tenant scope is enforced on every delete instead of relying only on organization ids being globally unique (#3826). (#6928) *(@adeptofvoltron)*
- 🔄 Exclude audit-log entities from search-token generation, stopping index rebuilds from exploding serialized snapshots and ciphertext into millions of stray token rows (#6182). (#6929) *(@haxiorz)*
- 🌍 Translate the `DATABASE_URL` System Status label and description in every shipped locale instead of showing the raw i18n key (#6952). (#6959) *(@adeptofvoltron)*
- 💰 Scope the Akeneo importer's offer/price reconciliation to the variant being imported, so importing one product variant no longer deletes its siblings' prices and shared offers. (#6974) *(@AHKSammich)*
- 🐛 Make the WMS Operational dashboard's low-stock KPIs, the "View low stock" balance filter, and the `wms.inventory.low_stock` event honor product-level inventory profiles as a fallback, fixing a variant governed only by a product-level profile showing zero low-stock signal everywhere (#6941). (#6982) *(@adeptofvoltron)*
- 🐛 Fix the staff time-tracking report page and its PDF/XLSX/CSV exports to show the actual report period instead of a blank dash, caused by MikroORM hydrating `date` columns as strings where the code expected a `Date` (#6975). (#6984) *(@adeptofvoltron)*
- 🐛 Fix the dev runtime diagnostics banner's close button closing an open dialog or panel underneath it instead of the banner itself (#6979). (#6986) *(@adeptofvoltron)*
- 🐛 Advance a company's `updated_at` on profile-only and custom-field-only edits (and their undo), so a concurrent stale save gets the conflict bar instead of silently overwriting another user's legal name, domain, revenue or industry change (#7033). (#7040) *(@wojciechszyjka)*
- 🐛 Persist edits to existing encrypted company profile fields (legal name, brand name, domain, website, industry), which returned 200 but reverted on reload because the update loaded its before-snapshot on the shared request EntityManager (#7032). (#7047) *(@wojciechszyjka)*
- 🔧 Extend the TC-PLAN-005 integration test timeout to cover its 105-fixture setup and cleanup, which failed `main` CI after every assertion had passed. (#7052) *(@patzick)*
- 💰 Show the price kind actually stored on a catalog price rule in its edit form instead of the tenant's first kind, which invited an admin to re-save the rule into a different price list (#7059). (#7065) *(@wojciechszyjka)*
- 🐛 Fix the Forms Submissions page and its submission drawer crashing with "Something went wrong" for any versioned form, by reading the flat form-detail and revisions responses the page actually receives (#7062). (#7066, #7113) *(@wojciechszyjka)*
- 🐛 Show the server's reason when a customer group delete is refused (for example, members in an organization outside the caller's scope) instead of a generic "Could not delete" flash (#7060). (#7071) *(@wojciechszyjka)*
- 🐛 Keep pinned DataTable action columns beneath the sticky backend top bar on scroll, instead of painting over the organization switcher and top-bar icons (#7063). (#7072) *(@wojciechszyjka)*
- 🐛 Show the not-found state instead of an unrecoverable 403 "Forbidden" after undoing a document's creation, for the document's owner or a `documents.manage` holder (#7064). (#7075) *(@patzick)*
- 🌍 Translate forms audit-log action labels at log time instead of storing 20 raw i18n keys that never existed in any locale (#7087). (#7091) *(@wojciechszyjka)*
- 🐛 Stop the product edit page stealing keyboard focus — and scrolling down — to the first custom attribute field a few seconds after it opens (#7088). (#7092) *(@wojciechszyjka)*
- 🔐 Add the missing staff `DELETE` route behind the customer user detail page's "Revoke" session button, which always failed and left the customer signed in; scoped to the caller's tenant and organization and gated by `customer_accounts.manage` (#7086). (#7093) *(@wojciechszyjka)*
- 🌍 Translate every category heading on the notification delivery settings page, including the enterprise `agent_orchestrator` and `record_locks` categories, and fold the `security.*` notification types into the existing Security group instead of showing raw module ids (#7089). (#7094, #7115) *(@wojciechszyjka, @patzick)*
- 🐛 Save the Settings → Dictionaries create/edit dialog on Ctrl/Cmd+Enter, which previously did nothing (#7090). (#7106) *(@wojciechszyjka)*
- 🔧 Point the dev runtime health probe at the port Next.js actually bound, so the "Runtime degraded" banner no longer fires with a 404 when port 3000 was taken. (#7107) *(@patzick)*
- 🔐 Make catalog product and category bulk-create refuse a rejected, foreign or "All organizations" selection like single create does, instead of answering 202 and writing every row into the caller's home organization (#7076). (#7108) *(@wojciechszyjka)*
- 🐛 Let customer group terms managers pick a price kind and see explain-terms price labels without `catalog.settings.manage`, which previously left the picker empty and replaced "Commercial terms saved." with an access-denied flash (#7077). (#7109) *(@wojciechszyjka)*
- 🐛 Raise the conflict bar on a concurrent first save of a customer group's commercial terms instead of letting the second save overwrite the first (#7078). (#7110) *(@wojciechszyjka)*
- 🐛 Announce availability check errors and results to screen readers via an alert and a status live region (#7079). (#7112) *(@wojciechszyjka)*
- 🐛 Handle "All organizations" in availability policy create and list: create now shows a translated "pick an organization" message instead of failing silently, and the list returns policies from every organization in scope rather than only the home one (#7080). (#7114) *(@wojciechszyjka)*
- 🌍 Translate the forms "invalid key" validation message, which rendered as the raw `forms.errors.invalid_key` string, and guard every `forms.errors.*` key against going untranslated (#7141). (#7146) *(@patzick)*

## 🛠️ Improvements
- 🛠️ Run the lucide icon registry drift guard as an unfiltered CI step (`yarn ui:icons:check`) so turbo's package filter can no longer skip it on the PRs that cause the drift (#5657). (#5651) *(@wojciechszyjka)*
- 🛠️ Keep the data-sync heartbeat ticking across the whole consumer body between batches, not just while fetching, so slow bookkeeping no longer risks a healthy sync job being marked stale and flipped to failed (#5370). (#5769) *(@adeptofvoltron)*
- 🛠️ Throttle slow response-enricher error logging to one per 30-second window, with the suppressed count and max elapsed time, instead of one per slow request, and emit enricher duration through telemetry as `om.enricher.duration` (#5782). (#5794) *(@haxiorz)*
- 🛠️ Add opt-in coalescing of `clientBroadcast` SSE browser deliveries for bulk writers via a new `broadcastCoalescing` event field, opted into `catalog.product.{created,updated,deleted}`, so a bulk write stops paying one `pg_notify` roundtrip and tenant-wide fan-out per record while other subscribers still fire once per record. (#5896) *(@adeptofvoltron)*
- 🛠️ Migrate five read-only staff time-tracking tables from raw HTML `<table>` markup to the shared `DataTable` component (or DS `Table` primitives) for design-system compliance. (#6129) *(@adeptofvoltron)*
- 🛠️ Index `sales_payment_allocations` by `order_id` (and `invoice_id`), eliminating a full-table scan on every payment create, update and delete that recomputes an order's payment totals on large installations. (#6148) *(@jtomaszewski)*
- 🛠️ Let a module extension host declare `source` as an array of files, not just one string, so a host mounted from multiple files can record its full provenance in generated module facts (#6003). (#6219) *(@adeptofvoltron)*
- 🛠️ Cache active webhook subscriptions per tenant in the outbound-dispatch subscriber, so a tenant with no webhooks (the common case) no longer pays a decrypting `SELECT` on every event. (#6276) *(@lbajsarowicz)*
- 🛠️ Cache positive `information_schema.tables` existence checks across requests for the data engine's storage table and the query-index base-table probes, removing a repeated schema probe paid on every request since both engines are rebuilt per request container. (#6277) *(@lbajsarowicz)*
- 🛠️ Defer sales dictionary, example-data, and sales-channel seed imports until their setup paths actually run, cutting eager import cost while keeping seed ordering and failure propagation unchanged. (#6351) *(@andrzejewsky)*
- 🛠️ Stop the standalone generator from watching a fictitious `node_modules/@app` package root and bound its CSS checksum computation to a finite, validated set of manifest/module-path inputs, cutting unnecessary watch work. (#6353) *(@andrzejewsky)*

## 📝 Specs & Documentation
- 📝 Replace the SPEC-029 ecommerce monolith with a scoped suite of module specs, an ADR-backed roadmap, and updated promotions/checkout specs. (#5384) *(@adeptofvoltron)*
- 📝 Specify server-side column sorting for the customer users table, including the encrypted `Name`/`Email` columns, reusing the platform's existing bounded decrypt-then-sort primitives. (#5699) *(@adeptofvoltron)*
- 📝 Land the recovered `2026-06-03` enterprise performance & stability hardening spec at the path fifteen open issues cite, annotated to mark it a research roadmap rather than a ready-to-implement spec. (#5777) *(@haxiorz)*
- 📝 Add a spec for coalescing SSE fan-out on bulk writes to `clientBroadcast` events via an opt-in `broadcastCoalescing` flag, so an open DataTable refreshes a few times per second during a bulk import instead of once per row. (#5895) *(@adeptofvoltron)*
- 📝 Document that search-token truncation under `maxTokensPerRecord` depends on the document's key order, and that `search_text` is dropped first on an over-budget record, with guidance to rebuild via `buildIndexDocument`. (#6064) *(@adeptofvoltron)*
- 📝 Add a spec proposing an optional `listDocumentIds` method on `FullTextSearchDriver`/`FullTextSearchStrategy` to enumerate indexed document IDs per entity and tenant without hitting Meilisearch's `maxTotalHits` search cap. (#6127) *(@adeptofvoltron)*
- 📝 Align `UPGRADE_NOTES.md`'s `0.7.0 → 0.8.0` window date with `CHANGELOG.md`'s release date, fixing the upgrade-notes date-consistency test on `develop` and `main`. (#6256, #6360) *(@adeptofvoltron, @patzick)*
- 📝 Add the assisted-selling spec — AI or human sales-rep product suggestions accepted line-by-line into a separate proposal cart that merges into the buyer's basket — and update the cart, roadmap and storefront specs to match. Design-only, no code. (#6346) *(@adeptofvoltron)*
- 📝 Add the offline "field mode" spec, splitting disconnected order assembly into a server-built offline pricing pack and a client-side intent outbox with no offline checkout. (#6349) *(@adeptofvoltron)*
- 📝 Add Commerce Weavers, Itrix, The Good Code, Fast White Cat and they.dev contributor accounts to the certified-partner registry so they can use `/label` on pull requests. (#6372, #6390, #6707, #6797, #6851) *(@matgren, @janzaremski, @adeptofvoltron)*
- 📝 Add the spec for assigning CRM deal ownership from the deal detail view and both creation paths — today ownership is writable only from the Pipeline board's bulk-actions bar — reusing existing write paths with no schema or API change. Design-only. (#6441) *(@WojciechSoczynskiTHEY)*
- 📝 Add the spec for admin-configurable calendar activity types, letting enabled modules add or modify types through headless widget injection and attach custom React panels (e.g. a `Visit` type that checks staff/resource availability before save). (#6687) *(@pkarw)*
- 📝 Add the App Spec for a reusable, cross-process-safe OAuth2 grant-lifecycle core in the `integrations` module, covering PKCE-protected token exchange, locked refresh and a trustworthy reconnect signal. (#6692) *(@mikolajbogusz-they)*
- 📝 Add a spec for enabling a whole module suite (starting with the ecommerce suite) in a standalone app in one step: a `requires`-aware multi-module `enable`, a post-install `module setup` command, and declared module sets. (#6705) *(@adeptofvoltron)*
- 📝 Rewrite the README around a real four-stage app build (Kaldi & Co.) with measured timings and product shots, moving monorepo setup to CONTRIBUTING.md and the Hall of Fame to COMMUNITY.md. (#6762) *(@wojciechszyjka)*
- 📝 Add the spec for an opt-in strict attachment storage-validation policy that rejects invalid partitions, drivers or configuration before any storage side effect. (#6819) *(@haxiorz)*
- 📝 Add the spec for owner-scoped attachment access resolvers, letting modules like Documents restrict attachment access beyond tenant/organization scope to only shared recipients. (#6828) *(@haxiorz)*
- 📝 Specify deduplicating the "Add" action that rendered in both the tab header and the section body on customer detail tabs, keeping `Add deal`/`Add person` beside their respective linking actions (#6859). (#6873) *(@haxiorz)*
- 📝 Add the spec for an accurate merged Tasks total on customer person/company overview responses, so the badge counts tasks created through the todo adapter instead of only `counts.todos`. (#6885) *(@haxiorz)*
- 📝 Add the spec for deployment-owned, environment-selected seed profiles that override module defaults consistently across installation, reseeding, auth setup and onboarding. (#6955) *(@pkarw)*

## 👥 Contributors

- @jtomaszewski
- @adeptofvoltron
- @WojciechSoczynskiTHEY
- @haxiorz
- @lbajsarowicz
- @maxidragon
- @kurrak
- @pkarw
- @KamilMichalski0
- @patzick
- @wojciechszyjka
- @pat-lewczuk
- @mobinea
- @pidubiel
- @Sawarz
- @andrzejewsky
- @AHKSammich
- @mat-kruk
- @kmrosiek
- @michalper
- @matgren
- @janzaremski
- @mikolajbogusz-they

---

# 0.8.0 (2026-09-18)

## Highlights

Open Mercato 0.8.0 is led by the **Agent Orchestrator**: a full runtime for AI agents that can never write domain state directly — an agent only returns a proposal, and every mutation it suggests flows through `proposal → disposition (human approval, or an auto-approval policy under a confidence threshold) → effector` before anything actually executes. Around that model ship runs, traces, evals and guardrails, a cockpit and caseload UI, file-defined OpenCode agents, and `INVOKE_AGENT` support from workflows, together with the workflow-editor and business-process/workflow-unification work it builds on. It is joined by three more substantial modules: a **staff time-tracking suite** (demo data, project dashboards, a keyboard-driven task picker, and RBAC/UX hardening), a **phone_calls core hub with a Tillio provider**, and a **collaborative internal documents module** (TipTap + Yjs + Hocuspocus co-editing, folders, sharing, comments, version history, DOCX/PDF export). Communications gain a **Discord channel provider** with two-way Gateway messaging and opt-in AI auto-reply, and outbound system email now routes through the Communications Hub via **pluggable provider packages** (`@open-mercato/channel-resend`, `@open-mercato/channel-ses`) — a standalone app must enable the matching package or outbound email stops; see [`UPGRADE_NOTES.md`](UPGRADE_NOTES.md).

**Sales and CRM correctness gets real attention.** Sales line `discount_amount` was silently compounding on every recalculation of a discounted multi-quantity line; the column's meaning is now normative and read-path-corrected, with a `discountAmountBasis` escape hatch for callers that already post whole-line amounts. The CRM lost-deal status is now canonically spelled `lost` rather than `loose`, and deal status filtering, closure and the AI mutation-approval card all resolve through one shared vocabulary instead of disagreeing across the list view, Kanban board and AI tool. Both are deliberate, reviewed upgrades — read the matching `UPGRADE_NOTES.md` entries before deploying.

**A second security pass, this time centered on the CRM and customer-data surface**, closes a password-only MFA bypass on general staff APIs, an organization-scoping gap on legacy activities and deal-analyzer links, a domain-registration cross-tenant hole, a signup response/timing oracle that disclosed existing accounts, an interactions-list field that leaked ciphertext outside its declared encryption map, and a KMS-outage window that could leave encrypted writes falling open to plaintext. Search gets more precise too — tokenization now folds `ł`, `ø`, `đ` and the rest of the Latin letters NFKD leaves untouched, so names like `Łukasz` or `Guðmundsdóttir` are findable from either spelling (affected records need a reindex).

Platform plumbing rounds out the release: `entry.overrides` in `src/modules.ts` now actually dispatches in CLI, worker and scheduler processes, not just the Next.js runtime; a new module `runtime.ts` start hook lets a module run and gracefully stop a process-wide worker loop with zero host wiring; `makeCrudRoute` list routes stop silently dropping repeated query parameters; and recorded errors are now reported to the telemetry backend rather than only written to logs. Locale handling becomes extensible — `Locale` derives from an augmentable registry, so a downstream app can serve a language the platform doesn't ship without patching any `@open-mercato/*` package. Enjoy!

## ✨ Features
- ✨ Make the served locale set extensible by downstream apps — an application (or a tenant administrator, from Settings → Module Configs → Translations) can now serve a language the platform does not ship, without patching any `@open-mercato/*` package. `Locale` is derived from an augmentable `LocaleRegistry` interface instead of a closed union, a `globalThis` registry owns the runtime set, and an added locale falls back to the default-locale dictionary instead of rendering raw keys. **Type-compatibility note:** the published `Locale` type only ever *widens*, and only when an application opts in — unaugmented it resolves to exactly the same five-member union as before, so existing exhaustive `Record<Locale, …>` maps keep working unchanged. No new language is added by this change; the shipped set remains `en, pl, es, de, ko`. The tenant selection now reaches the admin language switcher itself, `GET /api/translations/locales` additionally reports which locales the application can render its own UI in (`servable`), and the settings screen says when an added language affects content only or when the default language cannot be removed, and lists the effective served set rather than the raw stored selection. `POST`/`GET /api/auth/locale` now validate against the caller's own tenant selection, so a locale that tenant does not serve returns `400` instead of reporting success and setting a cookie every later page render silently discards. See `.ai/specs/2026-09-03-extensible-locale-set.md`. (#5887) *(@Frshy)*
- ✨ Add a Discord channel provider for two-way communication, with real-time Gateway inbound, a signed Interactions endpoint, and opt-in AI auto-reply. (#4391) *(@wojciechszyjka)*
- ✨ Add pluggable outbound email providers (Resend and Amazon SES) routed through the Communications Hub, with tenant-scoped credentials and delivery safety controls (supersedes #2448). (#4471) *(@pmadajthey, via @pkarw)*
- ✨ Add a collaborative internal documents module with realtime co-editing (TipTap + Yjs + Hocuspocus), folders, sharing, comments, version history, and DOCX/PDF export. (#4561) *(@haxiorz)*
- ✨ Declare ACL feature dependencies for auth so AclEditor warns when a granted feature is missing its prerequisites. (#2144). (#5290) *(@Paul-Mlodochowki)*
- ✨ Add NotesSection props to force the rich markdown editor and hide the appearance controls. (#5150). (#5325) *(@adeptofvoltron)*
- ✨ Preselect the sole warehouse and round-trip custom fields in the WMS zone dialog. (#5239). (#5334) *(@Paul-Mlodochowki)*
- ✨ Share a single CrudForm warehouse dialog between create and edit, with searchable country/timezone lists and custom fields. (#5238). (#5339) *(@mkadziolka)*
- ✨ Render channel names on the sales documents list and let the Channel filter select several channels at once. (#5351) *(@maxidragon)*
- ✨ Ship the staff time-tracking suite: demo data, project dashboards, a keyboard-driven task picker, and RBAC/UX hardening across timesheets and reports. (#5427) *(@pat-lewczuk)*
- ✨ Add the phone_calls core hub and the Tillio provider (supersedes #5066). (#5627) *(@MateuszBilant, via @haxiorz)*
- ✨ Turn the dev splash into a full runtime feedback loop — classified failure incidents, an in-app diagnostics banner and an opt-in local dev gateway. (#5710) *(@patzick)*
- ✨ Add the propose-only agent orchestrator runtime — runs/proposals, traces, evals and guardrails, the cockpit and caseload UI, file-defined OpenCode agents, `INVOKE_AGENT` from workflows — plus the workflow-editor and business-process/workflow-unification work it depends on. (#5718) *(@pat-lewczuk)*
- ✨ Give a saved address a phone and the tax id it was invoiced under (supersedes #5616). (#5771) *(@kamwro)*
- ✨ Let adapters declare which start controls apply to the data-sync dashboard's Run once now card. (#5863) *(@maxidragon)*
- ✨ Report recorded errors to the telemetry backend, establishing that any catch which records an error (dead-letters, failed status, fallback) must also call `reportError`. (#5960) *(@jtomaszewski)*
- ✨ Add a module runtime start hook (`runtime.ts`) so a module can start and gracefully stop a process-wide worker loop, broker subscription or poller with zero host wiring, starting from `mercato queue worker --all` (SPEC-072). (#6057) *(@jtomaszewski, @maxidragon)*
- ✨ Developer-ready component library, DS primitives and SSE heartbeat fix. (#6199) *(@zielivia)*
- ✨ Enable the Agent Orchestrator + OpenCode agents in standalone apps. (#6208) *(@pat-lewczuk)*

## 🔒 Security
- 🔒 Raise Yarn's npm minimal-age gate from 1 day to 5 days to close the supply-chain window for compromised-maintainer package publishes. (#5138) *(@zawoj)*
- 🔒 Reject MFA-pending tokens from general staff APIs, closing a deterministic password-only authentication bypass. (#5453) *(@haxiorz)*
- 🔒 Restrict scheduler queue targets to authorized safe workers (#5213). (#5455) *(@haxiorz)*
- 🔒 Harden MFA emergency bypass with audit logging (#3856). (#5458) *(@haxiorz)*
- 🔒 Scope deal-analyzer person links to tenant/org via the deal map (#3842). (#5459) *(@haxiorz)*
- 🔒 Enforce organization scoping on the legacy activities list (#3841). (#5462) *(@haxiorz)*
- 🔒 Redact rule condition and entity values from debug logs (#3822). (#5463) *(@haxiorz)*
- 🔒 Reject domain registration for organizations outside the caller's tenant (#3839). (#5464) *(@haxiorz)*
- 🔒 Enforce per-entity ACL in the legacy AI search tool pack (#5211). (#5465) *(@haxiorz)*
- 🔒 Fail closed on collapsed organization scope for customer todos and tasks (#5466). (#5469) *(@Duang777)*
- 🔒 Match check-phone through the decryption path (#3840). (#5492) *(@haxiorz)*
- 🔒 Stop public signup from disclosing whether an email already has an account, closing every response, timing and pending-request oracle. (#5677) *(@adeptofvoltron)*
- 🔒 Decrypt every field declared in an interaction's encryption map on the interactions list instead of only `title`/`body`, so extending the map no longer leaks ciphertext to the API (#5945). (#6021) *(@adeptofvoltron)*
- 🔒 Re-check KMS health on every encrypted write instead of gating the tenant-encryption subscriber's registration once at boot, so a KMS outage overlapping process startup no longer leaves writes falling open to plaintext for the rest of the process lifetime (#5948). (#6065) *(@adeptofvoltron)*

## 🐛 Fixes
- 🐛 Deduplicate linked customer/person/company results returned by global search. (#5073) *(@szymon-sapiecha)*
- 🐛 Restore the collapsed section-navigation sidebar on the CRM deal detail page (#5101). (#5139) *(@haxiorz)*
- 🔧 Raise the AI agent harness release gate's default per-case timeout from 120s to 600s so passing routing runs stop being misreported as timeouts. (#5180) *(@wojciechszyjka)*
- 🐛 Honor a command interceptor's explicit HTTP status on every direct commandBus route, not just `makeCrudRoute` handlers (#5097). (#5181) *(@wojciechszyjka)*
- 🌍 Format money and dates in the application locale instead of the browser/OS default, and pin Intl assertions in tests so `yarn test` is locale-independent (#5105). (#5182) *(@wojciechszyjka)*
- 🐛 Give `useRegisteredComponent` a stable component identity so a subtree re-renders instead of remounting when a registry populates or a feature grant arrives. (#5187) *(@wojciechszyjka)*
- 🐛 Render the sales order lines validation error once instead of twice, while keeping its screen-reader announcement (#5126). (#5188) *(@wojciechszyjka)*
- 🔧 Budget the AI agent harness release gate's deterministic step independently of the per-model case timeout, so a hung model-free pass fails in minutes instead of tens of hours (#5184). (#5190) *(@wojciechszyjka)*
- 🔐 Bind enterprise sudo challenges to their initiated target, scope, and policy so a weaker-verified session can no longer authorize a stronger-protected target (#5177). (#5210) *(@haxiorz)*
- 🐛 Forward the triggering click event through DataTable's `onRowClick` so callers can anchor UI to the clicked row (#5154). (#5224) *(@adeptofvoltron)*
- 🐛 Allow calendar/scheduled interactions to record external guests who have no matching user record (#5115). (#5227) *(@adeptofvoltron)*
- 🐛 Render ingested email bodies as converted plain text instead of raw HTML, and show the external sender's name/email instead of a bare UUID. (#5245) *(@wojciechszyjka)*
- 🐛 Run response enrichers on the message detail route so channel-specific payloads (email HTML, Slack blocks, WhatsApp interactive content) render in the UI. (#5247) *(@wojciechszyjka)*
- 🐛 Require `externalEmail` only for email-typed channels so inbound Discord messages stop failing validation and getting dropped. (#4975). (#5252) *(@wojciechszyjka)*
- 🔐 Validate test-send recipients against the provider's own capabilities, with a hardened transport-safety allowlist for non-email providers. (#4976). (#5261) *(@wojciechszyjka)*
- 💰 Give the payments table a real `tableId` so the gateway-status column actually binds and renders. (#5142). (#5270) *(@adeptofvoltron)*
- 🔐 Preserve system-actor identity on command-bus audit entries instead of dropping it. (#4732). (#5277) *(@Paul-Mlodochowki)*
- 💰 Lock pricing controls on sales order lines that already have shipped quantities so a name-only edit no longer fails. (#5248). (#5279) *(@Paul-Mlodochowki)*
- 🐛 Serve an empty page past the end of the attachments list instead of silently clamping to the last page. (#5299). (#5312) *(@adeptofvoltron)*
- 🐛 Stop hiding the calendar peek popover's Join button behind the AI summaries preference and let callers set the popover side. (#5153). (#5313) *(@adeptofvoltron)*
- 🐛 Stop the backend sidebar from scrolling horizontally and unify its spacing across desktop, settings and mobile. (#5314) *(@kriss145)*
- 🐛 Clip the RichEditor toolbar's hidden measurement row so a `full`-variant editor stops causing page-level horizontal scroll. (#5318) *(@kriss145)*
- 🐛 Stop deal association selectors from searching on mount and returning an unfiltered page of contacts. (#5118). (#5320) *(@adeptofvoltron)*
- 🐛 Publish readOnly/destructive MCP tool annotations in `tools/list` so clients that fail closed on missing metadata can auto-approve reads. (#5283). (#5322) *(@Paul-Mlodochowki)*
- 🔧 Fail CI when a descriptor-keyed `resolutions` pin stops matching anything in the lockfile, instead of letting it silently rot. (#5098). (#5324) *(@adeptofvoltron)*
- 🔧 Kill the full ephemeral process tree on integration-test teardown and capture startup output for failed readiness checks. (#5333). (#5338) *(@adeptofvoltron)*
- 🔧 Report diff-scoped files with no related test coverage instead of aborting the whole mutation-testing gate. (#5281). (#5343) *(@adeptofvoltron)*
- 🐛 Unify company people count, list and detach on the link+profile union (#5114). (#5357) *(@adeptofvoltron)*
- 🔐 Log ACL permission changes (role and user grants) to the action-log audit trail. (#5365) *(@Frshy)*
- 🐛 Report queue jobs the worker abandons before their handler runs, so a data-sync run stops being stuck as "running" forever. (#5368) *(@maxidragon)*
- 🐛 Terminate the last two customer-detail load-more gates on a short page (#5347). (#5378) *(@adeptofvoltron)*
- 🐛 Keep plaintext base columns on exact ILIKE instead of approximate search tokens, behind an opt-in flag. (#5379) *(@kamwro)*
- 🔐 Fix manual trigger and execution history returning 404 for every system-scoped schedule. (#5381) *(@Frshy)*
- 🔄 Make Cancel stop a data-sync run during a batch instead of after it finishes. (#5403) *(@maxidragon)*
- 🐛 Reject allocation of released inventory reservations (#5417). (#5420) *(@Paul-Mlodochowki)*
- 🐛 Portal the combobox dropdown through the DS Popover so a dialog's overflow stops clipping it. (#5443) *(@Frshy)*
- 🐛 Warn at generate time and at bootstrap when two enabled modules define entity classes with the same name. (#5448) *(@Frshy)*
- 🐛 Stack the audit-log changed-fields diff instead of letting it scroll off-screen on narrow viewports. (#5451) *(@Frshy)*
- 💰 Restore invoice and credit-memo header updates, which were failing with HTTP 500. (#5452) *(@haxiorz)*
- 🔐 Stop integration credential editors from persisting the masked-secret sentinel as a real, corrupted credential value. (#5454) *(@haxiorz)*
- 🐛 Align Kanban and List won filtering and status UI (#5107). (#5460) *(@haxiorz)*
- 🔧 Stabilize develop CI at the root causes — missing happy-dom runtime dependency, push-stub env mirroring, an SLA-sweep race and EUDR test timeouts. (#5467) *(@pkarw)*
- 💰 Serve persisted order totals on single-row sales order GET requests (#5438). (#5470) *(@Duang777)*
- 🔧 Fix the documents integration-test failures the standalone CI lane can now reach. (#5471) *(@pkarw)*
- 🔧 Let the standalone CI lane accept its loopback collaboration URL. (#5472) *(@pkarw)*
- 🐛 Accept a no-op referenceIssuedAt on EUDR statement create (#5508). (#5516) *(@haxiorz)*
- 🔐 Stop customer detail and sub-resource routes from leaking record existence (#5504). (#5517) *(@haxiorz)*
- 🌍 Localize warranty-claims error responses instead of leaking i18n keys (#5512). (#5518) *(@haxiorz)*
- 🐛 Sort the EUDR plots list by plotType and originCountry (#5509). (#5520) *(@haxiorz)*
- 🐛 Restore customers list search from the URL on reload. (#5524) *(@Duang777)*
- 🔐 Preserve partial user ACL updates (#5493). (#5537) *(@haxiorz)*
- 🌍 Localize the user/role permission picker's titles, breadcrumbs and ACL helper copy. (#5538) *(@haxiorz)*
- 🌍 Restore missing Polish and Spanish diacritics in dashboard comparison labels. (#5539) *(@haxiorz)*
- 🌍 Give the webhook delivery-failure notification preference a static, translated label instead of the raw interpolation placeholder. (#5540) *(@haxiorz)*
- 🐛 Make built-in notification channel eligibility explicit so enabling a new delivery channel does not silently make every notification eligible for it. (#5542) *(@haxiorz)*
- 🐛 Add a backoffice skip link and a reliable single page heading for keyboard and screen-reader navigation. (#5543) *(@haxiorz)*
- 🔐 Align client-side feature checks with the caller's selected organization instead of the JWT's home scope. (#5544) *(@haxiorz)*
- 💰 Fetch exchange rates for every currency, not just active ones, so a deactivated currency stops losing convertibility. (#5553) *(@Frshy)*
- 🔐 Audit every manual scheduler trigger, refusals included, and run it as the triggering user rather than the schedule's creator. (#5554) *(@Frshy)*
- 🔒 Align the Dependabot npm cooldown with npmMinimalAgeGate so quarantined package versions are never proposed. (#5563) *(@adeptofvoltron)*
- 🐛 Expose timesheet duration validation errors to assistive technology. (#5564) *(@adeptofvoltron)*
- 🐛 Exclude the edited person from the duplicate-email lookup on the CRM person form. (#5566) *(@adeptofvoltron)*
- 🐛 Stop probing the AI assistant API from the backend shell when the module is disabled. (#5567) *(@Frshy)*
- 🔐 Validate a password reset token on load and show a terminal state for a dead link instead of a working-looking form. (#5568) *(@adeptofvoltron)*
- 🔧 Register the sales_channels_enabled feature toggle from the sales module's own setup so it is never missing on installations initialized before the toggle shipped. (#5569) *(@adeptofvoltron, @wojciechszyjka)*
- 🐛 Render AlertDescription as a div so nested block children stop breaking hydration. (#5570) *(@adeptofvoltron)*
- 🐛 Return camelCase keys from the devices API responses, preserving deprecated snake_case aliases for one minor version. (#5571) *(@adeptofvoltron)*
- 💰 Accept exchangeRate and the payment/fulfillment status entry ids on sales document update instead of silently stripping them. (#5573) *(@maxidragon)*
- 🐛 Make `lost` the canonical deal status instead of the misspelled `loose`, with a data migration and a read-compatible alias. (#5578) *(@cielecki)*
- 🔧 Fall back to Webpack for yarn dev when Linux inotify watch limits are too low and cannot be raised. (#5586) *(@dominikpalatynski)*
- 📦 Stop bundling the AI assistant's standalone dynamic loader into the app build. (#5590) *(@pkarw)*
- 🐛 Add a correlation id to generic CRUD 500 error responses. (#5611) *(@adeptofvoltron)*
- 🔄 Batch fulltext worker index writes once per job instead of once per record. (#5612) *(@adeptofvoltron)*
- 🔄 Promote the BasicQueryEngine columnExists cache to process scope. (#5614) *(@adeptofvoltron)*
- 🐛 Pick a device owner by name through a closed picker gated on an ACL dependency (supersedes #5617). (#5634) *(@Frshy, via @pkarw)*
- 🐛 Let Discord test-send fall back to the provider's own target when no recipient is given. (#5635) *(@wojciechszyjka)*
- 🐛 Make the Discord AI auto-reply work end to end. (#5639) *(@wojciechszyjka)*
- 💰 Make sales line discountAmount a line total on both the read and write path (supersedes #5550). (#5640) *(@wojciechszyjka)*
- 🐛 Resolve backend page route ids from the params prop instead of a stranded pathname read. (#5643) *(@wojciechszyjka)*
- 🔄 Stop indexing custom fields twice and rewriting unchanged search tokens. (#5650) *(@maxidragon)*
- 🐛 Register the 'bot' icon and fail the build on lucide registry drift. (#5653) *(@adeptofvoltron)*
- 🐛 Chunk the customers ActivitiesSection author lookup and stop caching its failures. (#5654) *(@adeptofvoltron)*
- 🔄 Validate a data-sync schedule before persisting it. (#5661) *(@adeptofvoltron)*
- 🔐 Dispatch app-level `entry.overrides` in the CLI/worker/scheduler bootstrap path, so `seed-encryption` and other commands stop silently ignoring declared override domains. (#5665) *(@adeptofvoltron)*
- 🌍 Fold non-decomposing Latin letters (ł, ø, đ, ß and friends) in search tokens so names like Łukasz or Łódź are findable from either spelling. (#5667) *(@adeptofvoltron)*
- 🐛 Include custom-field sorts in `wantsCf` so a sort-only cf query keeps the ORM fallback instead of silently mis-ordering rows. (#5670) *(@adeptofvoltron)*
- 🔐 Resolve the resend-invite email origin from the request instead of its URL string, fixing 400s behind a reverse proxy. (#5671) *(@pidubiel)*
- 🐛 Keep every value of a repeated list query parameter instead of silently keeping only the last one, fixing multi-select CRUD filters. (#5675) *(@adeptofvoltron)*
- 🐛 Thread Discord outbound replies to their parent message so `capabilities.threading` is backed by a reachable implementation. (#5676) *(@adeptofvoltron)*
- 🐛 Open the customer portal at the organization slug from the admin "Open Portal" buttons instead of a slugless 404 URL. (#5698) *(@adeptofvoltron)*
- 🔐 Show demo portal credentials only when the seeded accounts genuinely exist, are active and their password still matches, for the current organization. (#5701) *(@adeptofvoltron)*
- 🌍 Translate the portal landing feature cards (pl/de/es) and the whole invitation-acceptance flow (de/es), which had silently shipped English values. (#5703) *(@pidubiel)*
- 💰 Reconcile a caller-supplied sales line `totalNetAmount` against the computed net amount and warn on divergence, instead of silently discarding it. (#5707) *(@adeptofvoltron)*
- 📦 Teach `template:sync` the "kept commented out with an explanation" module case so `modules.ts` template parity stops permanently drifting. (#5708) *(@adeptofvoltron)*
- 🔐 Let a portal-invitation re-invite survive a soft-deleted user instead of a raw 500 on accept, with a clean 409 on a genuine active-account conflict. (#5709) *(@adeptofvoltron)*
- 🌍 Localize the remaining warranty_claims API error responses (78 sites across 14 route files) instead of leaking raw i18n keys to staff and portal users. (#5724) *(@pidubiel)*
- 🐛 Mirror the profile dropdown's entries (notification preferences, communication channels, Security & MFA) in the account sidebar, derived from route metadata instead of a hardcoded list. (#5734) *(@adeptofvoltron)*
- 🐛 Advance the deal's optimistic-lock token when its linked people or companies change, closing a lost-update race where a stale whole-set save could silently reinstate a just-removed link. (#5757) *(@WojciechSoczynskiTHEY)*
- 🔄 Preserve `syncOrigin` (and forward `actorUserId`) on Customer person CRUD events so subscribers can tell a projection write from a genuine external change and stop reconciling against themselves. (#5767) *(@adeptofvoltron)*
- 🔄 Apply the increment when a fork heartbeat wins the progress revive race. (#5768) *(@adeptofvoltron)*
- 🔄 Honour a route's indexer declaration on the command path, not just direct writes. (#5772) *(@adeptofvoltron)*
- 🐛 Find a pending portal invitation by recipient email when the person link is missing. (#5774) *(@adeptofvoltron)*
- 🔄 Cache deals aggregate responses to skip repeated aggregate SQL and currency conversion. (#5796) *(@haxiorz)*
- 🐛 Enable wildcard response enrichers so integration external-ID mappings reach entity responses again. (#5798) *(@haxiorz)*
- 🔄 Reindex query projections after a data migration rewrites rows in raw SQL. (#5819) *(@adeptofvoltron)*
- 🐛 Stop silently discarding saved-view changes under an active role perspective. (#5821) *(@adeptofvoltron)*
- 🌍 Accept the locale decimal separator in numeric inputs. (#5827) *(@adeptofvoltron)*
- 🐛 Accept either injection-widget id and apply overrides client-side too. (#5829) *(@adeptofvoltron)*
- 🐛 Bootstrap LLM providers before any registry read, fixing the stuck AI-provider banner. (#5830) *(@adeptofvoltron)*
- 🔐 Parse decrypted jsonb fields back to objects instead of leaving ciphertext-shaped strings. (#5841) *(@adeptofvoltron)*
- 🌍 Translate the users list column headers. (#5842) *(@adeptofvoltron)*
- 🔐 Gate the credentials form on `integrations.credentials.manage`. (#5843) *(@adeptofvoltron)*
- 🐛 Stop coercing custom-entity select field values like "no" into booleans when reading records (#5791). (#5883) *(@adeptofvoltron)*
- 🐛 Edit ingested email activities as plain text instead of parsing them as Markdown, which broke on quote headers and signature links (#5903). (#5904) *(@mobinea)*
- 🐛 Cascade sidebar-preference rows when deleting a user, so a user with a customized sidebar no longer fails deletion with a bare 500. (#5913) *(@KubaBir)*
- 📦 Enable the attachments module in the empty and WMS create-mercato-app starter presets, so branding-logo and product-media uploads stop 404ing (#5897). (#5917) *(@adeptofvoltron)*
- 🌍 Localize the DataTable export section fallback titles instead of hardcoding them as English literals (#5926). (#5963) *(@adeptofvoltron)*
- 🌍 Localize the role filter labels in the company profile's "Link existing person" dialog (#5944). (#5964) *(@adeptofvoltron)*
- 🐛 Make the Schedule-activity dialog's task priority control write the interaction's real `priority` column instead of an unread custom-field bucket (#5943). (#5967) *(@adeptofvoltron)*
- 🐛 Add a `titleClassName` prop to `CollapsibleSection`/`SectionHeader` for title truncation and localize the collapse-toggle aria-label (#5929). (#5973) *(@adeptofvoltron)*
- 🐛 Require confirmation before deleting a task from a person or company profile's Tasks tab, instead of deleting on the first click (#5937). (#5975) *(@adeptofvoltron)*
- 🐛 Accept `person` as a valid interaction linked-entity type, so activities can be attached to a person record like they already can to a company, deal, offer or resource (#5934). (#5978) *(@adeptofvoltron)*
- 🔐 Honor `TENANT_DATA_ENCRYPTION=no` across integration credentials, MCP/AI-chat session auth and the search index, instead of misreading the operator opt-out as a KMS outage. (#6025) *(@jtomaszewski, @maxidragon)*
- 🔐 Stop `rotate-encryption-key --dry-run` and `backfill-system-encryption --dry-run` from provisioning a real tenant DEK in Vault while still reporting the rows a real run would rewrite (#5950). (#6033) *(@adeptofvoltron)*
- 🌍 Format the sales document detail's dates through the app locale and read date-only columns in the frame they were written in, instead of printing raw ISO / the browser locale (supersedes #5620). (#6035) *(@kamwro, via @patzick)*
- 💰 Preserve a quote/order line's catalog, promotion and status-entry snapshots when another line on the same document is saved, instead of silently nulling them out (#5911). (#6051) *(@adeptofvoltron)*
- 🔧 Warm the lazy `mailparser` import in a jest `beforeAll` for channel-imap/channel-gmail, ending the random timeouts on the first test that normalizes a MIME message (#6040). (#6052) *(@adeptofvoltron)*
- 🔐 Make the custom-field `encrypted` flag declarative in `ce.ts` and preserve an admin-enabled flag across `entities install`, instead of silently discarding it and leaving stored ciphertext unreadable (#5920). (#6059) *(@adeptofvoltron)*
- 🐛 Seed new schedule activities with a forward-looking due date and time instead of the dialog's opening moment or a fixed 10:00, so a task created from the menu no longer arrives already overdue (#5940). (#6060) *(@adeptofvoltron)*
- 🔐 Sync custom-role ACLs again after a module's `onTenantCreated` hooks run during initial tenant setup, so a role a module creates in that hook gets its grants immediately instead of only after a manual `sync-role-acls` run (#6076). (#6097) *(@adeptofvoltron)*
- 🔄 Report the real status and timestamps for a scope-only reindex job (running, stalled, purging, failed, completed) instead of always showing idle with null timestamps (#6070). (#6098) *(@adeptofvoltron)*
- 🌍 Add missing localized entity-type labels for wms, eudr and documents search results, replacing the humanized id fallback chip (#6006). (#6102) *(@adeptofvoltron, @wojciechszyjka)*
- 🐛 Give the message compose 'Also send via email' / 'Reply all' / 'Include attachments' switches an accessible name by routing them through the shared SwitchField primitive (#6111). (#6121) *(@adeptofvoltron)*
- 🌍 Route the remaining hand-rolled numeric inputs (link-template pricing, payment amount, inventory adjustment delta, UoM conversion) through the shared locale decimal parser, so a comma-decimal locale can type its own separator (#5828). (#6125) *(@adeptofvoltron)*
- 🐳 Copy `apps/mercato/scripts` into the production runner image so `mercato init`/`db:migrate` stop crash-looping the demo container. (#6141) *(@dominikpalatynski)*
- 🐛 Tolerate a malformed legacy `todo_source` value instead of crashing the customers dashboard todo widget (fixes #6140). (#6164) *(@patzick)*
- 🐛 Stop leaking a raw UnauthorizedError banner on passive `/login`/`/start` visits by recognizing `/start` as a login-like route (fixes #6159). (#6165) *(@patzick)*
- 🐛 Show a localized not-found page instead of the raw server error for a malformed person/company id. (#6166) *(@patzick)*
- 🐛 Refresh the optimistic-lock token after saving a product so a second consecutive save no longer falsely 409s (fixes #5985). (#6167) *(@patzick)*
- 🐛 Keep the just-saved field visible after a product save instead of snapping it back to its stale pre-edit value (fixes #6170). (#6177) *(@patzick)*
- 🐛 Land the product edit page at the top on reload instead of restoring a stale mid-page scroll offset (fixes #6171). (#6178) *(@patzick)*
- 🐛 Extend the malformed-id not-found fix to the v2 people/companies detail pages, deduping the check via a shared helper (extends #6166). (#6180) *(@patzick)*
- 🐛 Flip a quarantined Discord channel's `isActive` off after a fatal gateway close, so the admin list stops showing it as Active (fixes #4979). (#6189) *(@patzick)*
- 🐳 Move the fullapp Docker stack onto a fresh bridge network, fixing demo-container TCP connection timeouts to Redis/Postgres/Meilisearch. (#6191) *(@pat-lewczuk)*
- 🐛 Make main's three red CI jobs green (push delivery deadlock, TC-ONB-002 budget, two broken unit suites) (fixes #6223). (#6220) *(@patzick)*

## 🛠️ Improvements
- 🛠️ Retire the duplicated string-template emitters in the CLI's module-registry generator in favor of the existing AST emitter (#4672). (#5034) *(@wojciechszyjka)*
- 🛠️ Cap CRUD list `COUNT` queries at a configurable `OM_LIST_COUNT_CAP` via rebuilt count queries, avoiding multi-minute exact counts on large tables (#4552 Phase 2). (#5228) *(@kamwro)*
- 🛠️ Drop the vacuous unique constraint on the encrypted onboarding email column and keep the `email_hash` lookup path indexed. (#4514). (#5336) *(@adeptofvoltron)*
- 🛠️ Stop rewriting search tokens that have not changed during re-indexing and data-sync backfills. (#5402) *(@maxidragon)*
- 🛠️ Index sales_notes and sales_document_addresses by document context, removing hot-path sequential scans on every document snapshot read. (#5555) *(@maxidragon)*
- 🛠️ deps: bump actions/download-artifact from 6 to 8 (migrates #5561). (#5588) *(@pkarw)*
- 🛠️ deps: bump useblacksmith/setup-docker-builder from 1 to 2 (migrates #5560). (#5589) *(@pkarw)*
- 🛠️ Drop the dead resolvePathnameId route-id fallbacks from backend detail pages. (#5664) *(@adeptofvoltron)*
- 🛠️ Port the minor-and-patch dependency bump from #5812 onto develop, clearing several high-severity audit advisories along the way. (#5835) *(@pkarw)*
- 🛠️ Adopt the read-through enricher cache for the WMS inventory enrichers, cutting repeated cross-module reads on catalog-product, catalog-variant and sales-order list responses (#5780). (#5894) *(@adeptofvoltron)*
- 🛠️ Give ViewChip a semantic `data-active`/`aria-current` active-state hook instead of asserting state via Tailwind class strings, and cover the New-view control layout (#5846). (#5932) *(@adeptofvoltron)*
- 🛠️ Extract the triplicated USER_TIMEZONE / isSameDay / toLocalZonedDate helpers used across the customers detail components into one shared module (#6011). (#6056) *(@adeptofvoltron)*

## 🧪 Testing
- 🧪 Stop TC-EXAMPLE-017 stranding the post-save redirect fetch. (#5597) *(@pkarw)*
- 🧪 Add an indexing barrier to TC-API-MSG-001 to fix its intermittent failure between composing a message and searching the inbox for it (#5905). (#5914) *(@adeptofvoltron)*
- 🧪 Raise the warranty_claims multi-drain integration test timeout, fixing a consistently failing CI shard unrelated to any milestone-v0.8.0 PR. (#6179) *(@patzick)*

## 📝 Specs & Documentation
- 📝 Spec the sales line `discount_amount` contract, precedence rules, and idempotency requirement (#5019). (#5200) *(@maxidragon)*
- 📝 Replace the stale `ds-health-check.sh` copy in `metrics.md` with a pointer to the real script. (#5095). (#5268) *(@adeptofvoltron)*
- 📝 Design the Reference Example Module developer-documentation showcase (#5202). (#5358) *(@adeptofvoltron)*
- 📝 Add the Reference Example Module documentation showcase page (#5202). (#5359) *(@adeptofvoltron)*
- 📝 Specify tenant-scoped legal documents and consent versioning. (#5364) *(@matgren)*
- 📝 Add the Discord channel operator guide and the Communications Hub provider developer guide. (#5587) *(@wojciechszyjka)*
- 📝 Document the notification delivery surface — registry, channels and delivery strategies. (#5618) *(@Frshy)*
- 📝 Spec the Deal People tab / Company People tab parity — a shared `LinkedPeopleSection` behind thin host wrappers. (#5700) *(@WojciechSoczynskiTHEY)*
- 📝 Correct the docs site's Edit this page repository path. (#5813) *(@truongx)*
- 📝 Specify binding query-engine decryption to the caller's tenant, with an opt-out for plaintext. (#5820) *(@adeptofvoltron)*
- 📝 Document `yarn install-skills` across every fresh-clone setup guide. (#5839) *(@adeptofvoltron)*
- 📝 Publish Enterprise License Agreement Terms v2.4 (Licensed Project, Retained Version, usage verification). (#5858) *(@matgren)*
- 📝 Add a supported way to hide CrudForm groups by their stable id via a new `hiddenGroupIds` prop. (#5885) *(@adeptofvoltron)*
- 📝 Design a blind index for CRM primary-email and company-domain lookups so exact-match queries work under field-level encryption. (#5893) *(@adeptofvoltron)*
- 📝 Propose an opt-in external-amounts mode for sales documents that mirror orders already priced, rounded and taxed by an external book of record. (#5991) *(@maxidragon)*

## 👥 Contributors

- @wojciechszyjka
- @pmadajthey
- @pkarw
- @haxiorz
- @Paul-Mlodochowki
- @adeptofvoltron
- @mkadziolka
- @maxidragon
- @pat-lewczuk
- @MateuszBilant
- @patzick
- @kamwro
- @jtomaszewski
- @zawoj
- @Duang777
- @szymon-sapiecha
- @kriss145
- @Frshy
- @cielecki
- @dominikpalatynski
- @pidubiel
- @WojciechSoczynskiTHEY
- @mobinea
- @KubaBir
- @matgren
- @truongx
- @zielivia
---

# 0.7.0 (2026-08-26)

## Highlights

Open Mercato 0.7.0 is led by two major advances: a standalone-app AI module-development harness and the full EUDR compliance module. A long series of create-app, UMES and module-facts improvements culminates in a canonical reference module that agents can inspect, extend, test and judge end to end. Its runtime surface covers scoped CRUD with optimistic locking, encryption and search, cache and DI, events and notifications, AI overrides, widgets, bulk progress, outbox workers and integration conventions. The harness enforces spec phases, validates generated locale catalogs, understands extension-point contracts and CRM detail-tab routing, production-builds generated apps, diagnoses missing Playwright browsers, and provides privacy-gated session sharing and generative session review. Building an Open Mercato app outside the monorepo is no longer a collection of examples; it is an executable, self-checking development workflow.

EUDR adds plots, evidence, risk assessment, due-diligence statements, lifecycle workflows and reporting alongside catalog, sales and warehouse data. The WMS inventory core remains attributed to 0.6.7, where it was introduced and lead-highlighted; 0.7.0 builds on that warehouse baseline without duplicating the earlier release entry.

**Two more business modules join them.** A complete **Warranty & RMA claims desk** handles warranties, returns, core returns and supplier recovery from a single type-adaptive intake, with line-level dispositions through to settlement. And the platform learns to reach a phone: a **devices registry with end-to-end mobile push notifications** delivers through FCM, APNs and Expo over the existing communication-channels plumbing, so a notification a module already emits can land on a device without a bespoke integration. Scaffolding keeps pace — `create-mercato-app` gains a **WMS starter preset**, and the CRM preset ships attachments and messages so a fresh CRM app can actually hold a conversation.

Several major platform capabilities arrive around those themes. Inbound webhooks gain bounded, replay-resistant infrastructure; query-index and global search become safer and more predictable under encryption and ACLs; business rules can invoke Open Mercato actions; observability gains secure opt-in OTLP telemetry, now with root/link span options and per-batch data-sync traces; data-sync adapters declare their own run parameters and opt out of the shared cursor row; and the design-system toolchain adds a live component gallery, Figma/Code Connect synchronization and stricter CI linting. Korean joins the supported locales.

The release closes with a hard **security pass on authentication and scope**. Passkey MFA now requires a genuine WebAuthn assertion — the credential-id-and-challenge shortcut that let a caller pass the second factor with no private key and no signature is gone, and `POST /api/security/mfa/verify` answers `401` for it. A real `JWT_SECRET` is required and the legacy token grace period is time-bounded; dashboard widget tenant/organization overrides, user destination scope, user-consent reads and hybrid search results are all authorized against the caller's real scope; public pay endpoints fail closed under rate limiting; and anonymous API-docs exports no longer disclose ACL feature names. Read [`UPGRADE_NOTES.md`](UPGRADE_NOTES.md) before upgrading — the passkey and `JWT_SECRET` changes are deliberate breaks, and the passkey entry carries operator actions for credentials enrolled through the still-open shortcut. Enjoy!

## ✨ Features
- ✨ Warranty & RMA claims desk module — type-adaptive intake, line-level dispositions and supplier recovery. (#4092) *(@haxiorz)*
- ✨ Devices registry and end-to-end mobile push notifications — FCM, APNs and Expo via communication_channels (supersedes #4326). (#5366) *(@Frshy, via @patzick)*
- ✨ Add root/links span options and trace data-sync batches (supersedes #5196). (#5375) *(@jtomaszewski, via @patzick)*
- ✨ Declare data-sync run parameters from the adapter (supersedes #5199). (#5374) *(@KamilGrocholski, @maxidragon, via @patzick)*
- ✨ Add a WMS starter preset to create-mercato-app. (#5356) *(@dominikpalatynski)*
- ✨ Add attachments and messages to the CRM starter preset. (#5355) *(@dominikpalatynski)*
- ✨ Resolve sales channel names on the documents list. (#5350) *(@maxidragon)*
- ✨ Let data-sync adapters opt out of the shared cursor row per entity type. (#5250) *(@maxidragon)*
- ✨ Add a showQueryTime opt-out to DataTable (#5304). (#5310) *(@adeptofvoltron)*
- ✨ Harden standalone harness gates and resilience. (#5295) *(@pkarw)*
- ✨ Add sectioned module fact sheets. (#5293) *(@pkarw)*
- ✨ Complete the canonical example and standalone harness. (#4897) *(@pkarw)*
- ✨ Filter the documents list by several sales channels. (#5198) *(@maxidragon)*
- ✨ EUDR compliance module — evidence, plots, risk, DDS lifecycle and reporting. (#4358) *(@haxiorz)*
- ✨ StrykerJS diff-scoped mutation testing gate (advisory; enforcement dormant). (#4932) *(@adeptofvoltron)*
- ✨ Expose a public save-view and dirty-state API on DataTable (#5047). (#5074) *(@wojciechszyjka)*
- ✨ Warn when a $like filter targets an encrypted-at-rest column (#5051). (#5069) *(@wojciechszyjka)*
- ✨ Lint:ds CI escalation + legacy Alert variant migration (DS DX item 5). (#4317) *(@zielivia)*
- ✨ Add Korean locale support (supersedes #4007). (#4912) *(@moduvoice, via @pkarw)*
- ✨ Add quiet destructive button treatment (supersedes #4652). (#4919) *(@zielivia, via @pkarw)*
- ✨ Make DataTable aggregations implementation-ready (supersedes #4455). (#4806) *(@jtomaszewski, via @pkarw)*
- ✨ Evaluate CRM detail-tab UMES routing (supersedes #4772). (#4907) *(@Pallavikumarimdb, via @pkarw)*
- ✨ Complete source-linked module extension contracts (module facts). (#4883) *(@pkarw)*
- ✨ Preserve primary person and extensible tabs (supersedes #4451). (#4459) *(@wojciechszyjka, via @pkarw)*
- ✨ Add CALL_OPEN_MERCATO business-rule action (supersedes #3350). (#4877) *(@pmadajthey, via @adeptofvoltron)*
- ✨ Tokens Figma sync + Code Connect — anti-drift foundation (DS DX item 1) (supersedes #4277). (#4891) *(@zielivia, via @pkarw)*
- ✨ Localize global-search presenters and entity-type headings (supersedes #2937). (#4886) *(@marcinwadon, via @pkarw)*
- ✨ Live component gallery at /backend/design-system (DS DX item 2). (#4301) *(@zielivia)*
- ✨ AI input moderation & safety identifiers (#2510). (#2949) *(@adeptofvoltron)*
- ✨ Add always-consistent projection mode. (#3236) *(@wwaleszczykSoftiq)*
- ✨ Automate release upgrade companions. (#4799) *(@pkarw)*
- ✨ Add om-mockup-prototype for pre-implementation UI prototypes. (#4353) *(@pat-lewczuk)*
- ✨ Add UMES extension-point catalog. (#4810) *(@pkarw)*
- ✨ Cache notification lists (supersedes #4535). (#4543) *(@hubert-madej-softiq, via @pkarw)*
- ✨ Expose the signed-in user's display name (supersedes #4713). (#4795) *(@lchrusciel, via @pkarw)*
- ✨ Inbound webhook handlers — Phase 1 core infrastructure. (#3145) *(@adeptofvoltron)*
- ✨ Hide or show a whole sidebar group in one toggle (supersedes #4714). (#4801) *(@lchrusciel, via @pkarw)*
- ✨ Make Tpay settlement proposal implementation-ready (supersedes #4523). (#4803) *(@lchrusciel, via @pkarw)*
- ✨ Add generative session judge. (#4786) *(@pkarw)*
- ✨ Make quick-add deal probability configurable (supersedes #4420). (#4465) *(@wojciechszyjka, via @pkarw)*
- ✨ Surface defaultCountryIso2 through customer phone form configs. (#4749) *(@mikoajp)*
- ✨ Align interactive implement-spec workflow. (#4787) *(@pkarw)*
- ✨ Let frontend toggle hooks declare a defaultValue. (#4553) *(@jtomaszewski)*
- ✨ Carry the resolved current organization on BackendChromePayload. (#4715) *(@lchrusciel)*
- ✨ Wire sidebar nav group ordering as the nav override domain. (#4716) *(@lchrusciel)*
- ✨ Add business-prompt complete-module case. (#4759) *(@pkarw)*
- ✨ Add 'partner-request' to allowed labels in community labels. (#4730) *(@MStaniaszek1998)*
- ✨ Enable community PR label commands. (#4726) *(@MStaniaszek1998)*
- ✨ Make the standalone harness pass on Claude sonnet. (#4529) *(@pkarw)*
- ✨ Cache organization switcher responses (#2907). (#4538) *(@hubert-madej-softiq)*
- ✨ Hide the contact/feedback widget behind an ff_om_hide_contact flag. (#5486) *(@patzick)*

## 🔒 Security
- 🔒 Require a genuine WebAuthn assertion for passkey MFA verification (#3852). (#5306) *(@pkarw)*
- 🔒 Authorize dashboard widget tenant/organization scope overrides (#5175). (#5206) *(@pkarw)*
- 🔒 Strip ACL feature names from anonymous API docs exports (#2270). (#5265) *(@pkarw)*
- 🔒 Filter hybrid search results by per-entity view features (#5168). (#5203) *(@pkarw)*
- 🔒 Make rate limiting fail-closed on public pay endpoints (#4702). (#5030) *(@adeptofvoltron)*
- 🔐 Write the encrypted portal display_name through the managed entity (#3837). (#5262) *(@pkarw)*
- 🔒 Scope user-consents reads to a concrete tenant (#3820). (#5236) *(@pkarw)*
- 🔒 Authorize the user destination scope (#5176). (#5208) *(@haxiorz)*
- 🔒 Prevent example event scope forgery (#5178). (#5209) *(@haxiorz)*
- 🔒 Require a real JWT secret and bound the legacy token window (#5174). (#5207) *(@pkarw)*
- 🔒 Encode mutation report fields safely. (#5234) *(@pkarw)*
- 🔒 Clear the remaining high-severity dependency audit advisories. (#5085) *(@patzick)*
- 🔒 Add protected role floor guards and audit log interceptor context seam. (#4958) *(@haxiorz)*
- 🔒 Expose the caller's userId on AiAgentPageContextInput (#5049). (#5065) *(@wojciechszyjka)*
- 🔒 Secure opt-in OTLP observability (supersedes #3733). (#4475) *(@KubaBir, via @pkarw)*
- 🔒 Add optimistic locking to settings and expand policy tests. (#4619) *(@Pallavikumarimdb)*
- 🔒 Disable ACL features system-wide via module overrides (supersedes #4447). (#4462) *(@jtomaszewski, via @pkarw)*
- 🔒 Bound multipart upload parsing (#4831). (#4869) *(@haxiorz)*
- 🔒 Stabilize: clear Advanced Security and record main merge. (#4847) *(@pkarw)*
- 🔒 Extract shared participant-scope helper to prevent enricher/list-route drift (#4133). (#4139) *(@pat-lewczuk)*
- 🔒 Reconcile payment-session amount with order total (supersedes #4507). (#4725) *(@wojciechszyjka, via @pkarw)*
- 🔒 Add privacy-gated session sharing skill. (#4756) *(@pkarw)*
- 🔒 Enforce cumulative capture ceiling (#4487). (#4508) *(@wojciechszyjka)*

## 🐛 Fixes
- 🐛 Emit the declared logout and password lifecycle events. (#5352) *(@Frshy)*
- 🐛 Make I18nProvider children optional so it typechecks via React.createElement (#5155). (#5219) *(@adeptofvoltron)*
- 🔐 Resolve query-index CRUD bridge scope through the metadata-aware resolver. (#5332) *(@MStaniaszek1998)*
- 🐛 Return null from loadSidebarPreference when no row exists. (#5305) *(@Frshy)*
- 💰 Accept comments and internalNotes on document update. (#5335) *(@kamwro)*
- 🔐 Let channel viewers read the channels list. (#5241) *(@maxidragon)*
- 🐛 Terminate "load more" on a short page, not on a reported total. (#5274) *(@kamwro)*
- 🔄 Keep long-running sync progress cards truthful. (#5189) *(@jtomaszewski)*
- 💰 Stop dropping address-snapshot keys the editor cannot show. (#5240) *(@kamwro)*
- 🔧 Register template-i18n-parity in the repo-wide guard registry. (#5340) *(@pkarw)*
- 🌍 Sync template locale dictionaries with the app (#4738). (#5272) *(@Paul-Mlodochowki)*
- 🔄 Invalidate the widget cache when the module registry reloads (#5103). (#5179) *(@wojciechszyjka)*
- 🌍 Localize relative time strings in the app locale (#5286). (#5329) *(@adeptofvoltron)*
- 📦 Separate the Git init prompt from its result (#5316). (#5319) *(@adeptofvoltron)*
- 🐛 Parse timesheet grid durations instead of coercing them to a clamped day (#4846). (#4966) *(@adeptofvoltron)*
- 📦 Make the create-app hook validator opt-in. (#5309) *(@pkarw)*
- 🔧 Ignore a symlink named node_modules, not just a directory. (#5300) *(@kamwro)*
- 📦 Make standalone harness gates fail loudly. (#5301) *(@pkarw)*
- 🌍 Format MonthGrid and AgendaList dates with the app locale (#5116). (#5160) *(@adeptofvoltron)*
- 📦 Isolate the JWT startup check from the Edge runtime. (#5298) *(@pkarw)*
- 🔧 Stabilize the example generator activation fixture. (#5297) *(@pkarw)*
- 🔧 Restore npm provenance publishing, close the CodeQL cache-poisoning alert and de-flake TC-WF-030. (#5292) *(@pkarw)*
- 🔧 Restore the checkout workflow heading locator. (#5271) *(@pkarw)*
- 🐛 Make the Mark deal as Lost dialog scroll internally. (#5229) *(@adeptofvoltron)*
- 🔧 Align standalone snapshot integration fixtures. (#5249) *(@pkarw)*
- 🔧 Reduce local queue worker idle CPU. (#5135) *(@andrzejewsky)*
- 🐛 Fetch recurring calendar masters. (#5112) *(@szymon-sapiecha)*
- 📦 Run the snapshot activation helper under CJS. (#5246) *(@pkarw)*
- 🐛 Use APP_URL for the OAuth callback redirect origin. (#5221) *(@adeptofvoltron)*
- 🌍 Unify Polish CRM deal terminology on "szansa" (#5156). (#5225) *(@adeptofvoltron)*
- 🐛 Honour bulkImport.skipNotifications in sales.payments.create. (#5220) *(@kamwro)*
- 📦 Restore create-app template test parity. (#5235) *(@pkarw)*
- 🔧 Grant the community label workflow PR access. (#4753) *(@MStaniaszek1998)*
- 🔐 Fail closed when a request has no resolved tenant. (#5122) *(@Frshy)*
- 🐛 Let route-declared responses win over inferred defaults. (#5216) *(@Frshy)*
- 🔐 Stabilize develop for release (login state loss, CodeQL, audit gate). (#5217) *(@pkarw)*
- 🔧 Make local queue writes atomic and cross-process safe (#5149). (#5204) *(@pkarw)*
- 🐛 Honour OR groups for custom-field filters (#5039). (#5056) *(@wojciechszyjka)*
- 🐛 Prevent duplicate custom-field errors. (#5063) *(@szymon-sapiecha)*
- 📦 Remove the dist/agentic build race and make truncated runs self-explanatory. (#5064) *(@wojciechszyjka)*
- 🔄 Sync deal closure with funnel stage (#5106). (#5140) *(@haxiorz)*
- 🔧 Dispatch queued events through the DI event bus. (#5071) *(@patrykbojczuk)*
- 🐛 Give preset apps a working Cmd+K palette (#5164, #5163). (#5167) *(@pkarw)*
- 🔐 Guard apiFetch's session-refresh redirect against endless loops. (#5191) *(@adeptofvoltron)*
- 🐛 Clear AppShell breadcrumb in a layout effect so prefetched navigations keep it (#4680). (#5124) *(@migsilva89)*
- 🔐 Carry pageOrder in the admin nav payload and sort items server-side (#4845). (#4972) *(@adeptofvoltron)*
- 🐛 Stop ThemeProvider from remounting the app subtree after hydration. (#5055) *(@wojciechszyjka)*
- 💰 Show line-level discounts in the document items table. (#5006) *(@maxidragon)*
- 🔧 Retrieve Codex sessions through app-server. (#5162) *(@pkarw)*
- 🐛 Accept a plain millisecond timeout from the activity editor (supersedes #4502). (#5013) *(@wojciechszyjka, via @pkarw)*
- 📦 Align skill setup message indentation. (#5158) *(@pkarw)*
- 🔧 Unblock the dependency audit gate (unpatched image-size CVEs + real nanoid bump). (#5157) *(@adeptofvoltron)*
- 🔧 Avoid polling missing generate watch roots. (#5134) *(@andrzejewsky)*
- 🐛 Let a command interceptor's rejection carry an HTTP status (#5045). (#5067) *(@wojciechszyjka)*
- 🐛 Never persist a layout trim computed from an empty widget registry. (#5054) *(@wojciechszyjka)*
- 📦 Fail fast with a clear message when Playwright browsers are missing (supersedes #4971). (#5130) *(@mikoajp, via @wojciechszyjka)*
- 🐛 Mark a degraded agent models response as degraded (#5021). (#5028) *(@adeptofvoltron)*
- 🔐 Scope channel reads to the selected organization (#5012). (#5031) *(@adeptofvoltron)*
- 🔐 Carry trusted tenant/org scope in deal closure event options (#4731). (#4963) *(@adeptofvoltron)*
- 🐛 Derive the Push column from adapter capabilities (#4980). (#4992) *(@wojciechszyjka)*
- 🐛 Stop double-wiring onStepFinish on the tool-loop-agent path. (#5053) *(@wojciechszyjka)*
- 🔄 Invalidate the CRUD list cache on timesheet direct writes (#4970). (#5023) *(@adeptofvoltron)*
- 🐛 Include source-less canonical tasks in the task aggregate (#4868). (#5026) *(@adeptofvoltron)*
- 🐛 Compare doc-backed fields to null with IS NULL (#4841). (#4964) *(@adeptofvoltron)*
- 🐛 Compare null aggregation filters with IS NULL (#5016). (#5022) *(@adeptofvoltron)*
- 🐛 Handle errors from the AI chat fire-and-forget fetches (#4703). (#4967) *(@adeptofvoltron)*
- 🔐 Emit null index scope for the global Tenant entity (#4906). (#4965) *(@adeptofvoltron)*
- 💰 Order document lines by line_number, not a random uuid. (#4996) *(@maxidragon)*
- 🐛 Surface pending portal invitations on the person card (#4950). (#4956) *(@patzick)*
- 🐛 Align the 0.6.6 → 0.6.7 upgrade window with the released changelog date. (#5032) *(@pkarw, via @adeptofvoltron)*
- 🐛 Reduce standalone telemetry rebuild churn. (#4922) *(@andrzejewsky)*
- 🐛 Run the theme initializer before first paint (#4962, #4961). (#4987) *(@pkarw)*
- 🐛 Stabilize TC-CAT-035 and TC-CRM-085 against the UI they assert. (#5008) *(@pkarw)*
- 🐛 Terminate fetch-all pagination loops on short pages, fail closed at the page ceiling (#4552 Phase 1). (#4942) *(@jtomaszewski)*
- 📦 Scale the generated root past its module-fact ceiling (#4986). (#4989) *(@wojciechszyjka)*
- 🐛 Make profile channel copy provider-agnostic (#4981). (#4990) *(@wojciechszyjka)*
- 🐛 Render line description in the admin items table. (#4994) *(@maxidragon)*
- 🌍 Route quota errors through i18n — greens the develop test job. (#5001) *(@zielivia)*
- 🔄 Run the generated-cache recovery fixture in a child process (#4960). (#4988) *(@pkarw)*
- 🐛 Expose completionCount so TC-CHKT-043 can actually assert it. (#4985) *(@pkarw)*
- 🌍 Add the missing Korean attachments quota keys. (#4984) *(@pkarw)*
- 💰 Resolve order approval status update via context.orderId. (#4341) *(@pkarw)*
- 🐛 Unbreak the template-script guard and stop the module-facts budget flapping. (#4959) *(@pkarw)*
- 🐛 Make storage quota admission atomic (#4043) (supersedes #4072). (#4076) *(@haxiorz, via @pkarw)*
- 🐛 Return 503 on DB connection exhaustion instead of 401/500. (#4954) *(@patrykbojczuk)*
- 🔐 Encrypt pre-tenant request data (#3876) (supersedes #4091). (#4160) *(@haxiorz, via @pkarw)*
- 💰 Lock prices on shipped order lines. (#4131) *(@andrzejewsky)*
- 🔧 Guard delete route by participant (#3871). (#4098) *(@haxiorz)*
- 🔧 Resolve transaction status update race condition between submit route and gateway webhook. (#4814) *(@Pallavikumarimdb)*
- 🐛 Apply meta.hidden to DataTable columns that arrive late (supersedes #4859). (#4955) *(@jakubsobczak-syhi, via @pkarw)*
- 🐛 Enforce optimistic lock on proposal action edits (#3250). (#3383) *(@pat-lewczuk)*
- 🐛 Resolve relation labels in record lists (supersedes #4300). (#4904) *(@helloandygithub, via @pkarw)*
- 💰 Persist customFields supplied on order and quote create. (#4951) *(@jtomaszewski)*
- 🔄 Stop partitioned reindex losing rows, degrade vector search without pgvector. (#4944) *(@pkarw)*
- 🐛 Register the telemetry default-unloaded guard in the repo-wide enumeration. (#4947) *(@wojciechszyjka)*
- 🐛 Bind in/not_in aggregation filters as value lists (#4669). (#4821) *(@wojciechszyjka)*
- 🐛 Ship dev memory sampler in standalone template. (#4941) *(@dominikpalatynski)*
- 🐛 Reject aborted API reads and stop browser logs unfolding dev output. (#4939) *(@pkarw)*
- 📦 Production-build scaffolded apps in the integration run. (#4921) *(@patzick)*
- 🔧 Register the app-level DI hook in worker/CLI bootstrap. (#4937) *(@pkarw)*
- 🐛 Bound widget-data set filters (supersedes #4855). (#4916) *(@wojciechszyjka, via @pkarw)*
- 🐛 Clear the high-severity audit gate on develop. (#4930) *(@wojciechszyjka)*
- 🐛 Stabilize develop — fix the three failing gates at root cause. (#4927) *(@pkarw)*
- 🔄 Abort synchronous activities when their timeout elapses (supersedes #4854). (#4918) *(@wojciechszyjka, via @pkarw)*
- 🐛 Pass request query to DELETE before-interceptors. (#4910) *(@adeptofvoltron)*
- 💰 Key settings section order off the untranslated group id (#4843). (#4909) *(@adeptofvoltron)*
- 🔐 Sanitize session API errors. (#4898) *(@pkarw)*
- 🐛 Isolate invitation route tests. (#4899) *(@pkarw)*
- 🔐 Gate tenant CRUD on superadmin, not just ACL. (#4893) *(@mikoajp)*
- 🐛 Enforce inbound timestamp replay window (supersedes #3945). (#4510) *(@haxiorz, via @pkarw)*
- 🐛 Fix customer account invitation emails (supersedes #3083). (#3598) *(@pmadajthey, via @pkarw)*
- 🐛 Carry forward bounded public request bodies (supersedes #4068). (#4512) *(@haxiorz, via @pkarw)*
- 🐛 Harden assignment row regressions. (#4339) *(@pkarw)*
- 🔐 Bound search token growth without a new index (supersedes #4685). (#4805) *(@rajanbor, via @pkarw)*
- 🔐 Portal user surfaces and scoped CRM normalization (supersedes #4453). (#4457) *(@wojciechszyjka, via @pkarw)*
- 🐛 Restore claim diagnostics (#4862) (supersedes #4870). (#4894) *(@haxiorz, via @pkarw)*
- 🐛 Surface app-level DI override failures (supersedes #4298). (#4827) *(@helloandygithub, via @pkarw)*
- 🔐 Define session claim retention (#4861) (supersedes #4872). (#4890) *(@haxiorz, via @pkarw)*
- 🔐 Make token availability probes cheap and reliable (supersedes #4767). (#4790) *(@jtomaszewski, via @pkarw)*
- 🔐 Stop the 401 session-refresh loop on "all organizations". (#4746) *(@mat-kruk)*
- 🔐 Example-seed guard no-ops under tenant data encryption (supersedes #4709). (#4794) *(@lchrusciel, via @pkarw)*
- 🐛 Restore activity dialog cancel exits (supersedes #4875). (#4876) *(@haxiorz, via @pkarw)*
- 🐛 Render neutral settings landing page (#4844). (#4871) *(@haxiorz)*
- 🐛 Add sidebar logo aspect ratio option. (#3515) *(@pmadajthey)*
- 💰 Block adding new items to a fulfilled order (#4088). (#4197) *(@adeptofvoltron)*
- 🔐 Harden MFA enforcement and self-service authorization. (#4530) *(@pkarw)*
- 🔄 Cache message lists per user (supersedes #3233). (#4832) *(@wwaleszczykSoftiq, via @pkarw)*
- 🐛 Stabilize develop at root causes (follow-up to #4840). (#4864) *(@pkarw)*
- 🔐 Key backend chrome cache by resolved organization scope. (#4791) *(@pkarw)*
- 🔐 Make organization tenant read-only on edit (supersedes #2936). (#4503) *(@Zamojski5, via @pkarw)*
- 🔄 Close CRUD fail-open paths (identity-partitioned list cache, create-command guards, DI registrar logging). (#4722) *(@matgren)*
- 🔐 Scope DataTable unsaved column widths to the auth session (#4185). (#4275) *(@pkarw)*
- 🐛 Exclude closed deals from summary pipeline (supersedes #4819). (#4849) *(@wojciechszyjka, via @pkarw)*
- 📦 Classify create-app cross-package guards. (#4848) *(@pkarw)*
- 🐛 Keep example sidebar group last by default. (#4820) *(@pkarw)*
- 🐛 Prevent root layout script render warning. (#4825) *(@pkarw)*
- 🐛 Stabilize calendar date range hydration. (#4823) *(@pkarw)*
- 💰 Stabilize: reconcile main into develop and fix sales CI (#4826). (#4836) *(@pkarw)*
- 🐛 Secure scheduled command targets (#3897). (#3990) *(@haxiorz)*
- 💰 Show changed fields in order history. (#4186) *(@migace)*
- 🐛 Verify channel ownership in test-seed emit-inbound (#3835). (#4518) *(@Marynat)*
- 🔐 Format analytics amounts in tenant base currency safely (supersedes #4631). (#4656) *(@wojciechszyjka, via @pkarw)*
- 🐛 Run repo-wide audit guards unfiltered on every PR (#4534). (#4687) *(@wojciechszyjka)*
- 🖼️ Bound multipart upload parsing (supersedes #4066). (#4829) *(@haxiorz, via @pkarw)*
- 🐛 Make notification delivery SSE-first (supersedes #4594). (#4596) *(@Pallavikumarimdb, via @pkarw)*
- 🐳 Reap expired Redis tag members safely (supersedes #4570). (#4800) *(@jtomaszewski, via @pkarw)*
- 🐛 Resume stalled backfills safely (supersedes #4192). (#4793) *(@jtomaszewski, via @pkarw)*
- 🔐 Require verified SSO email before link or JIT (#3905). (#3981) *(@haxiorz)*
- 🔐 Scope reads by organization (#3874). (#4097) *(@haxiorz)*
- 🐛 Persist resource fieldset selection (#2646). (#2861) *(@adeptofvoltron)*
- 🔐 Mirror response security headers (#4042). (#4073) *(@haxiorz)*
- 💰 Require at least one line item on orders (#4021). (#4093) *(@Paul-Mlodochowki)*
- 🐛 Cap unbounded dictionary-entry listing (#3847). (#4175) *(@adeptofvoltron)*
- 🔐 Protect custom endpoints from SSRF (#3869). (#4109) *(@haxiorz)*
- 🐛 Raise the deal description cap from 4000 to 50000 characters. (#4568) *(@piotrchabros)*
- 🐛 Drop deals closed by closure_outcome from the pipeline chart (#4668) (supersedes #4629). (#4683) *(@wojciechszyjka)*
- 🔐 Enforce scoped metadata read ACLs (supersedes #4137). (#4611) *(@haxiorz, via @pkarw)*
- 🐛 Make job state transitions race-safe (supersedes #4537). (#4539) *(@jtomaszewski, via @pkarw)*
- 🔐 Decrypt encrypted group sources before analytics grouping (#4622). (#4690) *(@wojciechszyjka)*
- 🔐 Make encrypted list search indexable (#2990) (supersedes #4777). (#4784) *(@marcinwadon, via @pkarw)*
- 🔐 Scope transaction expiry per organization (supersedes #4775). (#4785) *(@Pallavikumarimdb, via @pkarw)*
- 🔐 Honor entity-scoped field blocklists safely (supersedes #4630). (#4654) *(@wojciechszyjka, via @pkarw)*
- 🐛 Keep client-only widget modules out of the CLI bundle graph (supersedes #4628). (#4653) *(@wojciechszyjka, via @pkarw)*
- 💰 Deprecate ignored order payment totals with warnings (supersedes #4768). (#4796) *(@jtomaszewski, via @pkarw)*
- 🔄 Key the nav sidebar cache on the module surface and give it a TTL (supersedes #4546). (#4797) *(@jtomaszewski, via @pkarw)*
- 🌍 Validate generated locale catalogs. (#4757) *(@pkarw)*
- 🔄 List every indexed entity and stop reporting false out-of-sync. (#4592) *(@jtomaszewski)*
- 🔐 Only probe search_tokens when the query actually searches. (#4723) *(@jtomaszewski)*
- 🐛 Register the External IDs widget so its sidebar spot renders. (#4711) *(@lchrusciel)*
- 🔐 Preserve fresh standalone login sessions. (#4554) *(@pkarw)*
- 🐛 Restore Cmd+K search indexing at the site root (supersedes #4550). (#4560) *(@jtomaszewski, via @pkarw)*
- 🐛 Read deal status through one closed/won vocabulary (supersedes #4689). (#4705) *(@wojciechszyjka, via @pkarw)*
- 🔐 Harden standalone session validation. (#4758) *(@pkarw)*
- 🐛 Harden scheduler interval limits (supersedes #3991). (#4780) *(@haxiorz, via @pkarw)*
- 🐛 Use nil UUID sentinel instead of string in leave-requests. (#4766) *(@mikoajp)*
- 🐛 Enforce standalone spec phase gates. (#4752) *(@pkarw)*
- 🐛 Warn when an injection table references a widget nothing declares. (#4710) *(@lchrusciel)*
- 🐛 Activity configuration — edit-time validation, editable JSON, working timeouts (supersedes #4449). (#4460) *(@wojciechszyjka, via @pkarw)*
- 💰 Stop useGroupOrder render loop when hosts recreate group ids every render (#4386). (#4411) *(@wojciechszyjka)*
- 🌍 Define the phone custom-field translation keys (#4607). (#4608) *(@wojciechszyjka)*
- 🐛 Log command-interceptor registry import failures. (#4505) *(@wojciechszyjka)*
- 🔐 Never return an unencrypted index document (#4677). (#4686) *(@wojciechszyjka)*
- 🐛 Make the usage scanner see multiline t() calls (#4666). (#4684) *(@wojciechszyjka)*
- 🔐 Fail closed on unresolved tenant scope in read routes. (#4590) *(@tomaszscigalacshark)*
- 🐛 Preapprove @open-mercato past yarn's minimum release age gate. (#4644) *(@patzick)*
- 🐳 Sync role ACLs on redeploy so newly enabled modules stay reachable. (#5431) *(@patzick)*
- 🐛 Align the WMS KPI cards, role dialog footer and EUDR area field. (#5432) *(@patzick)*
- 🐛 Resolve the portal address server-side to stop hydration flicker (fixes #5457). (#5479) *(@patzick)*
- 🐛 Stop offering Delete on archived EUDR statements and surface the reason (#5461). (#5480) *(@patzick)*
- 🐛 Clear the 0.7.0 pre-release UX and i18n nits across UI, sales, business rules and record locks (fixes #5456). (#5481) *(@patzick)*
- 🐛 Fix the EUDR nav label, module breadcrumb and false unsaved-changes prompt. (#5489) *(@patzick)*
- 🔐 Surface login failures instead of an empty 500. (#5529) *(@patzick)*
- 📦 Bump apps/* with the monorepo version on release. (#5530) *(@patzick)*
- 💰 Serve persisted order totals on single-row GET (#5438). (#5622) *(@Duang777, via @patzick)*
- 🔐 Preserve partial user ACL updates (fixes #5493). (#5623) *(@patzick)*

## 🛠️ Improvements
- 🛠️ Publish dist/agentic through a staged swap (#5104). (#5328) *(@adeptofvoltron)*
- 🛠️ Delegate Month pill and Agenda row time formatting to the shared helper (#5275). (#5321) *(@adeptofvoltron)*
- 🛠️ Migrate CI workflows to Blacksmith runners. (#5244) *(@MStaniaszek1998)*
- 🛠️ Bump nanoid to 3.3.18 on develop. (#5218) *(@pkarw)*
- 🛠️ Index tag assignments by document_id and stop rewriting unchanged tag sets. (#5145) *(@maxidragon)*
- 🛠️ Port the major dependency group from #5147 onto develop. (#5161) *(@pkarw)*
- 🛠️ Version DS health reports as one rolling file (#5033). (#5072) *(@adeptofvoltron)*
- 🛠️ Assert the module facts the catalog only allows. (#5038) *(@wojciechszyjka)*
- 🛠️ Scope users role-link lookup before materializing ids (#4914). (#5027) *(@adeptofvoltron)*
- 🛠️ Reduce regeneration and module graph overhead. (#4170) *(@andrzejewsky)*
- 🛠️ Harden the AST emitter test harness (#4851). (#5029) *(@adeptofvoltron)*
- 🛠️ Derive TC-UNDO-003 expectedCloseAt fixtures from the run clock (#5060). (#5061) *(@adeptofvoltron)*
- 🛠️ Upgrade Next.js to 16.3.0 for lower dev memory. (#5020) *(@patzick)*
- 🛠️ Localize the remaining route error responses (#4830). (#4993) *(@wojciechszyjka)*
- 🛠️ Make the guard manifest the single enumeration for the repo-wide audit step (#4770). (#4952) *(@adeptofvoltron)*
- 🛠️ Harden useGroupOrder reorder composition and document the render-time ref guard (#4691). (#4817) *(@wojciechszyjka)*
- 🛠️ Cover the loader→generated-cache recovery seam end to end (#4693). (#4818) *(@wojciechszyjka)*
- 🛠️ Bump three major dependencies. (#4911) *(@pkarw)*
- 🛠️ Bump actions/setup-node from 6 to 7. (#4903) *(@pkarw)*
- 🛠️ Structure lessons for progressive loading. (#4884) *(@pkarw)*
- 🛠️ Localize route error responses (#4830) (supersedes #4874). (#4887) *(@haxiorz, via @pkarw)*
- 🛠️ Migrate minor-and-patch updates to develop. (#4804) *(@pkarw)*
- 🛠️ Carry forward AST-first source generation (supersedes #4816). (#4867) *(@wojciechszyjka, via @pkarw)*
- 🛠️ Localize validation errors (#4782). (#4873) *(@haxiorz)*
- 🛠️ Bump Next.js to 16.2.12 on develop. (#4813) *(@pkarw)*
- 🛠️ Bump tar to 7.5.21 on develop. (#4522) *(@pkarw)*
- 🛠️ Audit harness module-fact coverage and case budgets (#4565) (supersedes #4602). (#4792) *(@wojciechszyjka, via @pkarw)*

## 🧪 Testing
- 🧪 Make module-decoupling.test.ts order-independent (#5129). (#5269) *(@adeptofvoltron)*
- 🧪 Stabilize the calendar week-grid drag test (#5278). (#5302) *(@pkarw)*
- 🧪 Replace the hardcoded expectedCloseAt literal in undo.custom-fields.test.ts (#5062). (#5223) *(@adeptofvoltron)*
- 🧪 Guard against duplicate CHANGELOG version headings. (#5024) *(@adeptofvoltron)*
- 🧪 Enforce workspace version alignment on the PR path (#5018). (#5025) *(@adeptofvoltron)*
- 🧪 Mock i18n in the app-level storage_s3 route suite (#4926). (#4931) *(@wojciechszyjka)*

## 📝 Specs & Documentation
- 📝 Make the changelog skill credit the author, not the merger. (#4969) *(@patzick)*
- 📝 Revise the document generators spec from #5170. (#5323) *(@adeptofvoltron)*
- 📝 Specify an SMTP transport for transactional email. (#5303) *(@bartek5412)*
- 📝 Standalone harness session resilience and deterministic template gates. (#5294) *(@pkarw)*
- 📝 Harden standalone harness routing from session #5251 findings. (#5267) *(@pkarw)*
- 📝 Left-align the Catch The Tornado sponsor logo. (#5258, #5259) *(@pkarw)*
- 📝 Add a sponsors section to the README. (#5253, #5254) *(@MStaniaszek1998)*
- 📝 Extend CODEOWNERS to design-system governance files. (#5121) *(@patzick)*
- 📝 Address-level contact details and tax identifiers. (#5197) *(@kamwro)*
- 📝 Record the before/after QA test-env traps in om-prepare-test-env. (#4999) *(@wojciechszyjka)*
- 📝 Correct the Discord spec's backward-compatibility claim (#4975). (#4998) *(@wojciechszyjka)*
- 📝 Document why checkout link slugs stay globally unique. (#4974) *(@Pallavikumarimdb)*
- 📝 Settle the routing duration-budget contract. (#5068) *(@wojciechszyjka)*
- 📝 Add Full Stack House to the certified partner registry. (#5005) *(@jtomaszewski)*
- 📝 Add PrestaShop integration feasibility analysis (supersedes #3937). (#4834) *(@KramarSellision, via @pkarw)*
- 📝 Add the ci-monitoring meta label. (#4940) *(@pkarw)*
- 📝 Sync Terms v2.2 with the source document (no vendor lock-in, Starter Pack). (#4925) *(@matgren)*
- 📝 Capped list count — rebuild the CRUD list COUNT so a bound actually binds. (#4552) *(@jtomaszewski)*
- 📝 Correct failed-job retention guidance (supersedes #4809). (#4905) *(@lchrusciel, via @pkarw)*
- 📝 Define variant loading with empty price kinds. (#4107) *(@pmadajthey)*
- 📝 Correct stale query layer documentation (supersedes #4555). (#4558) *(@jtomaszewski, via @pkarw)*
- 📝 Reuse canonical standalone example module. (#4878) *(@pkarw)*
- 📝 Spec — pinned form action bar, one surface per page (#2647). (#4815) *(@zielivia)*
- 📝 StrykerJS mutation testing as a diff-scoped CI quality gate. (#4773) *(@adeptofvoltron)*
- 📝 Complete source-linked module extension contracts. (#4863) *(@pkarw)*
- 📝 Correct retry and rate-limit guidance (supersedes #4808). (#4812) *(@lchrusciel, via @pkarw)*
- 📝 Specify correlated signal waits. (#4313) *(@PatrickMade)*
- 📝 Comprehensive standalone agent reference. (#4728) *(@pkarw)*
- 📝 Complete UMES Extension-Point Catalog. (#4788) *(@pkarw)*
- 📝 Add om-pr-autopilot PR dispatcher skill. (#4525) *(@wojciechszyjka)*
- 📝 Propose `mercato upgrade` — lock-guarded reconcile for existing deployments. (#4547) *(@jtomaszewski)*
- 📝 Reconcile user task persistence spec (supersedes #4617). (#4648) *(@pmadajthey, via @pkarw)*
- 📝 Harden Call API endpoint picker spec (supersedes #4696). (#4706) *(@pmadajthey, via @pkarw)*
- 📝 Add configuration decision guide (supersedes #4549). (#4741) *(@jtomaszewski, via @pkarw)*
- 📝 Standalone harness canonical UI and i18n acceptance. (#4743) *(@pkarw)*
- 📝 AST-first code generation for the remaining string emitters (#1637). (#4636) *(@wojciechszyjka)*
- 📝 Document ff_om_hide_contact and mirror its tests to the template (fixes #5488). (#5565) *(@adeptofvoltron)*

## 👥 Contributors

- @pkarw
- @maxidragon
- @haxiorz
- @adeptofvoltron
- @wojciechszyjka
- @zielivia
- @moduvoice
- @jtomaszewski
- @Pallavikumarimdb
- @pmadajthey
- @marcinwadon
- @wwaleszczykSoftiq
- @pat-lewczuk
- @hubert-madej-softiq
- @lchrusciel
- @mikoajp
- @MStaniaszek1998
- @patzick
- @KubaBir
- @Frshy
- @szymon-sapiecha
- @patrykbojczuk
- @migsilva89
- @andrzejewsky
- @jakubsobczak-syhi
- @helloandygithub
- @dominikpalatynski
- @rajanbor
- @mat-kruk
- @Zamojski5
- @matgren
- @migace
- @Marynat
- @Paul-Mlodochowki
- @piotrchabros
- @tomaszscigalacshark
- @kamwro
- @KramarSellision
- @PatrickMade
- @bartek5412
- @KamilGrocholski
- @Duang777

---

# 0.6.7 (2026-08-05)

## Highlights

Open Mercato `0.6.7` opens a new chapter: **warehouse management arrives**. The first phase of the WMS module lands core inventory in the platform, so stock finally lives next to catalog, orders, and fulfillment instead of in a spreadsheet somewhere. It is phase one — deliberately focused on the inventory core — and the foundation the rest of the warehouse story will be built on.

The other half of this release is **trust under multi-tenant pressure**. A long scoping sweep makes the platform fail *closed* rather than fail quiet: tenant and organization scope is now enforced on command CRUD, custom-entity mutations, entry commands, role assignments, availability lookups, query-index diagnostics, S3 prefixes, and inbound webhooks; the public quote, tenant-lookup, and org-slug endpoints are rate-limited and guarded against null-tenant sessions; raw acceptance-token fallbacks are gone; SSRF is blocked at the OIDC, Ollama, and redirect-hop paths; and custom-entity records gain **opt-in per-entity ACL**. Alongside it, the persistent **"All organizations" 401 refresh loop is fixed** — session refresh no longer mints `null` tenant/org claims, deals and audited org-scoped endpoints handle the all-orgs scope properly, and a stale pre-auth 401 no longer flashes "Session expired" right after a successful login.

Operationally, this release is about **daemons that stay up and builds that stay fast**. Postgres idle-client errors and idle-in-transaction reaps no longer take down the scheduler or webhook workers, Docker deployments forward their production runtime environment and protect Redis queues from eviction, and swallowed Next.js dev startup errors are surfaced with cold-start retries. On the toolchain side the monorepo moves to the **TypeScript 7.0.2 native compiler**, and a batch of generator work (shared registry discovery, skipped unchanged OpenAPI output, no hashing while idle, no app bootstrap after generation) cuts a lot of dead time out of `yarn generate`. Scaffolded apps get real attention too — they now run their own tooling, pass `yarn test` on a fresh scaffold, and there is a **one-command Windows agentic dev environment** for app + MCP + OpenCode.

Day to day, the product surface gets noticeably nicer: **DataTable columns resize and remember their widths**, custom fields pick up a **phone type with a complete country calling-code dictionary**, honor their declared priority and order, and render multiline values as a plain textarea when you ask for it. Workflows stop losing code-defined triggers in the CLI and worker bootstrap, order approval auto-starts on `sales.order.created`, and sales math gets stricter — operator-defined adjustments count toward the grand total, order lines cannot drop below the shipped quantity, saved addresses survive a re-save, and payment sessions are concurrency-safe. Polish translations are complete, the permission catalogs are localized, DS Guardian v2 lands with a structural lint and Figma canon, and the project itself grows up a little: community labels, a certified-partner registry gating `/label`, Enterprise License Agreement Terms v2.2, and the move to Open Mercato sp. z o.o. as the legal entity. Enjoy!

## ✨ Features
- ✨ Add community labels. (#4740) *(@MStaniaszek1998)*
- ✨ WMS phase 1 — core inventory module (#388). (#4566, #1701) *(@mkadziolka)*
- ✨ Add initialValues prop to CreateDealForm (supersedes #3729). (#4485) *(@jakubsobczak-syhi, via @pkarw)*
- ✨ Cache role lists safely (supersedes #3143). (#4480) *(@adeptofvoltron, via @pkarw)*
- ✨ Honor custom-field priority and declaration order (supersedes #4417). (#4466) *(@wojciechszyjka, via @pkarw)*
- ✨ Fail loud on colliding backend routes in mercato generate. (#4402) *(@tomaszscigalacshark)*
- ✨ Configurable excludeInteractionType on profile activity sections. (#4390) *(@wojciechszyjka)*
- ✨ Editor 'plain' renders multiline custom fields as a plain textarea. (#4389) *(@wojciechszyjka)*
- ✨ Provide a complete country calling-code dictionary in PhoneNumberField (#4129). (#4195) *(@adeptofvoltron)*
- ✨ Add phone custom field type with phone-number editor. (#4147) *(@DarrenStasiakDev4You)*
- ✨ One-command Windows agentic dev environment (app + MCP + OpenCode). (#3988) *(@WebEferen)*
- ✨ Allow disabling sales channels via feature toggle. (#3935) *(@jtomaszewski)*
- ✨ Add demo autologin via env vars. (#3799) *(@jtomaszewski)*
- ✨ DS system & guardian refresh: docs drift fixes, guardian v2, backend reference, structural lint, Tabs migration, Figma canon. (#3777) *(@zielivia)*
- ✨ DataTable interactive column resize + width persistence (#1835). (#3774) *(@zielivia)*

## 🔒 Security
- 🔒 Gate /label on the certified partner registry (supersedes #4727). (#4761) *(@matgren, via @MStaniaszek1998)*
- 🔒 Reject prototype keys in getNestedValue field paths (#3823). (#4517) *(@Marynat)*
- 🔒 Bump the postcss resolution off the vulnerable 8.5.15 (#4499). (#4500) *(@wojciechszyjka)*
- 🔒 Run a daily dependency audit and stop caching the audit result (#4479). (#4497) *(@wojciechszyjka)*
- 🔒 Guard bounded bcrypt candidate loop invariant (#3812). (#4469) *(@DarrenStasiakDev4You)*
- 🔒 Opt-in per-entity ACL for custom-entity records (supersedes #4208). (#4397) *(@ArtSadWLC, via @pkarw)*
- 🔒 Consolidate security dependency updates. (#4363) *(@pkarw)*
- 🔒 Fail closed on empty organization allowlist at key creation (#4168). (#4228) *(@wojciechszyjka)*
- 🔒 Enforce ctx tenant/org scope on Code Mode api.request (#2658). (#4174) *(@ArtSadWLC)*
- 🔒 Remove raw acceptance-token fallback in public quote endpoints (#2929). (#2997) *(@adeptofvoltron)*

## 🐛 Fixes
- 🔐 Stop stale pre-auth 401 flashing "Session expired" after login. (#4917) *(@patzick)*
- 🐛 Add pr write permissions. (#4754) *(@MStaniaszek1998)*
- 🐛 Name Open Mercato sp. z o.o. as the marketing-consent controller. (#4751) *(@pkarw)*
- 🔧 Honor app tsconfig in dynamic loader builds (supersedes #4707). (#4724) *(@goer, via @pkarw)*
- 🔄 Stop reindex batches from silently dropping records (supersedes #4593). (#4598) *(@jtomaszewski, via @pkarw)*
- 🐛 Surface swallowed Next.js dev startup errors, retry cold starts. (#4567) *(@patzick)*
- 🐛 Avoid nested provider controls (supersedes #4524). (#4562) *(@hubert-madej-softiq, via @pkarw)*
- 🐛 Default the agentic wizard instead of hanging without a TTY. (#4557) *(@wojciechszyjka)*
- 🔄 Await dynamic import so cache recovery runs (supersedes #4536). (#4540) *(@wojciechszyjka, via @pkarw)*
- 🔄 Update .gitignore to include npm cache directory. (#4533) *(@dominikpalatynski)*
- 🔐 Enforce tenant scope in command CRUD. (#4531) *(@andrzejewsky)*
- 🐛 Give the AGENTS.md budget chain sort an explicit comparator. (#4527) *(@wojciechszyjka)*
- 🔐 Tenant-scope custom entity mutations (supersedes #4134). (#4511) *(@haxiorz, via @pkarw)*
- 🔄 Invalidate trigger cache on customize and reset-to-code (#4425). (#4509) *(@wojciechszyjka)*
- 🐛 Restore ESLint coverage and keep audit green (supersedes #4496). (#4501) *(@wojciechszyjka, via @pkarw)*
- 🐛 Backfill poisoned customer_entity_id links (#4473). (#4494) *(@wojciechszyjka)*
- 🔐 Harden rate-limit proxy trust (#4041) (supersedes #4074). (#4490) *(@haxiorz, via @pkarw)*
- 🐛 Reject over-limit captures (#3880) (supersedes #4083). (#4486) *(@haxiorz, via @pkarw)*
- 🐛 Explain read-only system entity settings (supersedes #3713). (#4482) *(@adeptofvoltron, via @pkarw)*
- 🐛 Make yarn test pass on a fresh scaffold (#4328). (#4476) *(@wojciechszyjka)*
- 🐛 Inline hint when dictionary options need organization context (supersedes #4406). (#4470) *(@wojciechszyjka, via @pkarw)*
- 🐛 Return 400 for malformed uuid list filters (#3819). (#4468) *(@DarrenStasiakDev4You)*
- 🔧 Restore request bodies from runtime registry (supersedes #4410). (#4467) *(@wojciechszyjka, via @pkarw)*
- 🐛 Register code-defined workflow triggers with the trigger engine (supersedes #4443). (#4463) *(@wojciechszyjka, via @pkarw)*
- 🐛 Scaffolded apps run their own tooling (supersedes #4454). (#4456) *(@wojciechszyjka, via @pkarw)*
- 🖼️ Library interaction fixes — input focus and download-cell click. (#4450) *(@wojciechszyjka)*
- 🐛 Malformed ?ids= no longer returns the full list. (#4444) *(@wojciechszyjka)*
- 🔧 Load command interceptors in the CLI/queue-worker bootstrap. (#4414) *(@wojciechszyjka)*
- 🐛 Apply overrides.widgets.dashboard to the server-side widget catalog (#4377). (#4408) *(@wojciechszyjka)*
- 🐛 Restore standalone optimistic locking DI (supersedes #4209). (#4395) *(@migace, via @pkarw)*
- 🐛 CustomFieldValuesList honors listVisible and formats values by kind. (#4388) *(@wojciechszyjka)*
- 🐛 Give ActivityTimeline 'Mark done' the compact sizing its sibling uses. (#4387) *(@wojciechszyjka)*
- 💰 Order-approval trigger listens for sales.order.created so it can auto-start. (#4385) *(@wojciechszyjka)*
- 🐛 Resolve synthetic code-definition UUID in definitions/[id] GET. (#4383) *(@wojciechszyjka)*
- 🐛 Simple-approval EMIT_EVENT activities use eventName so instances stop failing. (#4382) *(@wojciechszyjka)*
- 🐳 Forward runtime environment and protect Redis queues. (#4369) *(@MStaniaszek1998)*
- 🔐 Handle "All organizations" scope across audited org-scoped endpoints. (#4367) *(@jtomaszewski)*
- 🐳 Forward production runtime environment. (#4366) *(@MStaniaszek1998)*
- 🔧 Stop idle-in-transaction reaps crashing the scheduler daemon. (#4364) *(@MStaniaszek1998)*
- 🔧 Stop pg idle-client error crashing daemons; fix webhook worker payload. (#4360, #4359) *(@MStaniaszek1998)*
- 💰 Hide compose-message action on order/quote pages when messages module is disabled. (#4352) *(@jtomaszewski)*
- 🌍 Translate directory edit page chrome and dashboard welcome widget (#4302). (#4343) *(@pkarw)*
- 🔐 Make the public quote tenant guard fire on null-tenant sessions (#4309). (#4340) *(@pkarw)*
- 💰 Include currencies and communication_channels in CRM. (#4318) *(@dominikpalatynski)*
- 🔧 Register catalog/notifications DI factories with .proxy() for CLASSIC mode. (#4299) *(@helloandygithub)*
- 🔐 Resolve global entity scope from metadata. (#4285) *(@vloneskorpion)*
- 📦 Retry standalone install through npm quarantine window. (#4281) *(@patzick)*
- 🐛 Pin scaffolded app to yarn 4.17.1 for TS 7 install. (#4280) *(@patzick)*
- 🔧 Register code workflows in CLI/worker bootstrap (#4257). (#4263) *(@wojciechszyjka)*
- 🖼️ Carry reconcile healing fix past audit gate (supersedes #4253). (#4260) *(@wojciechszyjka, via @pkarw)*
- 🔧 Carry payload parity fix into 0.6.7 (supersedes #4252). (#4259) *(@wojciechszyjka, via @pkarw)*
- 🔐 Localize pay-page session-start failure and add field a11y semantics (#4212). (#4227) *(@wojciechszyjka)*
- 🐛 Return 400 for invalid entry input and fix entry dialog a11y (#4218). (#4226) *(@wojciechszyjka)*
- 🔐 Stop the 401 session-refresh loop on "all organizations". (#4224) *(@piotrchabros)*
- 🔐 Stop session refresh minting "null" tenant/org scope claims. (#4223) *(@piotrchabros)*
- 🔐 Stop the deals 401 session-refresh loop on "all organizations". (#4222) *(@piotrchabros)*
- 🌍 Localize the customer role permission catalog (#4203). (#4205) *(@pkarw)*
- 🔐 Localize portal permission catalog (#4203). (#4204) *(@pat-lewczuk)*
- 💰 Include custom/operator-defined order adjustments in the grand total (#4052). (#4198) *(@adeptofvoltron)*
- 💰 Keep order linked to saved address on re-save (#4169). (#4196) *(@adeptofvoltron)*
- 🐛 Mobile layout — clamp Export dropdown & demo overlays, scrollable calendar tabs. (#4188) *(@zielivia)*
- 🔐 Rate-limit the unauthenticated tenant lookup (#3850). (#4182) *(@adeptofvoltron)*
- 🔐 Fail closed on null-tenant widget-assignment ownership checks (#3843). (#4181) *(@adeptofvoltron)*
- 🐛 Cap the organizations list pageSize at the platform 100 (#3851). (#4180) *(@adeptofvoltron)*
- 🔐 Make entry command ensureScope fail closed on null org/tenant (#3846). (#4177) *(@adeptofvoltron)*
- 🔐 Scope and rate-limit the public org slug lookup (#3849). (#4173) *(@adeptofvoltron)*
- 🐛 Bound dashboard layout and widget-assignment arrays (#3844). (#4172) *(@adeptofvoltron)*
- 💰 Block lowering an order line qty below the shipped quantity (#3993). (#4163) *(@adeptofvoltron)*
- 🐛 Drop unreachable legacy widget injection spots (#3952). (#4162) *(@adeptofvoltron)*
- 🐛 Hide Company V2 Deals tab without customers.deals.view (#4124). (#4159) *(@adeptofvoltron)*
- 🐛 Recognize structured-logger noise in dev log policies. (#4158) *(@pkarw)*
- 🐛 Add Kosovo (XK) to the country dictionary (#4128). (#4157) *(@adeptofvoltron)*
- 💰 Make primary email fit the order details summary card (#4148). (#4156) *(@adeptofvoltron)*
- 🐛 Integrations tabs use DS underline variant + violet hover (#2015). (#4138) *(@zielivia)*
- 🐛 Preserve customer addresses in shipments (#4058). (#4116) *(@pkarw)*
- 🔐 Require trusted webhook scope (#3865). (#4112) *(@haxiorz)*
- 🐛 Close disabled self-service flow (#3878). (#4089) *(@haxiorz)*
- 💰 Make payment sessions concurrency-safe (#4035) (supersedes #4062). (#4087) *(@haxiorz, via @pkarw)*
- 🔐 Enforce role organization scope (#4032) (supersedes #4050). (#4086) *(@haxiorz, via @pkarw)*
- 🐛 Prevent anonymous feedback recipient emails (#3879). (#4082) *(@haxiorz)*
- 🔐 Scope availability command target loads (#3884). (#4078) *(@haxiorz)*
- 🐛 Clear moderate production advisories (#4046). (#4065) *(@haxiorz)*
- 🐛 Prevent duplicate provider operations (#4036). (#4064) *(@haxiorz)*
- 🐛 Protect OIDC requests from SSRF (#4037). (#4063) *(@haxiorz)*
- 🐛 Enforce Ollama connection-time URL safety (#4038). (#4061) *(@haxiorz)*
- 🐛 Fail closed on scoped deletion (#4033). (#4051) *(@haxiorz)*
- 🔐 Scope query index status diagnostics (#3887). (#4015) *(@haxiorz)*
- 🐛 Resolve /start API base URL server-side to prevent hydration mismatch. (#3995) *(@pkarw)*
- 🐛 Enforce scoped object access (#3915). (#3961) *(@haxiorz)*
- 🔐 Scope S3 list prefixes to tenant namespace (#3916). (#3959) *(@haxiorz)*
- 🔄 Block redirect-hop SSRF (#3919). (#3954) *(@haxiorz)*
- 🐛 Stream customer CSV imports. (#3950) *(@haxiorz)*
- 🐛 Gate injection widgets by features (#3930). (#3946) *(@haxiorz)*
- 🐛 Guard unscoped inbound webhooks. (#3943) *(@haxiorz)*
- 🐛 Gate UPDATE_ENTITY commands (#3933). (#3941) *(@haxiorz)*
- 🐛 Fail loud on stale org selection instead of orphaning writes. (#3936) *(@jtomaszewski)*
- 🖼️ Store uploads under the selected organization, not the uploader home org (#3765). (#3788) *(@adeptofvoltron)*
- 🔐 Scope recipient picker to the sender's active organization (#3763). (#3787) *(@adeptofvoltron)*
- 🐛 Clarify and localize field definitions editor (supersedes #3714). (#3759) *(@PatrickMade, via @pmadajthey)*
- 💰 Pin orders/quotes number column on horizontal scroll (#3039). (#3045) *(@haxiorz)*
- 🔐 Auto-assign tenant on organization create for non-super-admins (#2988). (#2993) *(@adeptofvoltron)*

## 🛠️ Improvements
- 🛠️ Cache dictionary-entry value lookups on order create (supersedes #3948). (#4504) *(@KamilGrocholski, via @pkarw)*
- 🛠️ Translate the remaining Polish CRM strings (#2077, #4380). (#4446) *(@wojciechszyjka)*
- 🛠️ Bump actions/setup-node from 4 to 7. (#4292)
- 🛠️ Bump websocket-driver to 0.7.5 on develop. (#4258) *(@pkarw)*
- 🛠️ Avoid app bootstrap after generation. (#4219) *(@andrzejewsky)*
- 🛠️ Avoid invalidation after no-op generation. (#4217) *(@andrzejewsky)*
- 🛠️ Stop hashing generator inputs while idle. (#4216) *(@andrzejewsky)*
- 🛠️ Skip unchanged OpenAPI generation. (#4215) *(@andrzejewsky)*
- 🛠️ Share registry discovery across generators. (#4214) *(@andrzejewsky)*
- 🛠️ Migrate to TypeScript 7.0.2 native compiler. (#4199) *(@patzick)*
- 🛠️ Adopt the standardized 404 helpers across customers and sales (#2364). (#4183) *(@adeptofvoltron)*
- 🛠️ Add parseCommaSeparatedList() helper and adopt it across CLI/API handlers (#2363). (#4178) *(@adeptofvoltron)*
- 🛠️ Prefer the canonical .agents/skills dir in install-skills (#4155). (#4164) *(@adeptofvoltron)*
- 🛠️ Bump minor-and-patch dependency group (65 updates). (#4161) *(@pkarw)*
- 🛠️ Rename "Storage" nav group to "Media". (#3731) *(@jtomaszewski)*

## 🧪 Testing
- 🧪 Stub DNS in the redirect-hop tests so develop is green again (#4515). (#4516) *(@wojciechszyjka)*

## 📝 Specs & Documentation
- 📝 Migrate legal entity from CT Tornado to Open Mercato sp. z o.o. (#4755) *(@pkarw)*
- 📝 Publish Enterprise License Agreement Terms v2.2. (#4610) *(@matgren)*
- 📝 Fit the root AGENTS.md into Codex's 32 KiB instruction budget (#4484). (#4506) *(@wojciechszyjka)*
- 📝 Note that finishing the self-QA exception needs `triage` permission (#4478). (#4498) *(@wojciechszyjka)*
- 📝 Clarify three-store architecture, fix stale naming, add evolution spec. (#4492) *(@jtomaszewski)*
- 📝 Exempt tested no-UI changes from manual QA (supersedes #4448). (#4461) *(@wojciechszyjka, via @pkarw)*
- 📝 Complete Polish translations and drop duplicated integrations keys (#2077). (#4452) *(@wojciechszyjka)*
- 📝 Sync agent-pipeline tracker & browser descriptors. (#4393) *(@pkarw)*
- 📝 Specify secure durable user tasks. (#4336) *(@pmadajthey)*
- 📝 Specify reliable completion events (carry #4314) (supersedes #4314). (#4321) *(@PatrickMade, via @pkarw)*
- 📝 Specify stable activity output paths (carry #4312) (supersedes #4312). (#4320) *(@PatrickMade, via @pkarw)*
- 📝 Sync skill roster and docs with skills collection consolidation. (#4296) *(@pkarw)*
- 📝 Import om-gap-analysis + om-app-spec-writing as repo-local analysis tier. (#4276) *(@matgren, via @pkarw)*
- 📝 DS developer-experience roadmap — brand import, UX walkthroughs, mockup composer. (#4270) *(@zielivia)*
- 📝 Specify scoped member directory. (#4200) *(@pmadajthey)*
- 📝 Add banner promoting open-mercato/skills. (#4152) *(@pkarw)*

## 👥 Contributors

- @MStaniaszek1998
- @mkadziolka
- @jakubsobczak-syhi
- @adeptofvoltron
- @wojciechszyjka
- @tomaszscigalacshark
- @DarrenStasiakDev4You
- @WebEferen
- @jtomaszewski
- @zielivia
- @matgren
- @Marynat
- @ArtSadWLC
- @pkarw
- @patzick
- @goer
- @hubert-madej-softiq
- @dominikpalatynski
- @andrzejewsky
- @haxiorz
- @migace
- @helloandygithub
- @vloneskorpion
- @piotrchabros
- @pat-lewczuk
- @PatrickMade
- @KamilGrocholski
- @pmadajthey

---

# 0.6.6 (2026-07-17)

## Highlights

Open Mercato `0.6.6` is a big **tighten-the-bolts release** with a lot of new shine on top. The headline is trust: a sweeping 270-fix pass locks down tenant and organization scoping, closes permission gaps across customer accounts, dashboards, messages, attachments, and the AI assistant, and rolls out **unified optimistic locking** everywhere — so concurrent edits stop quietly stepping on each other, and money and orders behave.

This release also runs **noticeably lighter**. A broad performance-and-footprint push trims resource usage across the board: selectable dev-mode watch scopes and the `OM_WATCH_SCOPE` memory lever, per-module CPU/RAM insight, lazy-loaded module commands, a shared dev scheduler/worker, throttled coverage warmup, coalesced job-update broadcasts, and a wide response-cache sweep over detail, list, and unread-count APIs — all backed by a new structured **pino logging** facade. On top of that, **CRM steals the show** with a full calendar (day/week/month/agenda) and a responsive event editor, configurable interaction statuses, and a new deals map view, while the ecosystem opens up with a shared **`om-*` skills mixin**, OpenRouter and Requesty AI presets, a two-way **Discord channel**, hardened MCP keys, signed webhooks, and a batch of security-CVE bumps. Enjoy!

## ✨ Features
- ✨ Adopt skills mixin in the standalone create-app template (stacked on #4008). (#4026) *(@pkarw)*
- ✨ Install shared om-* skills from open-mercato/skills (mixin). (#4008) *(@pkarw)*
- ✨ Configurable, dictionary-backed CRM interaction statuses (supersedes #3341). (#3675) *(@matgren, via @patzick)*
- ✨ First-class bulk-import side-effect suppression. (#4014) *(@KamilGrocholski)*
- ✨ Document OM_WATCH_SCOPE dev-memory lever + emoji watch-mode log. (#3962) *(@pkarw)*
- ✨ Auto-discover module fact-sheets beyond the core allowlist (#3752). (#3798) *(@adeptofvoltron)*
- ✨ Add per-module CPU/RAM resource-usage tracking. (#3760) *(@patzick)*
- ✨ Allow disabling EU unit price presentation per tenant. (#3753) *(@jtomaszewski)*
- ✨ Add Unarchive bulk action to Archived folder (#3578). (#3736) *(@adeptofvoltron)*
- ✨ Route home through /start with dismissible start page. (#3734) *(@jtomaszewski)*
- ✨ Allow forcing a locale via OM_FORCE_LOCALE. (#3724) *(@jtomaszewski)*
- ✨ Ts-morph module fact-sheets generator. (#3715) *(@adeptofvoltron)*
- ✨ Cache GET /api/customers/deals/[id] detail (#3665). (#3712) *(@adeptofvoltron)*
- ✨ Cache GET /api/customers/companies/[id] detail with reused crud tags (#3664). (#3711) *(@adeptofvoltron)*
- ✨ Cache GET /api/customers/people/[id] detail (#3663). (#3709) *(@adeptofvoltron)*
- ✨ Lazy load module commands. (#3703) *(@patzick)*
- ✨ Support OpenRouter runtime configuration (supersedes #3680). (#3694) *(@pmadajthey, via @patzick)*
- ✨ Selectable dev-mode watch scope (all / auto-optimized / popular / env). (#3648) *(@pkarw)*
- ✨ Unified optimistic-locking coverage across CRM v2 and all OSS lock sites (supersedes #3232). (#3647) *(@haxiorz, via @pkarw)*
- ✨ Paginate run-detail error logs. (#3637) *(@KamilGrocholski)*
- ✨ Public seam to resolve a CatalogProduct by SKU or externalId. (#3589) *(@adeptofvoltron)*
- ✨ SalesOrderService.findByExternalReference(). (#3588) *(@adeptofvoltron)*
- ✨ Add delete methods to ExternalIdMappingService. (#3587) *(@adeptofvoltron)*
- ✨ Add Requesty as an OpenAI-compatible provider preset. (#3560) *(@Thibaultjaigu)*
- ✨ Support dictionary custom field multiselect (supersedes #3423). (#3548) *(@pmadajthey, via @pkarw)*
- ✨ Add label-based package previews. (#3497) *(@patzick)*
- ✨ Set safe QueryClient defaults. (#3471) *(@haxiorz)*
- ✨ Add Discord two-way communication channel + AI bot spec. (#3387) *(@pkarw)*
- ✨ Add QueryIndexesTable component for monitoring entity index status. (#3321) *(@yaotzin1)*
- ✨ Cache GET /api/dictionaries/[id]/entries (reuse crud:dictionaries.entry tags). (#3158) *(@adeptofvoltron)*
- ✨ Cache GET /api/notifications/unread-count. (#3157) *(@adeptofvoltron)*
- ✨ Cache GET /api/messages/unread-count (reuse crud:messages.message tags) (#2915). (#3155) *(@adeptofvoltron)*
- ✨ Tenant-scoped search settings + verified provider availability. (#3153) *(@adeptofvoltron)*
- ✨ Add spec tracking-issue mode to om-followup-issue-from-pr. (#3148) *(@pkarw)*
- ✨ Cache GET /api/currencies/options (reuse crud:currencies.currency tags). (#3142) *(@adeptofvoltron)*
- ✨ Add --agents flag for non-interactive agentic setup. (#3134) *(@MStaniaszek1998)*
- ✨ Allow third-party module packages via --allow-third-party. (#3133) *(@adeptofvoltron)*
- ✨ Add year/month grid navigation to Calendar header. (#3131) *(@pkarw)*
- ✨ Add edit & delete actions for order returns. (#3066) *(@pkarw)*
- ✨ Improve visibility of Product SEO Helper validation when save is blocked. (#3057) *(@zielivia)*
- ✨ CRM Calendar — day/week/month/agenda views + responsive event editor. (#3044) *(@haxiorz)*
- ✨ Compliance & commercial product fields batch (PL/EU). (#3040) *(@haxiorz)*
- ✨ Fail-loud production guard for single-instance strategies (#2987). (#3030) *(@adeptofvoltron)*
- ✨ Add deals map view tab. (#3028) *(@haxiorz)*

## 🔒 Security
- 🔒 Gate progress read routes on requireFeatures['progress.view'] (#3886). (#4013) *(@Paul-Mlodochowki)*
- 🔒 Route entities Export CSV through the shared serializer (#3982). (#4001) *(@pkarw)*
- 🔒 Clear nodemailer/undici high audit findings and stabilize standalone integration CI. (#3390) *(@pkarw)*
- 🔒 Bump undici resolution to 7.28.0 to clear high CVE. (#3355) *(@pat-lewczuk)*
- 🔒 Clear high-severity protobufjs & ws CVEs via patched resolutions. (#3107) *(@pkarw)*
- 🔒 Pass MCP API key via env var, not command-line argv (#2669). (#3021) *(@adeptofvoltron)*
- 🔒 Mcp:dev bounds API-key lookup to project root and checks file permissions (#2671). (#3020) *(@adeptofvoltron)*
- 🔒 Harden latent MCP server-config module — SSRF guard + CSPRNG ids. (#3019) *(@adeptofvoltron)*
- 🔒 Self-heal HashicorpVaultKmsService instead of staying unhealthy for the instance lifetime (#2661). (#3016) *(@adeptofvoltron)*
- 🔒 Rate-limit AI chat dispatch routes. (#3012) *(@adeptofvoltron)*
- 🔒 Prevent custom headers from overriding Standard Webhooks signature headers (#2922). (#3001) *(@adeptofvoltron)*
- 🔒 Cap definitions.batch array to 1000 entries (#2924). (#2992) *(@adeptofvoltron)*
- 🔒 Harden attachment copy/clone scope against partial-null rows (#2879). (#2991) *(@pkarw)*
- 🔒 Mask GET credentials, write-only secret handling (#2253). (#2881) *(@pkarw)*
- 🔒 HMAC-authenticate mock inbound webhook adapter (#2707). (#2790) *(@pat-lewczuk)*
- 🔒 Complete report-high.md tracker (16 HIGH findings) + dev-DX password amendment. (#2635) *(@pat-lewczuk)*

## 🐛 Fixes
- 🔐 Restrict event catalog access (#3860). (#4136) *(@haxiorz)*
- 🔐 Honor trusted SSE organization scope (#3861). (#4135) *(@haxiorz)*
- 💰 Invalidate order cache after return mutations. (#4130) *(@andrzejewsky)*
- 🔧 Back tenant-context AsyncLocalStorage with globalThis to survive bundler duplication. (#4126) *(@pkarw)*
- 🔧 Surface drain-child diagnostics + pin absolute sqlite cache path in standalone CI. (#4118) *(@pkarw)*
- 🔧 Use a cross-process cache strategy in standalone integration lanes. (#4117) *(@pkarw)*
- 💰 Drop Stripe metadata-trust scope fallback + dead helper (#3866, #3865). (#4115) *(@haxiorz)*
- 🐛 Annotate unauthenticated override probe (#3864). (#4114) *(@haxiorz)*
- 🔐 Scope todo command snapshots (#3863). (#4113) *(@haxiorz)*
- 🔐 Restrict email body access (#3868). (#4111) *(@haxiorz)*
- 🔐 Require manage permission for proposal translation (#3867). (#4110) *(@haxiorz)*
- 🔐 Redact integration credential URL userinfo (#3870). (#4108) *(@haxiorz)*
- 🔐 Validate direct notification recipient scope (#3873). (#4100) *(@haxiorz)*
- 🔐 Guard message enrichment by participant (#3872). (#4099) *(@haxiorz)*
- 🐛 Return 400 for invalid notification restore status. (#4090) *(@haxiorz)*
- 💰 Align payment gateway status guard resource kind (#3881). (#4081) *(@haxiorz)*
- 🔐 Prevent planner availability authorization regression (#3883). (#4079) *(@haxiorz)*
- 🔧 Harden MCP dev config loading (#4039). (#4077) *(@haxiorz)*
- 🔧 Safely quote discovered table names (#4040). (#4069) *(@haxiorz)*
- 🔐 Secure attachment temp files (#4045). (#4067) *(@haxiorz)*
- 🐛 Route vendor-prefixed model ids to OpenAI-compatible gateways (OpenRouter) (supersedes #4009). (#4029) *(@jtomaszewski, via @pkarw)*
- 🔄 Back data_sync adapter registry with globalThis to survive bundler duplication (supersedes #3999). (#4025) *(@KamilGrocholski, via @pkarw)*
- 🐛 Calendar activity types from dictionary + CrudForm event editor with resources/staff (#3552). (#3747) *(@zielivia)*
- 🔧 Remove duplicate CommandRuntimeContext import breaking develop build. (#4022) *(@pat-lewczuk)*
- 🐛 Restore bulk-deal command dispatch in standalone CI. (#4020) *(@patzick)*
- 🔧 Throttle query-index status refresh (#3888). (#4017) *(@haxiorz)*
- 🔐 Bind portal customer auth to URL org (#3885). (#4016) *(@haxiorz)*
- 🔐 Prevent resources timeline author spoofing. (#4012) *(@haxiorz)*
- 🐛 Cap active record locks per user. (#4011) *(@haxiorz)*
- 💰 Gate sales document address access. (#4010) *(@haxiorz)*
- 🔧 Restore missing CommandRuntimeContext import (unblocks release PR #3594). (#4005) *(@pkarw)*
- 🌍 Translate invite-to-portal widget copy (#3953). (#4002) *(@Paul-Mlodochowki)*
- 💰 Derive sales note authors from auth (#3896). (#3998) *(@haxiorz)*
- 💰 Gate sales notes CRUD by document ACL (#3893). (#3997) *(@haxiorz)*
- 💰 Enforce sales document history ACL. (#3996) *(@haxiorz)*
- 🔧 Fix scoped search reindex cancellation. (#3992) *(@haxiorz)*
- 🔧 Bind scheduler command context to schedule scope (#3899). (#3989) *(@haxiorz)*
- 💰 Redact shipping carrier upstream errors (#3903). (#3987) *(@haxiorz)*
- 🔐 Require explicit SSO role mappings (#3904). (#3986) *(@haxiorz)*
- 💰 Require shipment ownership for tracking lookups (#3902). (#3985) *(@haxiorz)*
- 🔐 Scope SCIM token generation (#3907). (#3984) *(@haxiorz)*
- 🔐 Prevent overlapping active SSO domains. (#3983) *(@haxiorz)*
- 🔐 Enforce organization scope on SCIM logs. (#3980) *(@haxiorz)*
- 🔐 Scope staff command target loads. (#3979) *(@haxiorz)*
- 🔧 Fail closed for null-tenant command scope. (#3978) *(@haxiorz)*
- 🔐 Scope staff audit snapshot loaders. (#3977) *(@haxiorz)*
- 🐛 Restore customer detail invite widgets (supersedes #3522). (#3976) *(@pmadajthey, via @pkarw)*
- 🔧 Remove stray `ded` token breaking AdvancedFilterPanel typecheck. (#3966) *(@pkarw)*
- 🔧 Clarify lazy background service logs. (#3964) *(@pkarw)*
- 🔐 Harden integration login redirect loop diagnostics. (#3963) *(@vloneskorpion)*
- 🐛 Allow shared S3 namespace reads (#3918). (#3960) *(@haxiorz)*
- 🔄 Scope sync-akeneo option schema lookup (#3921). (#3957) *(@haxiorz)*
- 🔄 Stop duplicating sync_excel upload payloads. (#3956) *(@haxiorz)*
- 🔄 Harden Akeneo URL DNS guard (#3920). (#3955) *(@haxiorz)*
- 🔄 Scope sync_excel email dedupe index (#3924). (#3951) *(@haxiorz)*
- 🐛 Neutralize CSV formula cells in exports. (#3949) *(@haxiorz)*
- 🌍 Scope supported locales per tenant (#3926). (#3947) *(@haxiorz)*
- 🔧 Harden inbound webhook rate-limit IP keying (#3929). (#3944) *(@haxiorz)*
- 🐛 Fix staff active timer shared state. (#3399, #3942) *(@haxiorz, via @pkarw)*
- 🔐 Guard workflow private webhook flag in production (#3934). (#3940) *(@haxiorz)*
- 🔐 Restrict workflow env interpolation (#3932). (#3939) *(@haxiorz)*
- 🔐 Prevent workflow initiatedBy spoofing (#3931). (#3938) *(@haxiorz)*
- 📦 Classify runtime @types as deps and harden OSM tile host check. (#3800) *(@patzick)*
- 🔧 Batch search token rebuild silently loses all tokens on large batches. (#3791) *(@KamilGrocholski)*
- 🐛 Support "All organizations" scope on deals filter-bar endpoints (#3768). (#3790) *(@adeptofvoltron)*
- 💰 Preserve order paid/refunded totals when creating a return (#3756). (#3789) *(@adeptofvoltron)*
- 🐛 Stop misleading 401 for superadmin all-orgs uploads/deletes (#3764). (#3786) *(@adeptofvoltron)*
- 🐛 Explicit comparators in deals-map cache-key sorts (unblocks develop test job). (#3782) *(@zielivia)*
- 🔄 Sync create-app dispatcher template + always-run parity guard. (#3781) *(@patzick)*
- 🐛 Contain attachment assignment row layout. (#3780) *(@vloneskorpion)*
- 🔧 Restore agentic:init parity with create-app fact-sheet scaffolding (TC-INT-008). (#3771) *(@pat-lewczuk)*
- 🔧 Reduce dev worker memory usage. (#3770) *(@andrzejewsky)*
- 💰 Portal top-bar search results out of the sticky header z-order trap (#3097). (#3769) *(@zielivia)*
- 🐛 Fit deal card quick actions. (#3746) *(@vloneskorpion)*
- 🐛 Keep overnight timers visible and stoppable after midnight (#3717). (#3741) *(@adeptofvoltron)*
- 🐛 Stop TimerBar elapsed drift when tab is throttled (#3718). (#3740) *(@adeptofvoltron)*
- 🐛 Add optimistic locking to definition edit form (#3152). (#3739) *(@adeptofvoltron)*
- 🐛 Pass event name to persistent subscribers. (#3738) *(@pmadajthey)*
- 🐛 Show status for non-pending proposal actions (#3671). (#3735) *(@adeptofvoltron)*
- 💰 Order Products before Categories in sidebar. (#3732) *(@jtomaszewski)*
- 🔄 Surface export item failures in run logs. (#3726) *(@adrianliw)*
- 🔐 Validate password policy on reset page before submit. (#3725) *(@jtomaszewski)*
- 🔧 Remove stale BullMQ repeatable jobs. (#3716) *(@mat-kruk)*
- 🔐 Translate German customer portal roles UI strings (#3669). (#3707) *(@adeptofvoltron)*
- 🐛 Restore decrypted JSON columns to objects on entity load (#3672). (#3706) *(@adeptofvoltron)*
- 🐛 Honor field-level readOnly in CrudForm inputs (#3704). (#3705) *(@adeptofvoltron)*
- 🐛 Surface credentials save conflict on unified bar (#3676). (#3702) *(@adeptofvoltron)*
- 🐳 Use args instead of command in ps for alpine support. (#3698) *(@yaotzin1)*
- 🐛 Repair deal loss reason closing (supersedes #3125). (#3673) *(@pmadajthey)*
- 🐛 Hide inherited custom fields via scoped tombstones. (#3668) *(@pmadajthey)*
- 🐛 Gate calendar event peek Edit button by manage permission. (#3655) *(@adeptofvoltron)*
- 🔐 Obey Rules of Hooks in DataTable, MFA page, feature_toggles (#3616). (#3653) *(@adeptofvoltron)*
- 🔐 Allow deleting customer portal roles (#3556). (#3652) *(@adeptofvoltron)*
- 🐛 Hide unsupported sender archive action. (#3645) *(@Heppe-SOFTIQ)*
- 🐛 Fall back to default Ollama URL when OLLAMA_BASE_URL is empty. (#3642) *(@adeptofvoltron)*
- 🔧 Guard nullable externalSignal deref in warmup fetch (#3617). (#3638) *(@adeptofvoltron)*
- 🐛 Defer optimistic-lock floor to authorized record-lock keep-mine. (#3602) *(@pkarw)*
- 🐛 Deep-link dictionary manage links (carry-forward of #3396). (#3599) *(@pmadajthey, via @pkarw)*
- 🐛 Toggle conversation actions menu by archived/read state. (#3591) *(@adeptofvoltron)*
- 🐛 Redirect to inbox after marking unread from detail. (#3590) *(@adeptofvoltron)*
- 🐛 Actions dropdown clips long localized labels. (#3585) *(@adeptofvoltron)*
- 📦 Dispatch package previews manually. (#3571) *(@patzick)*
- 🐛 Defer OSS optimistic-lock 409 to conflict bar, not merge dialog. (#3569) *(@pkarw)*
- 🐛 Route timesheet timer writes through guards (supersedes #3398). (#3565) *(@haxiorz, via @pkarw)*
- 🐛 Stabilize all splash variants. (#3564) *(@patzick)*
- 🐛 Restrict message action commandId to declared allowlist (#3488). (#3559) *(@adeptofvoltron)*
- 🐛 Seal gross>0 ⇒ net>0 invariant at sales line persistence. (#3558) *(@adeptofvoltron)*
- 🐛 Provision pgvector in ephemeral integration Postgres. (#3557) *(@pkarw)*
- 🔐 Enforce target-tenant scope on auth.users.create. (#3555) *(@rajanbor)*
- 🐛 Localize timer errors, announce widget alert, fix dark Start contrast. (#3553) *(@adeptofvoltron)*
- 🐛 Accept incoming resolves OSS-floor 409 instead of dead-ending. (#3551) *(@adeptofvoltron)*
- 💰 Prevent ShipmentDialog infinite re-render loop when order has no address. (#3547) *(@adeptofvoltron)*
- 🌍 CRM calendar i18n & a11y polish. (#3546) *(@adeptofvoltron)*
- 🐛 Sort encrypted fields across all organizations. (#3545) *(@Heppe-SOFTIQ)*
- 🐛 Keep today's column in week view when weekends are hidden. (#3544) *(@adeptofvoltron)*
- 🐛 Load @app module ai-tools in standalone MCP loader. (#3543) *(@adeptofvoltron)*
- 🐛 Localize CRM calendar date/time labels. (#3541) *(@adeptofvoltron)*
- 💰 Regression-cover merged activities pagination order (P2 of #3386). (#3540) *(@rajanbor)*
- 🐛 Enforce LF via .gitattributes to stop CRLF NODE_ENV corruption. (#3539) *(@adeptofvoltron)*
- 🐛 Associate compliance field errors with inputs for a11y. (#3538) *(@adeptofvoltron)*
- 🐛 Surface server error reason when creating a return. (#3536) *(@adeptofvoltron)*
- 🐛 Wrap decision-makers tooltip in TooltipProvider. (#3535) *(@adeptofvoltron)*
- 💰 PayPage DS controls (carry-forward of #3467 + develop merge). (#3513) *(@pkarw)*
- 🐛 Stabilize ephemeral and standalone checks. (#3508) *(@patzick)*
- 🐛 Fix broken override-list test (em.count not mocked) — unblocks develop CI. (#3506) *(@pkarw)*
- 🐛 Dev splash stream and language picker. (#3496) *(@patzick)*
- 🐛 Stabilize organization switcher hooks. (#3491) *(@Heppe-SOFTIQ)*
- 🐛 Align starter chrome with design system. (#3473) *(@haxiorz)*
- 🐛 Speed up injection widget lookup. (#3472) *(@haxiorz)*
- 🐛 Migrate workflow dialogs to DS primitives. (#3468) *(@haxiorz)*
- 🔐 Fix auth and onboarding feedback tokens. (#3466) *(@haxiorz)*
- 🐛 Align field definitions editor controls. (#3465) *(@haxiorz)*
- 🐛 Use functional state setters in editor/demo components. (#3459) *(@haxiorz)*
- 🐳 Add jq to Dockerfile apt-get dependencies. (#3455) *(@rajanbor)*
- 🐛 Wire mutation guard lifecycle to sales settings PUT routes. (#3454) *(@rajanbor)*
- 🐛 Replace raw controls and hardcoded status colors in catalog injection widgets. (#3444) *(@haxiorz)*
- 🔧 Make cache manage UI gating wildcard-aware. (#3442) *(@haxiorz)*
- 🐛 Route cache purge UI writes through guarded mutations. (#3441) *(@haxiorz)*
- 🔧 Replace hardcoded status and error colors in config panels. (#3440) *(@haxiorz)*
- 🐛 Route currencies non-CrudForm UI writes through guarded mutations. (#3438) *(@haxiorz)*
- 🔧 Replace currencies fetch-config raw controls and hardcoded status styling. (#3437) *(@haxiorz)*
- 🐛 Wrap detail-page writes in useGuardedMutation. (#3436) *(@haxiorz)*
- 🔧 Enforce optimistic locking on currency fetch-config updates. (#3435) *(@haxiorz)*
- 🐛 Wire mutation guards into messages write routes. (#3433) *(@haxiorz)*
- 🐛 Claim terminal actions before executing target commands. (#3432) *(@haxiorz)*
- 🐛 Make terminal actions concurrency-safe before executing target commands. (#3431) *(@haxiorz)*
- 🐛 Enforce optimistic locking for message draft edits and actions (#3260). (#3430) *(@haxiorz)*
- 🐛 Wrap notification client writes in useGuardedMutation. (#3428) *(@haxiorz)*
- 🐛 Wire mutation guards for notification write routes. (#3427) *(@haxiorz)*
- 🐛 Prevent repeated notification action execution. (#3426) *(@haxiorz)*
- 🐛 Notifications do not update local state after failed API writes. (#3425) *(@haxiorz)*
- 💰 Make status refresh a guarded write instead of a mutating GET. (#3422) *(@haxiorz)*
- 💰 Wire mutation guards for payment gateway write routes. (#3421) *(@haxiorz)*
- 🐛 Route DataTable perspective writes through useGuardedMutation. (#3420) *(@haxiorz)*
- 💰 Enforce status-machine transitions on manual payment gateway actions. (#3419) *(@haxiorz)*
- 🐛 Encrypt gateway transaction secrets and provider payloads (#3272). (#3418) *(@haxiorz)*
- 🐛 Wire availability bulk POST routes through mutation guard lifecycle. (#3416) *(@haxiorz)*
- 🐛 Route non-CrudForm planner availability writes through useGuardedMutation. (#3415) *(@haxiorz)*
- 🐛 Enforce optimistic lock on planner date-specific availability replace. (#3414) *(@haxiorz)*
- 🐛 Route reindex/purge writes through mutation guard. (#3413) *(@haxiorz)*
- 🐛 Fix perspectives mutation guard lifecycle. (#3412) *(@haxiorz)*
- 🐛 Enforce optimistic locking. (#3411) *(@haxiorz)*
- 🔄 Batch status coverage reads, drop inline refresh on polls. (#3410) *(@haxiorz)*
- 🐛 Use live-row uniqueness for saved perspectives. (#3409) *(@haxiorz)*
- 🐛 Scope worker lifecycle methods by organizationId. (#3408) *(@haxiorz)*
- 🔧 Route non-CrudForm sales config writes through useGuardedMutation. (#3407) *(@haxiorz)*
- 🐛 Make resource-type counts opt-in to avoid full resources scan. (#3406) *(@haxiorz)*
- 🐛 Wire command-backed POST routes through mutation guards. (#3404) *(@haxiorz)*
- 🐛 Guard tag assignment routes. (#3403) *(@haxiorz)*
- 🌍 Wire custom write routes through mutation guards. (#3402) *(@haxiorz)*
- 🌍 Route TranslationManager writes through useGuardedMutation. (#3401) *(@haxiorz)*
- 🐛 Inline timesheet description save handles failed API responses. (#3400) *(@haxiorz)*
- 🐛 Send optimistic-lock header when toggling workflow definition enabled state. (#3397) *(@haxiorz)*
- 🐛 Bounded encrypted-sort for interactions + labels (P1 of #3386). (#3395) *(@rajanbor)*
- 🐛 Scope assigned role lookup to the current tenant. (#3394) *(@rajanbor)*
- 🐛 Scope dashboard hidden-widget preference by org and user (fixes #3283). (#3392) *(@rajanbor)*
- 📦 Wrap marketplace and bundle writes in useGuardedMutation. (#3385) *(@pat-lewczuk)*
- 🐛 Return and enforce real optimistic-lock versions for state and credentials. (#3384) *(@pat-lewczuk)*
- 🐛 Reload counts and settings when organization scope changes. (#3382) *(@pat-lewczuk)*
- 🐛 Guard manual health-check mutations. (#3381) *(@pat-lewczuk)*
- 🐛 Make draft reply sends idempotent before calling Resend. (#3380) *(@pat-lewczuk)*
- 🐛 Align override list OpenAPI schema with live response. (#3379) *(@pat-lewczuk)*
- 🐛 Wire proposal and email custom write routes through mutation guards. (#3377) *(@pat-lewczuk)*
- 🐛 Show falsy defaults and call useT unconditionally. (#3376) *(@pat-lewczuk)*
- 🔧 Make custom record search pagination-aware (#3229). (#3375) *(@pat-lewczuk)*
- 🐛 Global table deletes send optimistic-lock header. (#3374) *(@pat-lewczuk)*
- 🐛 Guard encryption map saves and reject stale writes. (#3373) *(@pat-lewczuk)*
- 🐛 Enforce stale-delete protection for custom entity records. (#3372) *(@pat-lewczuk)*
- 🐛 Route override saves through mutation guard lifecycle. (#3371) *(@pat-lewczuk)*
- 🐛 Bound tenant custom-field filters before pagination. (#3370) *(@pat-lewczuk)*
- 🐛 Route custom entity definition writes through mutation guards. (#3369) *(@pat-lewczuk)*
- 🐛 Route tenant and organization list deletes through useGuardedMutation. (#3368) *(@pat-lewczuk)*
- 🐛 Harden organization branding PUT with mutation guards and optimistic locking. (#3367) *(@pat-lewczuk)*
- 🐛 Load all tenants in TenantSelect via pagination. (#3366) *(@pat-lewczuk)*
- 🔄 Wire run table search into the runs API query (#3215). (#3365) *(@pat-lewczuk)*
- 🐛 Route dictionary UI writes through useGuardedMutation. (#3364) *(@pat-lewczuk)*
- 🐛 Add mutation guard lifecycle to custom write routes. (#3363) *(@pat-lewczuk)*
- 🐛 Enforce optimistic locks on dictionary and entry deletes. (#3362) *(@pat-lewczuk)*
- 🔄 Create ProgressJobs for scheduled sync runs. (#3361) *(@pat-lewczuk)*
- 🔄 Guard custom write routes with mutation guard. (#3360) *(@pat-lewczuk)*
- 🐛 Add mutation guards to custom dashboard write APIs. (#3359) *(@pat-lewczuk)*
- 🔄 Wrap schedule and run lifecycle UI writes in useGuardedMutation. (#3358) *(@pat-lewczuk)*
- 🐛 Wrap widget visibility saves in useGuardedMutation. (#3357) *(@pat-lewczuk)*
- 🔧 Wrap config writes in useGuardedMutation. (#3354) *(@pat-lewczuk)*
- 🐛 Guard custom command routes with mutation guard. (#3353) *(@pat-lewczuk)*
- 🔧 Replace raw detail and config controls with shared UI primitives. (#3351) *(@pat-lewczuk)*
- 🔐 Replace raw role controls and hardcoded widget status colors (#3199). (#3349) *(@pat-lewczuk)*
- 🔐 Guard role ACL updates with optimistic locking and mutation guard. (#3348) *(@pat-lewczuk)*
- 🐛 Wrap remaining non-CrudForm writes in useGuardedMutation. (#3346) *(@pat-lewczuk)*
- 🐛 Emit invitation-created events from admin and portal invite routes. (#3344) *(@pat-lewczuk)*
- 🐛 Align demo credential copy with seeded password. (#3343) *(@pat-lewczuk)*
- 🐛 Wire mutation guard lifecycle for shipment create and cancel. (#3340) *(@haxiorz)*
- 🐛 Guard shipment wizard create. (#3339) *(@haxiorz)*
- 🐛 Parallelize independent tag create/assign operations (#3291). (#3338) *(@adeptofvoltron)*
- 🐛 Replace hardcoded external-id status colors with status tokens. (#3336) *(@adeptofvoltron)*
- 🐛 Replace raw NotificationPanel buttons with primitives (#3267). (#3334) *(@adeptofvoltron)*
- 🐛 Use StatusBadge for tracking status. (#3332) *(@haxiorz)*
- 🐛 Load time-reporting widget timer state in parallel (#3306). (#3329) *(@adeptofvoltron)*
- 🐛 Add shipment-create idempotency contract. (#3328) *(@haxiorz)*
- 🔄 Make shipping tracking GET read-only; add guarded POST /tracking/refresh. (#3327) *(@haxiorz)*
- 🌍 Replace raw TranslationManager buttons with primitives. (#3326) *(@adeptofvoltron)*
- 🔄 Replace hardcoded run status badge colors with StatusBadge. (#3325) *(@adeptofvoltron)*
- 🌍 Replace native fetch access probe (#3317). (#3324) *(@adeptofvoltron)*
- 🐛 Atomic start-timer command so timer start can't orphan an entry. (#3322) *(@haxiorz)*
- 🔄 Refresh settings pages on tenant/org scope change (#3234). (#3282) *(@adeptofvoltron)*
- 🐛 Bound encrypted-field sort with two-phase fetch + chunked decrypt. (#3278) *(@rajanbor)*
- 🔄 Avoid refetching dictionary list when selection changes. (#3247) *(@adeptofvoltron)*
- 🐛 Pin eslint back to ^9 to restore Next eslint toolchain. (#3244) *(@matgren)*
- 🐛 Surface conflicts for weekly schedule edits. (#3185) *(@wwaleszczykSoftiq)*
- 💰 Require shipped quantity before creating returns (#3034). (#3156) *(@adeptofvoltron)*
- 🐛 Propagate strategy index/delete/purge failures so the queue retries. (#3139) *(@adeptofvoltron)*
- 🔐 Stop login feature-check refiring when tenant banner is cleared (#3128). (#3137) *(@adeptofvoltron)*
- 🔐 Drop redundant tenant descriptor from login banner. (#3136) *(@adeptofvoltron)*
- 🐛 Adjust labels tenant #3127. (#3135) *(@amtkacper)*
- 🐛 Reject future return dates on create & edit. (#3124) *(@adeptofvoltron)*
- 🐛 Skip system-entity registration POST so custom-field edit works. (#3123) *(@adeptofvoltron)*
- 🐛 Add optimistic locking to entity definition edit form. (#3120) *(@pkarw)*
- 🐛 Inline persistent event delivery in the ephemeral env to de-flake TC-CRM-028 & TC-WF-008. (#3113) *(@pkarw)*
- 🐛 Recover a crashed deferred-provisioning runner in seconds, not 10 minutes (TC-ONB-002). (#3102) *(@pkarw)*
- 🐛 Default-on single-delivery with worker guard; stop onboarding waiting on inline reindex. (#3101) *(@pkarw)*
- 🐛 Mark workspace ready without waiting for the inline query-index rebuild. (#3095) *(@pkarw)*
- 🐛 Preflight vector indexing; skip doomed runs with one warning. (#3094) *(@pkarw)*
- 🐛 Bulkhead background workers against DB connection-pool exhaustion. (#3089) *(@pkarw)*
- 🐛 CrudForm group field-injection honors placement and renders label once (#3047). (#3087) *(@adeptofvoltron)*
- 🐛 Honor formEditable:false in CrudForm custom-fields section (#3048). (#3086) *(@adeptofvoltron)*
- 🔄 Sync CustomFieldKind with runtime kinds + add cf.date/cf.datetime. (#3080) *(@adeptofvoltron)*
- 🐛 Preserve module data in Railway uploads. (#3072) *(@pkarw)*
- 💰 Reject zero-value Return adjustments to protect the Returns flow (#3037). (#3061) *(@pkarw)*
- 💰 Credit return net total when a line has a zeroed stored net (#3036). (#3060) *(@pkarw)*
- 🐛 Allow clearing company legal/brand/size/revenue/description fields. (#3059) *(@pkarw)*
- 💰 Show addresses on person v2 detail + decrypt address snapshots (#3038). (#3046) *(@haxiorz)*
- 🐛 Keep DataTable columns and pagination footer usable on mobile. (#3043) *(@haxiorz)*
- 🐛 Declare active-participants partial index to stop spurious drop-index migration (#3025). (#3029) *(@adeptofvoltron)*
- 🐛 Add flag-gated single-delivery dispatch for persistent subscribers (#2960). (#3018) *(@adeptofvoltron)*
- 🐛 Memoize persistent-events BullMQ producer process-wide to stop per-request Redis connection leaks (#2959). (#3017) *(@adeptofvoltron)*
- 🔐 Fail closed when MCP stdio server has no auth context (#2673). (#3015) *(@adeptofvoltron)*
- 🔄 Cap Akeneo 429 retries, clamp retry-after, add AbortSignal timeouts to external HTTP calls (#2976). (#3014) *(@adeptofvoltron)*
- 🐛 Expose updatedAt in super-admin org manage view so optimistic locking works. (#3013) *(@adeptofvoltron)*
- 🔧 Worker --all isolates each job in its own request container (#2970). (#3011) *(@adeptofvoltron)*
- 🐛 Stop InjectionSpot remounting widgets on context-identity changes (#2986). (#3006) *(@adeptofvoltron)*
- 🐛 Version-check & bump rule set on weekly hours save. (#2996) *(@adeptofvoltron)*
- 🔧 Bound createMemoryStrategy with LRU maxEntries eviction + amortized expired-entry sweep (#2962). (#2995) *(@adeptofvoltron)*
- 🐛 Decrypt encrypted entities on read in sales commands. (#2884) *(@pkarw)*
- 🔐 Pin logout/session-refresh redirects to allowlisted origin (#2686). (#2876) *(@pkarw)*
- 🐛 Keep timesheet grid decimal edits through blur. (#2845) *(@pmadajthey)*
- 🐛 Surface per-field validation errors on signup form (#2081). (#2088) *(@pat-lewczuk)*
- 🔐 Don't force-logout all users on a transient DB failure. (#4191) *(@patzick)*
- 🐛 Repair legacy checkout demo webhook failure. (#4193) *(@patzick)*
- 🐛 Commit CALL_API one-time key outside execution transaction. (#4210) *(@patzick)*
- 💰 Checkout demo order includes cart lines and non-zero totals. (#4213) *(@patzick)*

## 🛠️ Improvements
- 🛠️ Share scheduler with lazy worker in dev mode. (#4125) *(@andrzejewsky)*
- 🛠️ Retire legacy core.<module>.md redirect-stub layer (#3754). (#4080) *(@adeptofvoltron)*
- 🛠️ Bump js-yaml from 3.14.2 to 3.15.0. (#4075) *(@pkarw)*
- 🛠️ Structured logging facade backed by pino (fixes #3743). (#4003) *(@pat-lewczuk)*
- 🛠️ Bump actions/cache from 5 to 6. (#3968) *(@pkarw)*
- 🛠️ Bump mermaid from 11.12.2 to 11.16.0 in apps/docs. (#3967) *(@pkarw)*
- 🛠️ Throttle coverage refresh and de-spike warmup. (#3776) *(@patzick)*
- 🛠️ Route Product SEO Helper validation messages through i18n (#3299). (#3775) *(@zielivia)*
- 🛠️ Port Dependabot dependency updates to develop (#3695 #3696 #3699 #3708). (#3772) *(@pkarw)*
- 🛠️ Structured logging facade for @open-mercato/shared (#3743). (#3744) *(@pat-lewczuk)*
- 🛠️ Move currency management into Settings. (#3730) *(@jtomaszewski)*
- 🛠️ Coalesce per-record job.updated flush + broadcast (#2972). (#3720) *(@rajanbor)*
- 🛠️ Improve dev memory and sidebar icons. (#3693) *(@andrzejewsky)*
- 🛠️ Run custom-route writes through the full mutation-guard registry (#3619). (#3657) *(@adeptofvoltron)*
- 🛠️ Explicit comparators for bare Array.sort()/toSorted() calls (#3620). (#3654) *(@adeptofvoltron)*
- 🛠️ Extract shared customers ai-tools helpers (companies/people packs). (#3644) *(@adeptofvoltron)*
- 🛠️ Drop dead/misleading loop-counter reassignments in matchRoutePattern. (#3641) *(@adeptofvoltron)*
- 🛠️ Remove dead always-true comparison in getSystemProbe (#3621). (#3639) *(@adeptofvoltron)*
- 🛠️ Audit encrypted-sort safety for sync-akeneo discovery and messages GET. (#3600) *(@rajanbor)*
- 🛠️ Update mutation guard guidance. (#3519) *(@truongx)*
- 🛠️ Bump http-proxy-middleware from 2.0.9 to 2.0.10. (#3490) *(@pkarw)*
- 🛠️ Add dev memory trace attribution (fixes #3065). (#3478) *(@patzick)*
- 🛠️ Normalize module/package license metadata to MIT. (#3476) *(@matgren)*
- 🛠️ Align global error fallback with DS tokens. (#3474) *(@haxiorz)*
- 🛠️ Migrate workflows checkout demo to DS tokens and primitives. (#3464) *(@haxiorz)*
- 🛠️ Migrate remaining ErrorNotice call sites to Alert. (#3463) *(@haxiorz)*
- 🛠️ Keep @xyflow/react inside the lazy graph/editor boundary. (#3462) *(@haxiorz)*
- 🛠️ Parallelize independent detail refresh requests. (#3461) *(@haxiorz)*
- 🛠️ Mirror optimizePackageImports in standalone app template. (#3460) *(@haxiorz)*
- 🛠️ Hoist SalesDocumentForm custom render components out of the parent component. (#3458) *(@haxiorz)*
- 🛠️ Standardize browser storage state with versioned envelopes. (#3457) *(@haxiorz)*
- 🛠️ Derive checkout demo current step during render. (#3456) *(@haxiorz)*
- 🛠️ Parallelize legacy activity timeline fallback page fetches. (#3451) *(@haxiorz)*
- 🛠️ Parallelize deal detail API enrichment reads. (#3449) *(@haxiorz)*
- 🛠️ Lazy-load markdown preview rendering in inline editors. (#3448) *(@haxiorz)*
- 🛠️ Parallelize product-list filter prequeries. (#3447) *(@haxiorz)*
- 🛠️ Parallelize product and variant form page loaders. (#3446) *(@haxiorz)*
- 🛠️ Collapse duplicate MessageChannelLink lookups across message enrichers. (#3445) *(@haxiorz)*
- 🛠️ Sanitize channel HTML server-side, off the client render path. (#3443) *(@haxiorz)*
- 🛠️ Aggregate channel health counts in the database. (#3439) *(@haxiorz)*
- 🛠️ Parallelize independent provider fetches in rate fetching. (#3434) *(@haxiorz)*
- 🛠️ Improve Dockerfile dependency caching. (#3424) *(@pmadajthey)*
- 🛠️ Route raw writes through guarded mutations. (#3405) *(@haxiorz)*
- 🛠️ Version and scope persisted customer UI preferences. (#3393) *(@rajanbor)*
- 🛠️ Paginate override list in the database and avoid O(n²) merge. (#3378) *(@pat-lewczuk)*
- 🛠️ Fetch comparison widget data in parallel with primary query. (#3356) *(@pat-lewczuk)*
- 🛠️ Parallelize people and company detail API enrichment. (#3352) *(@pat-lewczuk)*
- 🛠️ Parallelize CRM display-name lookups on user detail. (#3345) *(@pat-lewczuk)*
- 🛠️ Guard cache.get read failure in unread-count route. (#3331) *(@adeptofvoltron)*
- 🛠️ Harden options cache — log set failures + defensive get fallback. (#3330) *(@adeptofvoltron)*
- 🛠️ Share a single injection registry-change DOM listener. (#3323) *(@adeptofvoltron)*
- 🛠️ Parallelize tag dialog option loading (#3202). (#3268) *(@adeptofvoltron)*
- 🛠️ Parallelize widget visibility editor initial loads (#3207). (#3262) *(@adeptofvoltron)*
- 🛠️ Skip role visibility lookups when user override selects widgets. (#3253) *(@adeptofvoltron)*
- 🛠️ Replace raw checkboxes and hardcoded status colors in admin UI. (#3252) *(@adeptofvoltron)*
- 🛠️ Use Checkbox primitive and DS status tokens in field editor. (#3246) *(@adeptofvoltron)*
- 🛠️ Gate tenant-aware stats() base.stats() call to memory backends. (#3238) *(@adeptofvoltron)*
- 🛠️ Consolidate HTTP clients onto shared fetchWithTimeout. (#3138) *(@adeptofvoltron)*
- 🛠️ Bump ai to 6.0.205 and @types/nodemailer to ^8.0.1. (#3121) *(@pkarw)*
- 🛠️ Bump launch-editor to 2.14.1 and @babel/core to 7.29.7. (#3119) *(@pkarw)*
- 🛠️ Avoid duplicate runtime Next output layer. (#3096) *(@pmadajthey)*
- 🛠️ Bound memory sweep, add eviction/sweep counters + env test. (#3091) *(@adeptofvoltron)*
- 🛠️ Widen Alert duplicate-icon guard scan to all packages/*/src (#3027). (#3078) *(@adeptofvoltron)*
- 🛠️ Migrate dependabot bumps (#3069, #3071) to develop. (#3074) *(@pkarw)*
- 🛠️ Memoize search singletons to avoid per-request connection leaks. (#3058) *(@rajanbor)*
- 🛠️ Consolidate joi, webpack-dev-server, esbuild bumps. (#3054) *(@pkarw)*
- 🛠️ Bump @grpc/grpc-js from 1.14.3 to 1.14.4. (#3041) *(@pkarw)*
- 🛠️ Env-gated statement_timeout/lock_timeout + finite idle-in-transaction default (#2964). (#3033) *(@adeptofvoltron)*
- 🛠️ Hoist the cache service to a process-wide singleton in bootstrap (#2961). (#3031) *(@adeptofvoltron)*
- 🛠️ Add missing hot-path indexes — search_tokens(tenant_id, token_hash) and user_roles(user_id)/(role_id) (#2966). (#3000) *(@adeptofvoltron)*
- 🛠️ Throttle access_logs rotation and index created_at (#2965). (#2999) *(@adeptofvoltron)*
- 🛠️ Trim detail-only JSONB snapshots from document list projection (#2233). (#2897) *(@pkarw)*
- 🛠️ Add organization sidebar logo branding. (#2822) *(@pmadajthey)*

## 🧪 Testing
- 🧪 Add TC-SEARCH-013 scoped reindex cancellation integration test. (#4000) *(@pkarw)*
- 🧪 Add integration test for action commandId allowlist guard (#3670). (#3710) *(@adeptofvoltron)*
- 🧪 Make thread-token HMAC-tamper test deterministic. (#3646) *(@adeptofvoltron)*
- 🧪 Add TC-CAL-010 calendar weekend today-column integration test. (#3592) *(@pkarw)*
- 🧪 Cover list-page enabled-toggle optimistic lock. (#3572) *(@pkarw)*
- 🧪 Integration test for auth.users.create tenant scope. (#3568) *(@pkarw)*
- 🧪 Integration tests for guarded-mutation UI writes (follow-up to #3438). (#3567) *(@pkarw)*
- 🧪 Migrate core integration specs to public helper imports. (#3237) *(@adeptofvoltron)*

## 📝 Specs & Documentation
- 📝 Add Exporting Data REST API guide (#59). (#4144) *(@DarrenStasiakDev4You)*
- 📝 Ephemeral-first test-env run mode in monorepo and create-app template. (#4095) *(@pkarw)*
- 📝 Retire RELEASE_NOTES.md — migrate deprecations to UPGRADE_NOTES (#4024). (#4027) *(@adeptofvoltron)*
- 📝 Remove obsolete ISSUE_LOG.md. (#4006) *(@pkarw)*
- 📝 Add informational screenshots meta-label to auto-verify-pr-ui. (#3965) *(@adeptofvoltron)*
- 📝 Close template-sync gap that let PR #3799 ship unsynced. (#3802) *(@jtomaszewski)*
- 📝 Add scope-cohesion (anti-bundling) check to om-spec-writing. (#3785) *(@matgren)*
- 📝 DS developer-experience roadmap — token sync, gallery, theming, scaffold, lint escalation. (#3784) *(@zielivia)*
- 📝 Automated database backups & GDPR data erasure (two enterprise specs). (#3742) *(@matgren)*
- 📝 Add Omnibus price tracking spec (EU 2019/2161) — spec-first rewrite of #752. (#3723) *(@mstopinski)*
- 📝 Add Price kinds user-guide page (#174). (#3719) *(@DarrenStasiakDev4You)*
- 📝 Create-app agentic skills restructure. (#3686) *(@adeptofvoltron)*
- 📝 Purge-queues-on-db-wipe — deferred implementation spec. (#3660) *(@pkarw)*
- 📝 Prefer GitHub checks in auto review. (#3596) *(@patzick)*
- 📝 Warn that enterprise-module contributions are not accepted. (#3586) *(@pkarw)*
- 📝 Document versioned browser-storage envelopes (v0.6.6). (#3537) *(@pkarw)*
- 📝 Enterprise spec for Entra ID token API authentication. (#3520) *(@matgren)*
- 📝 Support custom compose files, fix parse-error fallback, add Step 0 to code-review gate. (#3452) *(@rajanbor)*
- 📝 Add om-auto-verify-pr-ui skill for PR UI QA verification. (#3388) *(@pkarw)*
- 📝 Spec — configurable CRM interaction (task) statuses. (#3231) *(@matgren)*
- 📝 Form-to-deals — deferred implementation spec. (#3210) *(@matgren)*
- 📝 Enforce cross-module decoupling guardrail (events + injection) in spec-writing & code-review. (#3154) *(@matgren)*
- 📝 Remove stacked merge-gate check, convert QA-approval gate to label policy. (#3144) *(@pkarw)*
- 📝 Platform Map — module introspection for developers. (#3141) *(@adeptofvoltron)*
- 📝 Add HIRING.md for Senior AI / Forward Deployed Engineer role. (#3132) *(@pkarw)*
- 📝 Document MCP stdio fail-closed default and allowUnauthenticatedSuperadmin opt-in. (#3122) *(@adeptofvoltron)*
- 📝 Queue-status-dashboard — deferred implementation spec. (#3104) *(@pkarw)*
- 📝 Tenant-scoped search settings + verified provider availability. (#3093) *(@pkarw)*
- 📝 Add standalone overlays for loop + integration skills. (#3088) *(@adeptofvoltron)*
- 📝 Correct agentic skill drift from AGENTS.md. (#3084) *(@adeptofvoltron)*
- 📝 Coding-agent session collection (Dev Session Insights). (#3073) *(@pkarw)*
- 📝 Clarify Railway deploy modes. (#3064) *(@pkarw)*
- 📝 Broaden priority labels and add a QA-approval merge gate. (#3055) *(@pkarw)*
- 📝 Make om-troubleshooter propose fix and wait for confirmation. (#3003) *(@adeptofvoltron)*
- 📝 Spec — unified record-locks coverage across CRM v2 and all OSS lock sites. (#2895) *(@pkarw)*
- 📝 Spec for per-module picker + official-modules selection. (#2871) *(@pkarw)*

## 👥 Contributors

- @adeptofvoltron
- @pmadajthey
- @patzick
- @haxiorz
- @pkarw
- @MStaniaszek1998
- @zielivia
- @pat-lewczuk
- @rajanbor
- @Heppe-SOFTIQ
- @matgren
- @amtkacper
- @truongx
- @wwaleszczykSoftiq
- @yaotzin1
- @Thibaultjaigu
- @KamilGrocholski
- @andrzejewsky
- @mat-kruk
- @DarrenStasiakDev4You
- @mstopinski
- @jtomaszewski
- @vloneskorpion
- @adrianliw
- @Paul-Mlodochowki

---

# 0.6.5 (2026-06-15)

## Highlights

Open Mercato `0.6.5` is a fast-follow release to `0.6.4` that closes out a broad **security-hardening sweep** and turns to **runtime reliability and performance**. The security work tightens tenant/org scoping and input validation across the AI assistant (attachment-resolver scope, Code Mode path-traversal rejection, generated-import-path escaping, env-var-only MCP API keys, project-root key lookup, fail-closed-on-missing-auth MCP stdio), audit-log redo, progress jobs, search (`$ilike` wildcard escaping, org-scoped index purge), checkout (gateway success/cancel URLs pinned to the server origin), onboarding (verify cookie handling plus rate-limited unauthenticated submissions), MFA compliance reporting, attachment storage-path containment and creation-time scope, customers `require*` helpers, entities batch caps, encryption (self-healing Vault KMS), and webhooks (provider failure paths plus Standard Webhooks signature-header protection) — rounded out by 500-response stack redaction, tenant-scoped user-email lookups, and a closed login account-enumeration oracle.

This release leans hard into **stability under load**: the persistent-events BullMQ producer is now memoized process-wide (no more per-request Redis connection leaks) with flag-gated single-delivery dispatch, the queue worker isolates each job in its own request container, the cache service is a process-wide singleton with an LRU-bounded memory strategy, the database picks up env-gated `statement_timeout`/`lock_timeout` and a finite idle-in-transaction default, missing hot-path indexes land on `search_tokens` and `user_roles`, `access_logs` rotation is throttled, and a fail-loud production guard refuses unsafe single-instance strategies.

The **AI assistant over MCP** gets a batch of correctness fixes: standalone MCP servers load the generated AI-tool and API-route manifests, agents (and MCP API keys) inherit the calling user's roles, the duplicate stdio spawn is gone, the active-participants partial index stops a spurious drop-index migration, and `list_offers` declares its ACL feature. Deployment tooling levels up with **one-command Railway deployment** in the CLI (now preserving module data in uploads, with clarified deploy-mode docs), a manual Dokploy dev compose workflow, and an AWS + Terraform deployment playbook spec.

On the product surface, the CRM **deals list is redesigned** (with a follow-up misroute fix), the person v2 detail now shows addresses with decrypted snapshots, DataTable columns and the pagination footer stay usable on mobile, `InjectionSpot` no longer remounts widgets on context-identity changes, an organization sidebar logo lands, and staff/planner picks up single-active-timer and optimistic-lock-recovery fixes. Dev mode keeps shedding bundle weight by lazy-loading the schedule-calendar CSS and markdown preview, and dependency bumps land for undici, dompurify, shell-quote, `@grpc/grpc-js`, joi, webpack-dev-server, and esbuild. Enjoy!

## ✨ Features
- ✨ CLI: one-command Railway deployment. (#2683) *(@WXYZx)*
- ✨ CRM: deals list redesign. (#2903) *(@haxiorz)*
- ✨ Manual Dokploy Dev compose deployment workflow. (#2865) *(@MStaniaszek1998)*
- ✨ Add the `om-help` workflow navigator skill. (#2140) *(@adeptofvoltron)*
- ✨ Branding: add an organization sidebar logo. (#2822) *(@pmadajthey)*
- ✨ Bootstrap: fail-loud production guard for single-instance strategies (#2987). (#3030) *(@adeptofvoltron)*
- Business rules: add a Call OpenMercato action for scoped internal API calls through selected endpoint and API key profile options.

## 🔒 Security
- 🔒 Webhooks: harden unauthenticated provider webhook failures. (#2680) *(@sravan27)*
- 🔒 Onboarding: the verify endpoint no longer clears auth cookies on error paths (#2714). (#2785) *(@pat-lewczuk)*
- 🔒 Security: scope-enforce the MFA enforcement compliance report (#2708). (#2792) *(@pat-lewczuk)*
- 🔒 Attachments: contain storage path resolution to its root (#2684). (#2833) *(@adeptofvoltron)*
- 🔒 AI assistant: enforce tenant scope on the AI attachment resolver (#2663). (#2877) *(@pkarw)*
- 🔒 AI assistant: reject Code Mode path traversal before authorization (#2667). (#2885) *(@pkarw)*
- 🔒 AI assistant: escape unsafe chars when rewriting generated import paths (CodeQL #139). (#2904) *(@pkarw)*
- 🔒 Checkout: pin gateway success/cancel URLs to the server origin (#2674). (#2882) *(@pkarw)*
- 🔒 API: enforce tenant selection against all `tenantId` candidates (#2665). (#2883) *(@pkarw)*
- 🔒 API: redact the 500 error stack from responses (#2933). (#2950) *(@haxiorz)*
- 🔒 Auth: tenant-scope the user email lookup (#2934). (#2952) *(@haxiorz)*
- 🔒 Customers: scope `require*` helpers by tenant/org at query time (#2116). (#2887) *(@pkarw)*
- 🔒 Audit logs: harden the redo endpoint scope guard (#2931). (#2944) *(@adeptofvoltron)*
- 🔒 Progress: scope job detail GET/PUT/DELETE by `organizationId` (#2930). (#2945) *(@adeptofvoltron)*
- 🔒 Search: escape LIKE wildcards in list-search `$ilike` patterns (#2932). (#2946) *(@adeptofvoltron)*
- 🔒 Search: scope the search-index purge by organization (#2935). (#2953) *(@haxiorz)*
- 🔒 Auth: close the login account-enumeration oracle and timing leak (#2242). (#2886) *(@pkarw)*
- 🔒 AI assistant: pass the MCP API key via env var instead of command-line argv (#2669). (#3021) *(@adeptofvoltron)*
- 🔒 AI assistant: bound the `mcp:dev` API-key lookup to the project root and check file permissions (#2671). (#3020) *(@adeptofvoltron)*
- 🔒 Encryption: self-heal `HashicorpVaultKmsService` instead of staying unhealthy for the instance lifetime (#2661). (#3016) *(@adeptofvoltron)*
- 🔒 Webhooks: prevent custom headers from overriding Standard Webhooks signature headers (#2922). (#3001) *(@adeptofvoltron)*
- 🔒 Onboarding: rate-limit unauthenticated onboarding submissions (#2923). (#2998) *(@adeptofvoltron)*
- 🔒 Entities: cap the `definitions.batch` array to 1000 entries (#2924). (#2992) *(@adeptofvoltron)*
- 🔒 Attachments: enforce the tenant/org scope invariant at creation (#2109). (#2879) *(@pkarw)*

## 🐛 Fixes
- 🐛 AI assistant: avoid a duplicate MCP stdio server spawn. (#2835) *(@pmadajthey)*
- 🐛 AI assistant: load generated AI tools + the API route manifest in standalone MCP servers. (#2898) *(@pkarw)*
- 🔐 AI assistant: agents over MCP + MCP API keys inherit user roles. (#2902) *(@pkarw)*
- 🔐 Catalog: the `list_offers` AI tool declares `sales.channels.manage`. (#2899) *(@pkarw)*
- 🐛 UI: make JsonBuilder Raw JSON editable and confirm destructive type changes (#2817). (#2837) *(@pkarw)*
- 🐛 UI: render the profile dropdown in a body portal so it clears sticky table columns (#2941). (#2943) *(@adeptofvoltron)*
- 🐛 Customers/staff/checkout: QA follow-up — select prefill, domain clear & stale-delete conflict (#2529). (#2840) *(@pkarw)*
- 🐛 Customers: link Cmd+K search results to the v2 customer detail pages (#2843). (#2844) *(@pkarw)*
- 🐛 Customers: degrade owner filters when the optional staff module is absent (#2649). (#2888) *(@pkarw)*
- 🐛 Customers: align example seed data with dictionary values. (#2878) *(@Zamojski5)*
- 🐛 CRM: fix the deals-list misroute (#2939). (#2942) *(@haxiorz)*
- 🐛 Checkout: show a not-found state when editing a deleted template/link (#2849). (#2853) *(@pkarw)*
- 🐛 Staff: surface and recover from an optimistic-lock 409 on availability-schedule switch (#2848). (#2854) *(@pkarw)*
- 🐛 Staff: enforce the single-active-timer invariant on timer start (#2855). (#2873) *(@pkarw)*
- 🐛 Staff: remove the doubled "Tags" heading in the team-member edit view (#2872). (#2875) *(@pkarw)*
- 🐛 Entities: validate multi-value custom fields per element (#2650). (#2860) *(@adeptofvoltron)*
- 🐛 Catalog: strip markdown from the product-list description. (#2862) *(@Zamojski5)*
- 🐳 Docker: forward `APP_ALLOWED_ORIGINS` in the fullapp compose files (#2449). (#2889) *(@pkarw)*
- 🔧 dev: pin the HMR WebSocket origin allowlist contract (#2446). (#2890) *(@pkarw)*
- 🐛 Customers/sales: show addresses on the person v2 detail and decrypt address snapshots (#3038). (#3046) *(@haxiorz)*
- 🐛 UI: keep DataTable columns and the pagination footer usable on mobile. (#3043) *(@haxiorz)*
- 🐛 UI: stop `InjectionSpot` remounting widgets on context-identity changes (#2986). (#3006) *(@adeptofvoltron)*
- 🐛 Events: add flag-gated single-delivery dispatch for persistent subscribers (#2960). (#3018) *(@adeptofvoltron)*
- 🔄 Events: memoize the persistent-events BullMQ producer process-wide to stop per-request Redis connection leaks (#2959). (#3017) *(@adeptofvoltron)*
- 🔧 Queue: isolate each `worker --all` job in its own request container (#2970). (#3011) *(@adeptofvoltron)*
- 🔄 sync-akeneo/channel-gmail: cap Akeneo 429 retries, clamp retry-after, and add AbortSignal timeouts to external HTTP calls (#2976). (#3014) *(@adeptofvoltron)*
- 🐛 Cache: bound `createMemoryStrategy` with LRU `maxEntries` eviction and an amortized expired-entry sweep (#2962). (#2995) *(@adeptofvoltron)*
- 🔐 AI assistant: fail closed when the MCP stdio server has no auth context (#2673). (#3015) *(@adeptofvoltron)*
- 🐛 AI assistant: declare the active-participants partial index to stop a spurious drop-index migration (#3025). (#3029) *(@adeptofvoltron)*
- 💰 Sales: widen the orders/quotes number column to fit standard document numbers (#2947). (#2994) *(@adeptofvoltron)*
- 🐛 Onboarding: single-flight deferred provisioning to stop the status-poll reindex stampede. (#3010) *(@haxiorz)*
- 🐛 Onboarding: make post-provisioning steps non-fatal so verify never strands a workspace (fixes #2951). (#2954) *(@pkarw)*
- 📦 create-app: preserve module data in Railway uploads. (#3072) *(@pkarw)*
- 🐛 Workflows: remove the duplicate info icon in Alert callouts (#2759). (#2763) *(@adeptofvoltron)*

## 🛠️ Improvements
- 🛠️ AI assistant: support OpenRouter runtime configuration in Docker/OpenCode.
- 🛠️ Directory: per-request memoize org-scope resolution and wire `org-scope:user` invalidation (#2259). (#2880) *(@pkarw)*
- 🛠️ Query: drop the redundant `count(distinct)` on non-joined list COUNTs (#2227). (#2894) *(@pkarw)*
- 🛠️ Shared: batch encrypted custom-field decryption with `Promise.all` (#2229). (#2896) *(@pkarw)*
- 🛠️ Shared: add the `buildIlikeTerm()` search-term helper (#2367). (#2892) *(@pkarw)*
- 🛠️ UI: share `formatCurrency`/`formatDate` for AI record cards (#2365). (#2893) *(@pkarw)*
- 🛠️ dev: move react-big-calendar CSS from globals to the lazy `ScheduleCalendar` chunk (#2850). (#2856) *(@izqzmyli)*
- 🛠️ dev: replace eager react-markdown in `AttachmentContentPreview` with lazy `MarkdownContent` (#2850). (#2938) *(@izqzmyli)*
- 🛠️ deps: bump undici to ^8.4.1 in shared (migrates #2836). (#2838) *(@pkarw)*
- 🛠️ deps: bump the minor-and-patch Dependabot group (migrates #2834). (#2841) *(@pkarw)*
- 🛠️ deps: bump the minor-and-patch group across 1 directory with 11 updates. (#2870) *(@pkarw)*
- 🛠️ deps: bump dompurify 3.3.3 → 3.4.8. (#2866) *(@pkarw)*
- 🛠️ deps: consolidate dompurify 3.4.9 + shell-quote 1.8.4 onto develop (#2955, #2956). (#2957) *(@pkarw)*
- 🛠️ Cache: hoist the cache service to a process-wide singleton in bootstrap (#2961). (#3031) *(@adeptofvoltron)*
- 🛠️ DB: env-gated `statement_timeout`/`lock_timeout` with a finite idle-in-transaction default (#2964). (#3033) *(@adeptofvoltron)*
- 🛠️ Query index/auth: add missing hot-path indexes — `search_tokens(tenant_id, token_hash)` and `user_roles(user_id)`/`(role_id)` (#2966). (#3000) *(@adeptofvoltron)*
- 🛠️ Audit logs: throttle `access_logs` rotation and index `created_at` (#2965). (#2999) *(@adeptofvoltron)*
- 🛠️ deps: migrate the Dependabot bumps (#3069, #3071) to develop. (#3074) *(@pkarw)*
- 🛠️ deps: consolidate the joi, webpack-dev-server, and esbuild bumps. (#3054) *(@pkarw)*
- 🛠️ deps: bump `@grpc/grpc-js` 1.14.3 → 1.14.4. (#3041) *(@pkarw)*

## 🧪 Testing
- 🧪 Checkout: undo integration coverage (#2583). (#2819) *(@haxiorz)*
- 🧪 Scheduler: undo integration tests (#2582). (#2820) *(@haxiorz)*
- 🧪 Webhooks: stabilize the TC-LOCK-OSS-043 stale-row locator after an out-of-band bump. (#2851) *(@izqzmyli)*
- 🧪 UI: guard the CrudForm delete-conflict spec against a false success toast (#2409). (#2891) *(@pkarw)*

## 📝 Specs & Documentation
- 📝 Spec: enterprise usage telemetry "phone home" verification. (#2501) *(@pkarw)*
- 📝 Spec: AWS + Terraform deployment playbook (economy + HA). (#2545) *(@MStaniaszek1998)*
- 📝 Spec: cache-with-invalidation FRs for the hottest API endpoints. (#2905) *(@pkarw)*
- 📝 Docs: MCP server setup & extension guide. (#2900) *(@pkarw)*
- 📝 Docs: Turbopack cache troubleshooting. (#2846) *(@alinadivante)*
- 📝 Skills: add `om-approve-merge-pr` and `om-followup-issue-from-pr`. (#2827) *(@pkarw)*
- 📝 Specs: move 61 fully-implemented specs to `implemented/` and fix cross-references. (#2948) *(@adeptofvoltron)*
- 📝 Docs: clarify the Railway deploy modes. (#3064) *(@pkarw)*
- 📝 Process: broaden the priority labels and add a QA-approval merge gate. (#3055) *(@pkarw)*
- 📝 Skills: make `om-troubleshooter` propose a fix and wait for confirmation. (#3003) *(@adeptofvoltron)*

## 🚀 CI/CD & Infrastructure
- 🚀 Test: stabilize the flaky markitdown install in the test job. (#3004) *(@pkarw)*
- 🚀 Docker: improve full-app Dockerfile dependency caching by installing from workspace manifests before copying source files.

## 👥 Contributors

- @WXYZx
- @haxiorz
- @MStaniaszek1998
- @adeptofvoltron
- @sravan27
- @pat-lewczuk
- @pkarw
- @pmadajthey
- @Zamojski5
- @izqzmyli
- @alinadivante

---

# 0.6.4 (2026-06-08)

## Highlights

Open Mercato `0.6.4` is a hardening-and-scale release that builds directly on `0.6.3`'s performance and security work. Two large, cross-cutting audits land together: a **repository-wide transaction-safety pass** that wraps multi-entity writes across sales, customers, catalog, auth, resources, staff, CRUD, and enterprise flows in atomic transactions (no more partial writes on failure), and a **second wave of performance quick wins** — request-level parallelism, per-process/per-locale memoization, N+1 batching, enricher/cache-hit short-circuits, and a fire-and-forget `query_index` path — continuing the p50 < 100 ms push for list/detail APIs.

On the access-control side, the new **ACL feature dependency bundles** let modules declare `dependsOn` so the platform warns at edit time when a granted feature is missing its prerequisites, rolled out across sixteen core and provider modules. Security hardening tightens tenant/org scoping in catalog, customers, search, and customer-portal SSE, requires super-admin for global feature-toggle and system-scheduler writes, fails closed on missing credential DEKs and org-scope checks, and rejects undeclared custom-field keys.

UI ships **DS Foundation v5** (12 new primitives plus rewrites and adoptions), completes the three-phase `RecordNotFoundState` rollout across backend pages, redesigns the create-deal page to the Figma spec, and adds auto-hiding completed progress operations. Rounding it out: a dev-mode `NODE_OPTIONS` heap cap and Redis LRU/eviction tuning, a time-bomb scanner for clock-dependent tests, a broad flaky-test stabilization sweep, and new specs for Railway one-command deployment and PARALLEL_FORK/PARALLEL_JOIN workflow support. Enjoy!

This update also lands a broad **module integration-test coverage sweep** spanning two dozen modules, a batch of **undo/redo and tenant-encryption correctness fixes** across customers, scheduler, workflows, encryption, feature toggles, and checkout, plus **PARALLEL_FORK / PARALLEL_JOIN** workflow-engine execution and `CrudForm` dot-path field handling.

Closing the release is a large **security-hardening sweep** (~70 PRs) auditing tenant/org scoping, secret handling, and input validation across auth, customers, customer accounts, inbox ops, messages, search/query-index, encryption, AI assistant, attachments, onboarding, SSO, checkout, directory, webhooks, and audit logs — removing raw-token fallbacks, closing TOCTOU/enumeration/CSRF surfaces, fingerprinting cached API-key secrets, deep-decrypting collection relations so ciphertext never leaks into response graphs, and failing closed on missing scope or DEKs. It is rounded out by per-module ACL + tenant-ownership enforcement on entity records, a `runCrudCommandWrite` command helper, standardized neutral list empty states, MDXEditor adoption for Markdown forms, and another wave of integration coverage (entities, audit logs, auth, staff, resources, workflows, portal API, CRM, sales, undo, and `CrudForm` field-persistence across fourteen modules).

## ✨ Features
- ✨ OSS optimistic-locking guard is now **default ON** across every CRUD entity exposed via `makeCrudRoute`. Opt out with `OM_OPTIMISTIC_LOCK=off` (also accepts `false` / `0` / `no` / `disabled` / `none`). Runtime stays strictly additive — requests without the `x-om-ext-optimistic-lock-expected-updated-at` header continue to pass through. See [`UPGRADE_NOTES.md`](UPGRADE_NOTES.md) → "OSS optimistic locking default-ON" and [`.ai/specs/2026-05-25-oss-optimistic-locking.md`](.ai/specs/2026-05-25-oss-optimistic-locking.md) §3.4 + §4. (#1981 / #2055 Phase 14) *(@pkarw)*
- ✨ Command-level OSS optimistic locking — new `enforceCommandOptimisticLock` helper lets Command-pattern / non-`makeCrudRoute` writes enforce the same `updated_at` 409 check against an aggregate root. Wired into the sales document sub-resource commands (order/quote lines + adjustments, return create) and quote→order conversion (closes the accept/convert race #2114) as a document-aggregate check. Strictly additive; honors `OM_OPTIMISTIC_LOCK`. See `.ai/specs/2026-05-25-oss-optimistic-locking.md` §10 + concurrency-locking docs. (#1981 / #2055 Phase 16–18) *(@pkarw)*
- ✨ Unified record-conflict bar — optimistic-lock 409s ("this record was modified") now surface as a persistent, error-styled bar in `AppShell` (like the undo banner) instead of a transient toast. `CrudForm` and `useGuardedMutation` route conflicts automatically; custom pages call `surfaceRecordConflict(err, t)` from the new `@open-mercato/ui/backend/conflicts`. (#1981 / #2055) *(@pkarw)*
- ✨ 100% OSS optimistic-lock coverage across CRM (companies-v2 / people-v2 / deals), catalog (product + product-variant delete), and sales — including sales document sub-sections (lines/adjustments/returns send the document-aggregate version header; payments/shipments send their own row `updatedAt`). See [`.ai/specs/2026-05-28-optimistic-locking-coverage-completion.md`](.ai/specs/2026-05-28-optimistic-locking-coverage-completion.md). (#1981 / #2055) *(@pkarw)*
- ✨ Command-level enterprise seam — `createCommandOptimisticLockGuardService({ resolveExpected? })` mirrors the CRUD `crudMutationGuardService` override so enterprise can plug a `record_locks`-backed expected-version resolver via DI without touching command handlers. OSS default is the header compare. (#2055, enterprise follow-up #2232) *(@pkarw)*
- ✨ IMAP + Google email integration foundations — shared MIME assembly, inbound parsing, and threading plumbing. (#2424) *(@haxiorz)*
- ✨ Configurable dictionary entry sorting (carry-forward of #2429). (#2434) *(@pkarw)*
- ✨ Adopt `RecordNotFoundState` across throw-on-load edit pages — Phase 4 (#2101). (#2435) *(@pkarw)*
- ✨ DS Foundation v5 — 12 new primitives, 8 rewrites, and downstream adoptions. (#2322) *(@zielivia)*
- ✨ Redesign the create-deal page to match the Figma mockups. (#2069) *(@haxiorz)*
- ✨ Adopt `RecordNotFoundState` across backend pages — Phases 1–3 (Phase 1 supersedes #2106). (#2185, #2264, #2404) *(@izqzmyli, via @pkarw)*
- ✨ Auto-hide completed progress operations after a configurable timeout (fixes #2206). (#2308) *(@izqzmyli)*
- ✨ Planner: delete availability schedules from the team-member screen. (#2329) *(@adeptofvoltron)*
- ✨ Workflows: PARALLEL_FORK / PARALLEL_JOIN engine execution support. (#2428) *(@adeptofvoltron)*
- ✨ `CrudForm` honors dot-path ids for declared base fields. (#2515) *(@pkarw)*
- ✨ `runCrudCommandWrite` helper composes flush + custom-field persistence + side effects for Command-pattern writes (#2598). (#2602) *(@izqzmyli)*
- ✨ Standardize backend list empty states on a neutral shared component (#772). (#2644) *(@zielivia)*

### 🔐 ACL feature dependency bundles
- 🔐 ACL dependency bundles — declare `dependsOn` and warn at edit time when a granted feature is missing its prerequisites. (#2141, #2220) *(@pkarw)*
- 🔐 Declare ACL feature dependencies across modules — `gateway_stripe`, `checkout`, `example`, `ai_assistant`, `progress`, `query_index`, `resources`, `storage_s3`, `directory`, `currencies`, `entities`, `security`, `record_locks`, `sso`, `sync_excel`, `onboarding`. (#2249, #2260, #2261, #2265, #2277, #2280, #2281, #2283, #2284, #2285, #2286, #2287, #2288, #2289, #2295, #2297) *(@pkarw)*
- 🔐 Workflows: declare ACL feature dependencies (#2150). (#2601) *(@adeptofvoltron)*

## 🔒 Security
- 🔒 Scope catalog reads to tenant/org — variant price snapshot loader, `require*` command helpers, and `decorateOffersWithDetails` (fixes #2119, #2118, #2120). (#2196, #2197, #2198) *(@pkarw)*
- 🔒 Scope customer comment/activity deal enrichment to tenant + org (fixes #2117). (#2212) *(@pkarw)*
- 🔒 Fail closed on org-scope checks in customers and shared helpers (fixes #2239, #2245). (#2300) *(@adeptofvoltron)*
- 🔒 Restrict global feature-toggle writes to super admins (fixes #2266). (#2278) *(@pkarw)*
- 🔒 Require super-admin to manage system-scoped scheduler jobs (fixes #2267). (#2279) *(@pkarw)*
- 🔒 Filter customer-portal SSE recipients by scope. (#2294) *(@WXYZx)*
- 🔒 Scope search results to allowed organizations. (#2296) *(@WXYZx)*
- 🔒 Fail closed when the integrations credentials DEK is unavailable. (#2299) *(@WXYZx)*
- 🔒 Validate uploads and harden downloads in `storage_s3` (fixes #2269). (#2320) *(@rengare)*
- 🔒 Reject undeclared custom-field keys on entities. (#2396) *(@mat89c)*
- 🔒 Fix 4 high-severity CodeQL alerts in `communication_channels` email-MIME assembly. (#2447) *(@pkarw)*

### 🛡️ Tenant-scope, secret-handling & input-validation hardening sweep
- 🔒 Entities: per-module ACL + tenant ownership on entity records, org lookup, and user/role mutations (#2612). (#2636) *(@pat-lewczuk)*
- 🔒 Entities: use crypto randomness for scoped fixture credentials. (#2607) *(@pkarw)*
- 🔒 Auth: tenant-scope the `findRoleInScope` DB query (#2730). (#2765) *(@pat-lewczuk)*
- 🔒 Auth: bind the staff session lookup to the JWT subject (#2733). (#2766) *(@pat-lewczuk)*
- 🔒 Auth: `add-user` CLI must not re-scope a shared global role to a single tenant (#2731). (#2767) *(@pat-lewczuk)*
- 🔒 Auth: remove raw (unhashed) token fallback lookups (#2691). (#2807) *(@pat-lewczuk)*
- 🔒 Auth: refuse the hardcoded consent integrity key in production (#2690). (#2808) *(@pat-lewczuk)*
- 🔒 Auth: make logout POST-only to prevent CSRF logout (#2687). (#2795) *(@adeptofvoltron)*
- 🔒 Auth: stop echoing the operator password to stdout in the setup CLI (#2689). (#2796) *(@adeptofvoltron)*
- 🔒 Auth: expose `hasPassword` only on the id-scoped user GET (#2688). (#2828) *(@adeptofvoltron)*
- 🔒 Auth: enforce user ACL grant boundaries. (#2823) *(@pmadajthey)*
- 🔒 Customers: structural tenant scope on company/people GET detail (#2695). (#2805) *(@pat-lewczuk)*
- 🔒 Customers: exclude-link list lookups include tenant/org scope in the link-table WHERE clauses (#2736). (#2757) *(@haxiorz)*
- 🔒 Customers: pipeline-stages GET flushes seeded dictionary entries instead of leaving them uncommitted (#2735). (#2762) *(@haxiorz)*
- 🔒 Customers: escape ILIKE wildcards and validate from/to dates in the interactions list (#2734). (#2768) *(@pat-lewczuk)*
- 🔒 Customer accounts: rate-limit and dedupe customer-invitation endpoints (#2692). (#2809) *(@pat-lewczuk)*
- 🔒 Customer accounts: scope admin user role/company lookups to the caller org (#2693). (#2811) *(@pat-lewczuk)*
- 🔒 Customer accounts: close the login account-enumeration timing/error oracle (#2694). (#2812) *(@pat-lewczuk)*
- 🔒 Encryption: deep-decrypt loaded collection relations so ciphertext stops leaking into response graphs (#2744). (#2749) *(@haxiorz)*
- 🔒 Encryption: fix the tenant DEK lifecycle — creation race overwrote the active key and the static cache never expired (#2746). (#2751) *(@haxiorz)*
- 🔒 Encryption: reject forged ciphertext shapes on encrypt (#2720). (#2777) *(@pat-lewczuk)*
- 🔒 Encryption: redact the derived-key fallback secret in the banner (#2719). (#2780) *(@pat-lewczuk)*
- 🔒 Encryption: key-lookup hashes use an HMAC pepper (#2718). (#2784) *(@pat-lewczuk)*
- 🔒 Shared auth: fingerprint API-key secrets before caching (#2717). (#2781) *(@pat-lewczuk)*
- 🔒 API: ignore a `File`-typed multipart `tenantId` field (#2722). (#2778) *(@pat-lewczuk)*
- 🔒 Search: fix the vector-index field leak and fail closed on encryption errors (#2716). (#2782) *(@pat-lewczuk)*
- 🔒 Search: `search_get` / `search_aggregate` AI tools enforce per-entity ACL & field policy (#2715). (#2783) *(@pat-lewczuk)*
- 🔒 Search: include `organizationId` in the merger dedup key (#2442). (#2814) *(@adeptofvoltron)*
- 🔒 Query index: coerce the sort direction before `sql.raw` in ORDER BY (#2704). (#2769) *(@adeptofvoltron)*
- 🔒 Query index: fix the shared per-instance search-alias counter that corrupted SQL under concurrent queries (#2738). (#2760) *(@haxiorz)*
- 🔒 Query index: close the `prepareJob` TOCTOU race and add a unique scope key on `entity_index_jobs` (#2739). (#2761) *(@haxiorz)*
- 🔒 Query index: redact PII and raw tokens from `OM_SEARCH_DEBUG` logs (#2709). (#2791) *(@pat-lewczuk)*
- 🔒 Query index: reject an unregistered `entityType` in reindex (#2705). (#2793) *(@pat-lewczuk)*
- 🔒 AI assistant: stop logging the raw session token and leaking the API-key secret in the MCP HTTP server (#2668). (#2832) *(@adeptofvoltron)*
- 🔒 AI assistant: parameterize tool-test-runner tenant lookups (#2725). (#2770) *(@pat-lewczuk)*
- 🔒 AI assistant: enforce the Code Mode mutation cap on the observed HTTP method (#2724). (#2779) *(@pat-lewczuk)*
- 🔒 AI assistant: align the `hasRequiredFeatures` fallback with the canonical wildcard matcher (#2723). (#2775) *(@pat-lewczuk)*
- 🔒 Inbox ops: bind the inbound webhook to a tenant + fail-closed rate limiter (#2698). (#2806) *(@pat-lewczuk)*
- 🔒 Inbox ops: catalog price validator honors channel/customer/quantity/time scoping via the pricing engine (#2737). (#2758) *(@haxiorz)*
- 🔒 Inbox ops: fail closed when the required feature is empty/undefined (#2700). (#2798) *(@pat-lewczuk)*
- 🔒 Inbox ops: harden the proposal-translation prompt against injection (#2701). (#2799) *(@pat-lewczuk)*
- 🔒 Inbox ops: reject a replayed reply send via a `replySentAt` guard (#2697). (#2802) *(@pat-lewczuk)*
- 🔒 Inbox ops: drop the role-name super-admin fallback (#2699). (#2804) *(@pat-lewczuk)*
- 🔒 Messages: drop the raw-token fallback in access-token lookups (#2702). (#2800) *(@pat-lewczuk)*
- 🔒 Messages: validate the action `href` scheme to block stored XSS (#2703). (#2801) *(@pat-lewczuk)*
- 🔒 Attachments: run the dangerous-extension deny-list check on the sanitized filename (#2727). (#2773) *(@pat-lewczuk)*
- 🔒 Attachments: require a forkable EM for background OCR (#2728). (#2772) *(@pat-lewczuk)*
- 🔒 Onboarding: require a tenant-bound cookie on the status endpoint (#2713). (#2787) *(@pat-lewczuk)*
- 🔒 Onboarding: use a trusted base URL for email links and verify redirects (#2712). (#2788) *(@pat-lewczuk)*
- 🔒 Onboarding: record a real client IP into the legal-consent record instead of a spoofable hardcoded `trustProxyDepth=1` (#2743). (#2752) *(@haxiorz)*
- 🔒 Onboarding: concurrent verify requests no longer strand a provisioned tenant in `pending` and lock the user out (#2742). (#2754) *(@haxiorz)*
- 🔒 SSO: map the unverified-email error on the OIDC callback so users see the real reason (#2741). (#2753) *(@haxiorz)*
- 🔒 Checkout: derive the access-cookie `sessionVersion` to stop a bcrypt-hash leak (#2675). (#2748) *(@izqzmyli)*
- 🔒 Checkout: key the consent-proof `markdownHash` with a server secret (#2726). (#2771) *(@pat-lewczuk)*
- 🔒 Security: validate the sudo step-up token payload shape at parse time (#2711). (#2786) *(@pat-lewczuk)*
- 🔒 Security: atomic MFA attempt counter + enforce `allowedMethods` (#2710). (#2789) *(@pat-lewczuk)*
- 🔒 Directory: block cross-tenant org disclosure via `?ids=` (#2696). (#2803) *(@pat-lewczuk)*
- 🔒 Webhooks: normalize empty-string `organizationId` to null in the outbound-dispatch decryption scope (#2443). (#2813) *(@adeptofvoltron)*
- 🔒 Audit logs: close the TOCTOU race in undo-token replay (#2729). (#2774) *(@pat-lewczuk)*
- 🔒 Audit logs: fail closed on a null-tenant/org undo scope (#2685). (#2829) *(@adeptofvoltron)*
- 🔒 Observability: stop leaking credential headers to New Relic (#2666). (#2830) *(@adeptofvoltron)*
- 🔒 Commands: make the `ensureOrganizationScope` unscoped path observable (#2441). (#2815) *(@adeptofvoltron)*
- 🔒 Sales: scope `recomputeOrderPaymentTotals` order lookups by tenant/org (#2111). (#2677) *(@izqzmyli)*
- 🔒 Sales: scope the dictionary lookup to the tenant (#2740). (#2755) *(@haxiorz)*
- 🔒 UI: harden the URL-controlled flash banner against content spoofing (#2721). (#2776) *(@pat-lewczuk)*
- 🔒 create-app: stop honoring the deprecated `requireRoles` guard in the API dispatcher (#2706). (#2794) *(@pat-lewczuk)*
- 🔒 Scripts: await ephemeral PostgreSQL container cleanup before exit and install signal handlers early (#2745). (#2750) *(@haxiorz)*

## 🐛 Fixes
- 🐛 Correct AI assistant `participantCount` and revoke-404 contract deviations (fixes #2189). (#2192) *(@adeptofvoltron)*
- 🔐 Isolate AI chat sessions per tenant/org scope (fixes #2123). (#2194) *(@adeptofvoltron)*
- 🌍 AI chat sharing — i18n, persisted notification title, and owner-in-picker (fixes #2097). (#2200) *(@adeptofvoltron)*
- 🐛 Fix CRM customer list server-side sorting. (#2217) *(@pmadajthey)*
- 🐛 Fix encrypted-field sorting in query engines. (#2282) *(@pmadajthey)*
- 🐛 Stabilize planner availability-schedule switching (fixes #2307). (#2323) *(@rengare)*
- 🐛 Staff timesheets QA follow-ups — wildcard ACL, duplicate-code 409, bulk validation, i18n (fixes #2303, #2304, #2305). (#2309) *(@izqzmyli)*
- 🐛 Open `DatePicker` on the selected value's month. (#2330) *(@adeptofvoltron)*
- 🐛 Preserve custom hours when switching planner availability schedules (fixes #2325). (#2345) *(@adeptofvoltron)*
- 🔧 Add the missing `updated_at` migration for roles & users so fresh installs boot. (#2348) *(@pkarw)*
- 🐳 Configure Redis with an LRU eviction policy and disable dev persistence (fixes #2372). (#2390) *(@Kotmin)*
- 🐛 Add a note type to `ScheduleActivityDialog` to prevent a crash on edit (fixes #2388). (#2405) *(@adeptofvoltron)*
- 🐛 Serialize `temperature` and `renewalQuarter` in company detail GET (fixes #2399). (#2408) *(@adeptofvoltron)*
- 🐛 Persist metadata changes for system entities on save (fixes #2411). (#2415) *(@adeptofvoltron)*
- 🐛 Make tenant-level org undo reachable via the public undo API (fixes #2398). (#2417) *(@adeptofvoltron)*
- 🐛 `LookupSelect` search input no longer clears typed text (#2389). (#2422) *(@pkarw)*
- 🐛 Allow optional pipeline stage appearance (supersedes #2430). (#2433) *(@pkarw)*
- 🐛 Validate deal pipeline stage assignments. (#2439) *(@pmadajthey)*
- 🐛 Avoid a false unsaved-changes prompt on a clean person detail page. (#2437) *(@pmadajthey)*
- 🐳 Add the `NODE_OPTIONS` heap cap to the production fullapp Docker stack (#2371). (#2438) *(@Kotmin)*
- 🐛 Catalog: tier-pricing tie-break now selects the higher `minQuantity` (fixes #1706). (#2454) *(@jakubmatwiejew-wq)*
- 💰 Sales: preserve payment totals and derive tax from net/gross on document reads (fixes #2455, #2457). (#2467) *(@pkarw)*
- 🔐 Encryption: fix `people.update` undo no-op by preserving pending changes during deep-decrypt re-baseline (fixes #2498). (#2508) *(@pkarw)*
- 🔐 Customers: stop `personCompanyLinks` undo handlers from losing writes under tenant encryption (fixes #2507). (#2509) *(@adeptofvoltron)*
- 🐛 Workflows: Definition form now persists Category/Tags/Icon (`metadata.*`) (fixes #2503). (#2513) *(@pkarw)*
- 🐛 Scheduler: jobs undo is no longer a silent no-op — use `extractUndoPayload` (fixes #2504). (#2514) *(@pkarw)*
- 🐛 Feature toggles: hydrate the global edit form's Type / Default Value (fixes #2524). (#2528) *(@pkarw)*
- 🐛 Customers: allow clearing person/company URL and email fields (fixes #2526). (#2533) *(@pkarw)*
- 🐛 Scheduler: job-edit Scope field was editable but silently stripped on save (fixes #2527). (#2535) *(@pkarw)*
- 🐛 Checkout: template/pay-link edit no longer 400s when `gatewayProviderKey` is null (fixes #2505). (#2540) *(@pkarw)*
- 🐛 Workflows: persist FAILED status and trigger compensation when execution fails (#2291). (#2593) *(@adeptofvoltron)*
- 🐛 CRM: fix deal-undo date snapshots. (#2586) *(@pkarw)*
- 🐛 Commands: id-preserving redo for all create commands + #2506 QA fixes. (#2552) *(@pkarw)*
- 🐛 Fix edit-select initial values. (#2608) *(@pkarw)*
- 🐛 `RecordNotFoundState` renders as a neutral empty state (#2127). (#2643) *(@zielivia)*
- 🐛 Fix the Todo assignee checkbox auto-submit. (#2648) *(@pkarw)*
- 🐛 Address checkout and customer CRUD QA regressions. (#2655) *(@pkarw)*
- 🐛 Restore the Markdown editor across forms by adopting MDXEditor (#2653). (#2756) *(@zielivia)*
- 🐛 Auth: `list-users` CLI falls back to the org/tenant id prefix when the name is missing (#2732). (#2764) *(@adeptofvoltron)*
- 🐛 Integrations: validate URL credential fields on save (#2816). (#2824) *(@adeptofvoltron)*
- 🐛 CLI: stop the esbuild service after the OpenAPI bundle to avoid an exit deadlock. (#2810) *(@pat-lewczuk)*

### 🔧 Transaction safety — atomic multi-entity writes
- 🔧 Harden `withAtomicFlush` + a repository-wide SQL transaction-safety audit. (#2343) *(@pkarw)*
- 🔧 Sales — atomic quote acceptance + convert-to-order under one lock (fixes #2114). (#2347) *(@pkarw)*
- 🔧 Sales — atomic order/quote/payment writes (fixes #2336). (#2355) *(@pkarw)*
- 🔧 Core — atomic multi-table writes in perspectives, messages, and inbox ops (fixes #2340). (#2354) *(@adeptofvoltron)*
- 🔧 Resources & `data_sync` — atomic relation & batch writes (fixes #2341). (#2356) *(@adeptofvoltron)*
- 🔧 Auth, directory & staff — atomic ACL, user-delete cascade & org-hierarchy writes (fixes #2339). (#2360) *(@adeptofvoltron)*
- 🔧 Catalog, currencies & translations — atomic product/variant/category/base-currency writes (fixes #2338). (#2368) *(@adeptofvoltron)*
- 🔧 Customers — atomic writes for portal roles, companies, links & addresses (fixes #2337). (#2374) *(@pkarw)*
- 🔧 CRUD — atomic `makeCrudRoute` direct-ORM entity + custom-field writes (fixes #2335). (#2376) *(@pkarw)*
- 🔧 Enterprise, onboarding & sync-akeneo — atomic multi-entity writes (fixes #2342). (#2377) *(@pkarw)*
- 🔧 Attachments & `sync_excel` — atomic entity + custom-field & import-config writes. (#2383) *(@pkarw)*
- 🔧 Staff — serialize timesheets timer/segment writes with a locking transaction (fixes #2416). (#2420) *(@pkarw)*

## 🛠️ Improvements
- 🛠️ Refresh stale AI module-scaffold APIs + add a SKILL-level post-scaffold validation gate (supersedes #2216). (#2243) *(@Kotmin, via @pkarw)*
- 🛠️ Add a `NODE_OPTIONS` heap cap to prevent V8 memory drift in dev (fixes #2370). (#2375) *(@Kotmin)*
- 🛠️ Combine Dependabot minor-and-patch and major bumps (#2394, #2395). (#2403) *(@pkarw)*
- 🛠️ Extract a `useDialogKeyHandler` hook for Esc/Cmd+Enter dialogs (#2366). (#2426) *(@Marynat)*
- 🛠️ dev: guard the `ps` memory-monitor against a synchronous spawn throw (#2682). (#2831) *(@adeptofvoltron)*

### ⚡ Performance
- 🛠️ Lazy-load recharts, `@xyflow/react`, and ClientBootstrap registries for a ~1 GB dev RAM win. (#2129) *(@pkarw)*
- 🛠️ Thread the custom-field definition index through `QueryEngine` (fixes #2133). (#2210) *(@pkarw)*
- 🛠️ Fold the shipment-status `DictionaryEntry` fetch into the sales `afterList` `Promise.all` (fixes #2131). (#2211) *(@pkarw)*
- 🛠️ Memoize `deriveJwtAudienceSecret` HMAC per process. (#2263) *(@mat89c)*
- 🛠️ Push tenants-list pagination to the DB; close the `findAndCount` fetch-all-then-slice audit (fixes #2136). (#2290) *(@pkarw)*
- 🛠️ Cache business-rule discovery. (#2298) *(@WXYZx)*
- 🛠️ Fire-and-forget `query_index` emits to unblock CRUD responses. (#2310) *(@izqzmyli)*
- 🛠️ Memoize `TenantEncryptionSubscriber` per service (fixes #2235). (#2311) *(@pkarw)*
- 🛠️ Parallelize search-token sources in CRM search (fixes #2231). (#2312) *(@pkarw)*
- 🛠️ Consolidate org-scope resolution into a single organizations query (fixes #2228). (#2313) *(@pkarw)*
- 🛠️ Skip response enrichers on list cache hits (fixes #2222). (#2314) *(@pkarw)*
- 🛠️ Parallelize per-request session/user/role/ACL resolution (fixes #2221). (#2315) *(@pkarw)*
- 🛠️ Memoize the i18n dictionary per locale (fixes #2224). (#2316) *(@pkarw)*
- 🛠️ Batch N+1 lookups in rate ingestion, field defs, and role perspectives (fixes #1399). (#2317) *(@pkarw)*
- 🛠️ Add a batch widget-data endpoint to collapse per-widget container/RBAC/scope rebuilds (fixes #2273). (#2318) *(@pkarw)*
- 🛠️ Dedupe the webhooks integration check and parallelize outbound delivery. (#2344) *(@mat89c)*
- 🛠️ Batch price resolution in the products `afterList` hook. (#2392) *(@Marynat)*
- 🛠️ Tune SQLite cache writes. (#2400) *(@WXYZx)*
- 🛠️ Cache `query_index` coverage snapshots by TTL. (#2401) *(@WXYZx)*

## 🧪 Testing
- 🧪 Add cross-tenant access integration tests for attachments (TC-ATTACH-XSS-001–005). (#2186) *(@izqzmyli)*
- 🧪 Stabilize TC-CRM-028 (todos_pkey) and TC-WF-013 (timer resume). (#2188) *(@pkarw)*
- 🧪 Stabilize the TC-AI-MERCHANDISING-008 selection-pill flake. (#2195) *(@pkarw)*
- 🧪 Stabilize release integration flakes — sales shard-12 timeouts + deal-create hydration race. (#2202) *(@pkarw)*
- 🧪 Un-skip TC-CRM-071 + fix the create-deal hydration race. (#2213) *(@pkarw)*
- 🧪 Stabilize TC-INT-004 by raising the per-test timeout budget. (#2226) *(@pkarw)*
- 🧪 Fix flaky-test readiness races at the root (no timeout bumps). (#2369) *(@pkarw)*
- 🧪 Use a dynamic future datetime in workflow timer validator tests. (#2391) *(@MStaniaszek1998)*
- 🧪 Add a time-bomb scanner and fix clock-dependent date literals (fixes #2384). (#2393) *(@adeptofvoltron)*
- 🧪 Cap `yarn test` memory fan-out below the `yarn dev` budget (fixes #2402). (#2412) *(@pkarw)*
- 🧪 Stabilize the flaky TC-CRM-028 example-customer-sync poll. (#2418) *(@pkarw)*
- 🧪 Stabilize flaky TC-MSG-009 and TC-AUTH-009. (#2419) *(@pkarw)*
- 🧪 Add `RecordNotFoundState` integration coverage — Phase 5 (#2101). (#2436) *(@izqzmyli)*
- 🧪 Clear a CodeQL incomplete-URL-sanitization false positive in the command-menu test. (#2427) *(@pkarw)*
- 🧪 Sales: document the order GET payment-total read-back contract. (#2421) *(@pkarw)*
- 🧪 configs + api_keys integration coverage + cache-stats OpenAPI schema fix (fixes #2465, #2470). (#2497) *(@pkarw)*
- 🧪 Catalog: integration coverage for the tier-pricing tie-break (follow-up to #2454). (#2499) *(@pkarw)*
- 🧪 Core: `CrudForm` field-persistence integration harness + skip flag (#2466). (#2548) *(@pkarw)*
- 🧪 Sales: de-flake TC-LOCK-OSS-029 list-delete. (#2554) *(@pkarw)*
- 🧪 Expand module integration coverage across `ai_assistant`, `attachments`, `business_rules`, `catalog`, `communication_channels`, `currencies`, `dashboards`, `data_sync`, `dictionaries`, `directory`, `feature_toggles`, `inbox_ops`, `integrations`, `messages`, `payment_gateways`, `perspectives`, `progress`, `scheduler`, `search`, `shipping_carriers`, `sync_excel`, `translations`, and `webhooks`. (#2516, #2517, #2518, #2519, #2520, #2521, #2522, #2523, #2525, #2530, #2531, #2532, #2534, #2536, #2537, #2538, #2539, #2541, #2542, #2543, #2544, #2547, #2550) *(@haxiorz)*
- 🧪 Notifications integration coverage (#2474). (#2584) *(@haxiorz)*
- 🧪 Entities integration coverage — custom entity defs, field sets, records CRUD, scoping (#2471). (#2604) *(@haxiorz)*
- 🧪 Audit-logs integration coverage (#2472). (#2605) *(@haxiorz)*
- 🧪 Auth integration coverage (#2464). (#2611) *(@haxiorz)*
- 🧪 Staff integration coverage — leave reject, member update, comments/addresses/job-history, tags (#2460). (#2619) *(@haxiorz)*
- 🧪 Resources integration coverage — types/tags/comments/activities CRUD, RBAC, filters (#2461). (#2620) *(@haxiorz)*
- 🧪 Workflows integration coverage — user tasks, signals, retry/advance, RBAC, tenant scoping (#2462). (#2621) *(@haxiorz)*
- 🧪 Customer-portal API integration coverage — profile, users, sessions, roles, feature-check (#2463). (#2622) *(@haxiorz)*
- 🧪 Customers CRM integration coverage (#2458). (#2623) *(@haxiorz)*
- 🧪 Sales integration coverage (#2459). (#2626) *(@haxiorz)*
- 🧪 Customers undo integration coverage (#2572). (#2678) *(@haxiorz)*
- 🧪 Top-level undo integration coverage. (#2587) *(@pkarw)*
- 🧪 `CrudForm` field-persistence integration coverage across `feature_toggles`, `scheduler`, `checkout`, `webhooks`, `integrations`, `planner`, `customer_accounts`, `business_rules`, `workflows`, `auth`, `sales`, `api_keys`, `catalog`, and `dictionaries` (#2466). (#2624, #2625, #2627, #2628, #2629, #2630, #2631, #2632, #2633, #2634, #2637, #2639, #2640, #2641) *(@haxiorz)*
- 🧪 Stabilize custom-fields & CrudForm dirty-state CI flakes. (#2606) *(@pkarw)*
- 🧪 Stabilize CF multi-select edit specs by polling the eventually-consistent query index. (#2549) *(@pkarw)*
- 🧪 Stabilize follow-up integration races. (#2613) *(@pkarw)*
- 🧪 Stabilize currency integration fixtures. (#2617) *(@pkarw)*
- 🧪 Stabilize the develop filter and offer flakes. (#2657) *(@pkarw)*
- 🧪 Finish the PR #2657 stabilization follow-up. (#2818) *(@pkarw)*
- 🧪 Repair a clock-dependent time-bomb test failing on main. (#2450) *(@pkarw)*

## 📝 Specs & Documentation
- 📝 Spec: Railway one-command deployment from the Open Mercato CLI. (#1898) *(@pkarw)*
- 📝 Spec: compile + route-warmup speedup (30–50%). (#2199) *(@pkarw)*
- 📝 Document in-process dev watcher/workers + parallelism flags. (#2203) *(@pkarw)*
- 📝 Add a Page URL field to the bug-report issue template. (#2331) *(@adeptofvoltron)*
- 📝 Spec: PARALLEL_FORK / PARALLEL_JOIN workflow engine support. (#2385) *(@adeptofvoltron)*
- 📝 QA scenarios: Timesheets (#2456) and Undo/Redo (#2468). (#2469) *(@pkarw)*
- 📝 Spec: AI input moderation and safety identifiers (#2510). (#2511) *(@adeptofvoltron)*
- 📝 Spec: reconcile the Railway one-command deploy spec. (#2512) *(@WXYZx)*
- 📝 Spec: `OM_CACHE_SAFETY_ALWAYS_CONSISTENT` opt-in synchronous read-projection consistency. (#2590) *(@pkarw)*
- 📝 Specify the phased integration CI plan. (#2592) *(@pkarw)*
- 📝 Trim AGENTS.md under the 40k context limit. (#2594) *(@pkarw)*
- 📝 QA: Undo/Redo verification across all undoable commands (tracking #2468). (#2500) *(@pkarw)*

## 👥 Contributors

- @pkarw
- @haxiorz
- @zielivia
- @izqzmyli
- @adeptofvoltron
- @pat-lewczuk
- @pmadajthey
- @WXYZx
- @rengare
- @mat89c
- @Marynat
- @Kotmin
- @MStaniaszek1998
- @jakubmatwiejew-wq

---

# 0.6.3 (2026-05-28)

## Highlights

Open Mercato `0.6.3` is a focused follow-up to `0.6.2` — performance, dev-mode memory, and security hardening, with two notable feature landings on top. 

The CRM gets a **production-grade sales pipeline kanban** (colored stage lanes, filter bar, sort and saved-view scaffolding, stuck/overdue indicators, inline quick-deal and add-stage), and workflows finally pick up `WAIT` + `WAIT_FOR_TIMER` steps — carrying @jtomaszewski's original `#1472` work forward. **CRUD API performance quick wins** target p50 < 100 ms for list/detail endpoints across the platform via internal optimizations (no wire-format changes), and two `yarn dev` consolidations land in the same release — a single workspace-package watcher (~1 GB idle RSS win) and `mercato generate watch` folded into the dev server (~190 MB).

On the security front: payment-allocation scope validation closes a cross-tenant write surface in sales commands, attachment scope checks fail closed instead of defaulting open, `mergeIdFilter` rejects unknown shapes, and `ws` is bumped for a transitive CVE. AI assistant gets multi-participant **chat conversation sharing**, the staff module starts Phase 1 of its decoupling from core, the customer portal gets encrypted-user search via search tokens, and SSO logins from Entra ID stop tripping on a missing `email_verified` claim. 

Round it out with `GET /api/version` for deployment introspection, an i18n detection tooling foundation (hardcoded strings + locale value coverage), the new `RecordNotFoundState` UI primitive, and a sheaf of polish fixes across auth, messages, attachments, and dev tooling. Enjoy!

## ✨ Features
- ✨ Sales pipeline kanban — colored stage lanes, filter bar (Status / Pipeline / Owner / People / Companies / Close), sort + saved-view scaffolding, stuck/overdue indicators, inline quick-deal and add-stage lanes. (#1949) *(@haxiorz)*
- ✨ Workflows: `WAIT` activity + `WAIT_FOR_TIMER` step (supersedes #1472). (#1991) *(@jtomaszewski, via @KubaBir)*
- ✨ Decouple `staff` from `core` (Phase 1). (#1946) *(@migsilva89)*
- ✨ AI chat conversation sharing — participant access, API, UI, notifications (fixes #1969). (#2023) *(@adeptofvoltron)*
- ✨ CRUD API performance quick wins — list/detail p50 < 100 ms via internal optimizations (fixes #2044). (#2100) *(@pkarw)*
- ✨ Expose deployed version via `GET /api/version` (fixes #1718). (#2075) *(@amtmich)*
- ✨ `RecordNotFoundState` shared backend component. (#2014) *(@izqzmyli)*
- ✨ Auto-dismiss Undo banner after timeout (fixes #2028). (#2041) *(@pkarw)*
- ✨ Clarify Messages inbox filter labels and add tooltip help text. (#2052) *(@adeptofvoltron)*
- ✨ i18n detection tooling — hardcoded strings + locale value coverage. (#2099) *(@pkarw)*

## 🔒 Security
- 🔒 Scope-validate payment allocation `orderId` / `invoiceId` in sales commands. (#2122) *(@pkarw)*
- 🔒 Scope `em.findOne` by tenant/org for non-super-admin attachment image/file routes (fixes #2108). (#2124) *(@izqzmyli)*
- 🔒 Fail closed when attachment scope columns are null. (#2107) *(@pkarw)*
- 🔒 `mergeIdFilter` fails closed on unknown id filter shapes (fixes #1736). (#2012) *(@pkarw)*
- 🔒 Bump `ws` to address transitive vulnerability. (#2018) *(@pkarw)*

## 🐛 Fixes
- 🔐 Implement `RbacService.getGrantedFeatures` so feature-gated enrichers run (fixes #2019). (#2039) *(@pkarw)*
- 🔐 Search tokens for encrypted customer user search (fixes #2034). (#2040) *(@pat-lewczuk)*
- 🔐 Preserve undefined `email_verified` claim to unblock Entra ID login (supersedes #2027). (#2042) *(@truongx, via @pkarw)*
- 🔐 Gate `UpgradeActionBanner` on `configs.manage` feature to prevent redirect loop (supersedes #2058, folds #2068). (#2066) *(@adeptofvoltron, @rengare, via @pkarw)*
- 🔐 Break 403 redirect loop on staff login (fixes #2070). (#2073) *(@pkarw)*
- 🔐 Add tenant feature checks for scheduler. (#2086) *(@mat-kruk)*
- 🐛 Keep deal analyzer stage approval tool available. (#2017) *(@pkarw)*
- 🐛 Allow clearing `ComboboxInput` value (fixes #1832). (#2020) *(@pkarw)*
- 🐛 Hide stale AppShell sidebar nav until chrome resolves (fixes #1828). (#2021) *(@pkarw)*
- 🐛 React to deleted message in detail view (fixes #1936). (#2013) *(@pkarw)*
- 🐛 Suppress Edge native `::-ms-reveal` duplicate eye icon on `PasswordInput` (fixes #2037). (#2043) *(@pkarw)*
- 🐛 Team delete shows success toast despite 409 rejection (fixes #2049). (#2051) *(@adeptofvoltron)*
- 🐛 Correct widget injection context keys for AI Deal Analyzer (fixes #2053). (#2059) *(@pat-lewczuk)*
- 🐛 Stop `dealAnalyzer` loop after `update_deal_stage` tool call (fixes #2054). (#2098) *(@pat-lewczuk)*
- 🔧 Kill the full child process tree on Windows shutdown (fixes #1826). (#2022) *(@pkarw)*
- 🔧 `singularizeSegment` handles irregular plurals (fixes #2072). (#2076) *(@pkarw)*
- 🔧 Add missing CRUD route indexers. (#2083) *(@WXYZx)*
- 🔧 Decrypt selected relation labels in query index (fixes #2024). (#2065) *(@pmadajthey)*
- 🔧 Use shared base URL resolver for `api-docs` routes (fixes #2089). (#2090) *(@truongx)*
- 🔄 Add search indexing subscribers for customer users (fixes #2060). (#2079) *(@pat-lewczuk)*
- 🔄 Match external custom-field labels in `sync_excel`. (#2087) *(@pmadajthey)*
- 🧪 Stabilize flaky integration tests (TC-CRM-068/069, TC-SALES-005/019). (#2046) *(@pkarw)*

## 🛠️ Improvements
- 🛠️ Consolidate workspace package watchers — ~1 GB idle RSS win in `yarn dev`. (#2102) *(@pkarw)*
- 🛠️ Consolidate `mercato generate watch` into `mercato server dev` — ~190 MB idle RSS win. (#2105) *(@pkarw)*
- 🛠️ Push pagination + parallelize decryption fetches for two CRUD SQL quick wins. (#2139) *(@pkarw)*
- 🛠️ Combine major + minor-and-patch Dependabot bumps (#2064, #2062). (#2067) *(@pkarw)*
- 🛠️ Migrate `ws` 7.5.10 → 7.5.11 from #2031 to `develop`. (#2038) *(@pkarw)*
- 🛠️ Register autofix-split skills in `tiers.json`. (#2047) *(@pat-lewczuk)*

## 📝 Specs & Documentation
- 📝 Plugin-based skill distribution for standalone apps. (#1562) *(@matgren)*
- 📝 CRUD API performance quick wins (target p50 < 100 ms). (#2045) *(@pkarw)*
- 📝 Trim AGENTS.md under the 42 KB harness ceiling. (#2048) *(@pat-lewczuk)*
- 📝 Audit missing translations and propose phased remediation. (#2078) *(@pkarw)*
- 📝 Organize AGENTS.md agent instructions. (#2082) *(@pmadajthey)*
- 📝 Document `auth` locale API route. (#2084) *(@WXYZx)*
- 📝 Teach `create-agents-md` the Always / Ask First / Never / Validation Commands convention. (#2103) *(@pkarw)*
- 📝 Dev-mode memory profiling harness + analysis spec. (#2104) *(@pkarw)*
- 📝 Template parity follow-ups for consolidated package watcher (#2102 follow-up). (#2130) *(@pkarw)*

## 👥 Contributors

- @pkarw
- @haxiorz
- @jtomaszewski
- @KubaBir
- @migsilva89
- @adeptofvoltron
- @izqzmyli
- @amtmich
- @truongx
- @rengare
- @mat-kruk
- @pat-lewczuk
- @WXYZx
- @pmadajthey
- @matgren

---

# 0.6.2 (2026-05-19)

## Highlights

Open Mercato `0.6.2` is a maturity pass on top of `0.6.1`. The AI agents framework picks up real production guardrails — agentic-loop controls (`loop.stopWhen` / `loop.prepareStep` / `loop.budget`), a per-tenant loop kill switch, the `LoopTrace` debug panel, durable server-side conversation storage, and a visible agent task plan that lets operators see what the model is about to do before it does it. On the platform side, the `modules.ts` unified overrides umbrella is now wired for every contract surface — routes, pages, subscribers, workers, widgets, notifications, interceptors, enrichers, CLI, setup, ACL, DI, encryption — so app authors can replace or disable any module contract without forking upstream. The new optional `external/official-modules/` git submodule lets official modules be developed against full platform context (core source, AGENTS.md, skills, the running dev app) without bloating a vanilla clone — fresh clones, `yarn install`, and CI stay untouched until you opt in. Round it out with code-based workflow definitions finally landing (carrying @jtomaszewski's `defineWorkflow()` work forward), a polished backend topbar plus DS `Breadcrumb` + `Sheet` primitives, a Messages module bug-fix sweep (drafts, bulk actions, inbox filters, sender dropdown), a new storage hub for module-owned files, env-based `storage_s3` preconfiguration, and a CSV import foundation for the `customers.person` entity via the `sync_excel` data-sync provider. The final unreleased pass also tightens Super Admin scoping, hardens regex-backed validation paths, accepts third-party module package specifiers in the generator, and fixes auth display-name filtering plus sales return-adjustment bounds. Enjoy!

## ✨ Features
- ✨ Env-based `storage_s3` preconfiguration CLI, setup logging, `.env.example` blocks, and docs (fixes #1968). (#1999) *(@MStaniaszek1998)*
- ✨ Code-based workflow definitions with customize/reset (supersedes #1935). (#1959) *(@jtomaszewski, @KubaBir, via @pkarw)*
- ✨ DS Breadcrumb + Sheet primitives and backend topbar redesign. (#1933) *(@zielivia)*
- ✨ Server-side AI chat conversation storage (fixes #1797). (#1961) *(@pkarw)*
- ✨ Visible AI chat agent task plan (fixes #1922). (#1963) *(@pkarw)*
- ✨ Complete `modules.ts` unified overrides for routes/pages/subscribers/workers/widgets/notifications/interceptors/enrichers/CLI/setup/ACL/DI/encryption. (#1960) *(@pkarw)*
- ✨ Agentic-loop controls — `loop.stopWhen` / `loop.prepareStep` / `loop.budget` + LoopTrace debug panel. (#1903) *(@pkarw)*
- ✨ Optional `official-modules` git submodule + config-driven activation. (#1908) *(@pat-lewczuk)*
- ✨ CSV import foundation for `customers.person` via the `sync_excel` data-sync provider. (#1110) *(@pmadajthey)*
- ✨ Storage hub for module-owned file storage (fixes #929). (#1617) *(@Sawarz)*
- ✨ Register the remaining 14 sales entities in the Awilix DI container. (#1953) *(@kriss145)*

## 🔒 Security
- 🔒 Harden custom-field regex validation and related wildcard matching paths. (#1996) *(@pkarw)*
- 🔒 Restrict Super Admin user and role editing to Super Admin actors (fixes #1973). (#1988) *(@pkarw)*
- 🔒 Reload backend tabs on cookie identity change (fixes #1947). (#1956) *(@pkarw)*

## 🐛 Fixes
- 📦 Accept third-party npm package specifiers in the module-registry generator (fixes #1998). (#2011) *(@pkarw)*
- 🔐 Preserve auth user display-name filtering through search tokens for encrypted user data (supersedes #2002). (#2008) *(@PawelSydorow, via @pkarw)*
- 🔐 Display role labels instead of UUIDs for Super Admin users (fixes #1993). (#1997) *(@pkarw)*
- 🔐 Scope auth user audit logs to the target user's organization so undo tokens work for Super Admin mutations (fixes #1978). (#1986) *(@pkarw)*
- 💰 Reject return adjustments that exceed the remaining grand total (fixes #1904). (#1987) *(@pkarw)*
- 🔐 Guard role tenant moves and preserve ACL/widget selections while editing roles (fixes #688). (#1994) *(@marcinwadon)*
- 🔧 Purge Turbopack `.mercato/next` cache before greenfield rebuilds (fixes #1950). (#1984) *(@pkarw)*
- 🐛 Update existing message drafts from composer instead of creating duplicates (fixes #1939). (#1966) *(@pkarw)*
- 🐛 Expand Messages list bulk actions and add `(No subject)` / `(No recipient)` placeholders (fixes #1941). (#1967) *(@pkarw)*
- 🐛 Sent drafts no longer remain in the Drafts folder (supersedes #1945). (#1965) *(@adeptofvoltron, via @pkarw)*
- 🐛 Clarify Messages inbox filter labels and populate the sender dropdown (fixes #1943). (#1962) *(@pkarw)*
- 🔐 Allow clearing user display name on the undo path (supersedes #1937). (#1957) *(@PawelSydorow, via @pkarw)*
- 💰 Enforce sign semantics for non-return sales adjustment kinds (fixes #1905). (#1955) *(@pkarw)*
- 🐳 Make bundled Traefik an opt-in compose overlay so base files run cleanly behind external reverse proxies. (#1928) *(@pat-lewczuk)*

## 🛠️ Improvements
- 🛠️ Scope the Super Admin users list to the selected tenant and organization context. (#1995) *(@PawelSydorow)*
- 🛠️ Migrate Dependabot bumps for `postcss` and `webpack-dev-server` onto `develop`. (#2005) *(@pkarw)*
- 🛠️ Update the Railway deployment link. (#1992) *(@freakone)*
- 🛠️ Consolidate Dependabot bumps. (#1982) *(@pkarw)*

## 📝 Specs & Documentation
- 📝 Specify runtime i18n enrichment for search presenters used by global search. (#2000) *(@marcinwadon)*
- 📝 Document the module dependency graph (fixes #1831). (#1954) *(@pkarw)*
- 📝 Specify frontend client-boundary RAM guardrails for Next.js pages. (#1931) *(@daweed2701)*
- 📝 Explain why `*.generated.ts` lives in `src/`, not `generated/` (official-modules decision record). (#1983) *(@pkarw)*

## 👥 Contributors

- @pkarw
- @jtomaszewski
- @zielivia
- @pat-lewczuk
- @pmadajthey
- @Sawarz
- @kriss145
- @adeptofvoltron
- @PawelSydorow
- @MStaniaszek1998
- @daweed2701
- @KubaBir
- @marcinwadon
- @freakone

---

# 0.6.1 (2026-05-13)

## Highlights

This release brings in a nice set of fixes + visible UX improvements due to the further Design System implementation; Moreover we've achieved significant memory savings in the `dev` mode, and implemented new CRM filters. Then the Customer portal is now able to support custom domain addresses. We have also worked on the AI agents framework and now it supports the per-agent overrides for both providers and models, also supporting the open source local models. Enjoy!

## ✨ Features
- ✨ DS Foundation v4 — Figma input variants and specialized inputs (supersedes #1918). (#1921) *(@zielivia, via @pkarw)*
- ✨ DS Foundation v3 — 15 primitives, LogList, production migrations (supersedes #1907) (fixes #1807). (#1910) *(@zielivia, via @pkarw)*
- ✨ Scriptable provisioning flags on `mercato auth setup` — `--orgSlug` / `--with-examples` / `--json` (supersedes #1879). (#1900) *(@matgren, via @pkarw)*
- ✨ New CRM pages filters. (#1887) *(@haxiorz)*
- ✨ Portal custom domains (CNAME/A + on-demand TLS). (#1873) *(@pat-lewczuk)*
- ✨ Per-agent provider, baseURL overrides, runtime overrides, ModelPicker UI, env allowlist. (#1858) *(@pkarw)*
- ✨ Unified `OM_AI_PROVIDER` / `OM_AI_MODEL` with openai + gpt-5-mini defaults. (#1856) *(@pkarw)*
- ✨ Lazy auto-spawn queue workers (fixes #1840). (#1844) *(@pkarw)*
- ✨ Optional `--database-name` override for dev/setup scripts (fixes #1841). (#1843) *(@pkarw)*
- ✨ Centralize custom-fields response normalization (fixes #1769). (#1800) *(@pkarw)*

## 🔒 Security
- 🔒 Enforce explicit promote-checks on RBAC delegation paths to close privilege-escalation vectors. (#1837) *(@WH173-P0NY)*

## 🐛 Fixes
- 🔧 Clear MikroORM MetadataStorage between `db:generate` iterations (fixes #1911). (#1917) *(@pkarw)*
- 🐛 `raiseCrudError` extracts message from structured `{ error: { code, message } }` envelopes (fixes #1912). (#1916) *(@pkarw)*
- 🔧 Stop indexing dead API endpoints on MCP boot (fixes #1876). (#1915) *(@pkarw)*
- 📦 Default `DEMO_MODE=false` in create-app scaffold template (fixes #1861). (#1914) *(@pkarw)*
- 🐛 Dedupe portal nav by pattern to prevent duplicate React keys (fixes #1851). (#1913) *(@pkarw)*
- 🐛 Per-failure bulk delete toasts and bulk undo on CRM pages. (#1906) *(@haxiorz)*
- 🐛 Resolve pre-populated ComboboxInput values to labels without interaction. (#1901) *(@pat-lewczuk)*
- 🔧 Sort manifest routes inside matcher so literal segments beat dynamic. (#1899) *(@pkarw)*
- 🔐 Surface `User.name` through auth user create/edit UI, CRUD payloads, and list filters (supersedes #1882). (#1886) *(@PawelSydorow, via @pkarw)*
- 🐛 Suppress initial focus flicker on focus-driven inputs. (#1881) *(@PawelSydorow)*
- 💰 Enforce return adjustment sign in calculations and validators (fixes #1705). (#1855) *(@pkarw)*
- 📦 Enable `ai_assistant` in CRM preset and gate widgets by required modules (fixes #1849). (#1854) *(@pkarw)*
- 🐛 Preserve in-flight reply on AiChat unmount (fixes #1816). (#1852) *(@pkarw)*
- 🔧 Replace `instanceof CrudHttpError` with `isCrudHttpError()` to fix split-chunk class identity (98 sites, 9 modules). (#1850) *(@matgren)*
- 🌍 Fix translation manager save flake. (#1847) *(@pkarw)*
- 🐛 Popover/select dropdowns visible inside modals (fixes #1836). (#1842) *(@pkarw)*
- 📦 Make agentic-shared `playwright.config.ts` ESM-safe. (#1839) *(@matgren)*
- 🐛 CRM phase 3 fixes batch — activity visibility, scheduling validation, timeline rendering, filter UI. (#1819) *(@haxiorz)*
- 🔧 Invalidate Turbopack module graph on structural cache purge. (#1818) *(@pkarw)*
- 🐛 Show variant duplicate-name error inline inside add-variant dialog (fixes #1793). (#1799) *(@pkarw)*

## 🛠️ Improvements
- 🛠️ Migrate Dependabot PRs #1888–#1892 to develop (minor-and-patch group + `next` 16.2.6). (#1893) *(@pkarw)*
- 🛠️ Migrate Dependabot PRs #1875 + #1877 to develop (`fast-uri` + `@babel/plugin-transform-modules-systemjs` security bumps). (#1884) *(@pkarw)*
- 🛠️ Bump MikroORM 7.0.13 → 7.0.14. (#1823) *(@pat-lewczuk)*

## 📝 Specs & Documentation
- 📝 Add comprehensive documentation for the core sales module. (#1872) *(@kriss145)*
- 📝 Staff decouple from core spec (Phase 1). (#1859) *(@migsilva89)*
- 📝 Document DataTable usage in customer portal pages (fixes #1827). (#1853) *(@pkarw)*
- 📝 Standalone AGENTS — encryption maps and mandatory module mechanisms. (#1817) *(@pkarw)*
- 📝 Agentic property-based testing proposal. (#1702) *(@matgren)*

## 🚀 CI/CD & Infrastructure
- 🚀 Skip version commit for existing releases. (#1848) *(@pkarw)*
- 🚀 Unique snapshot versions on canary reruns. (#1857) *(@pkarw)*
- 🚀 Include `feat/wms` branch in CI workflow push events. (#1838) *(@dominikpalatynski)*

## 👥 Contributors

- @pkarw
- @haxiorz
- @pat-lewczuk
- @matgren
- @PawelSydorow
- @WH173-P0NY
- @kriss145
- @migsilva89
- @dominikpalatynski
- @zielivia

---

# 0.6.0 (2026-05-06)

## Highlights
Open Mercato `0.6.0` turns the post-0.5.0 work into a broader platform release: AI agents now have a unified runtime and approval flow, MikroORM has moved to v7/Kysely, CRM and navigation screens received another major usability pass, and release engineering now carries forward contributor credits for superseded PRs.

**Note:** Check the `UPGRADE_NOTES.md` as for the Mikro-ORM required upgrade steps for the custom code build before this release; we've provided you with the automation skill for the migration - and it's 100% automatic one, no business logic changes required.

**Note:** The AI Framework is still in the BETA - however the data structures and services won't be changed - so they're upon the BC contract. Feel free  to build something cool, but first - configure the AI service in the `.env` :) 

## ✨ Features
- ✨ Realtime messages. (#1590) *(@Sawarz)*
- ✨ CRM details screens revamp. (#1618) *(@haxiorz)*
- ✨ Starter preset. (#1670) *(@dominikpalatynski)*
- ✨ UI-driven e2e tests + trigger cache invalidation. (#1689) *(@jtomaszewski)*
- ✨ Accept { cause } option in CrudHttpError constructor (supersedes #1691). (#1694) *(@jtomaszewski, via @pkarw)*
- ✨ Add `mercato auth sync-role-acls` CLI for re-applying default role features. (#1699) *(@MStaniaszek1998)*
- ✨ Add inbox bulk actions. (#1685) *(@dominikpalatynski)*
- ✨ Route metadata + standalone auto-skills + agent guardrails. (#1650) *(@pkarw)*
- ✨ Make AppShell and PortalShell logo configurable. (#1725) *(@jtomaszewski)*
- ✨ DS Foundation v2: form primitives + Tooltip + sweep migrations (clean replay). (#1739) *(@zielivia)*
- ✨ Sidebar customization page with variants, DnD, and cross-locale support (supersedes #1730). (#1781) *(@zielivia, via @pkarw)*
- ✨ Two-level sidebar — settings/profile alongside collapsed main. (#1790) *(@zielivia)*
- ✨ CRM activity new UI. (#1791) *(@haxiorz)*
- ✨ Introduce optional module orchestration and improve CLI errors. (#1698) *(@dominikpalatynski)*
- ✨ AI framework unification + testing subagents flow with better agent-to-human communication. (#1593) *(@pkarw)*
- ✨ Tiered, per-skill install with the core tier as the default (closes #1744). (#1813) *(@pat-lewczuk)*

## 🔒 Security
- 🔒 Atomic password change + audit event for customer_accounts. (#1692) *(@pkarw)*
- 🔒 Add tenant encryption map for inbox_ops module. (#1688) *(@WH173-P0NY)*
- 🔒 Revoke customer sessions on self-service password change. (#1686) *(@WH173-P0NY)*
- 🔒 Harden reset origin checks and require password confirmation. (#1729) *(@MStaniaszek1998)*
- 🔒 Pin outbound webhook DNS to defeat rebinding (SSRF). (#1735) *(@pat-lewczuk)*
- 🔒 Gate sidebar customization behind auth.sidebar.manage (#1792). (#1802) *(@pkarw)*

## 🐛 Fixes
- 🐛 Parallelize entity defs, search availability, and dictionary resolution (#1404). (#1614) *(@pkarw)*
- 🐛 Accept edit form payload and embed triggers in definition (#1586). (#1601) *(@pkarw)*
- 🐛 Link seeded deals to pipeline + prevent doc number increment on type switch. (#1609) *(@vloneskorpion)*
- 🐛 Prevent column truncation on definitions list. (#1623) *(@jtomaszewski)*
- 💰 Load Stripe.js only on payment pages and update CSP (#1606). (#1608) *(@pkarw)*
- 🐛 Move layout above [...slug] to stop navigation remount (#1083). (#1612) *(@pkarw)*
- 🔐 Extend PII encryption maps + use decryption helpers in auth (#1413). (#1581) *(@pkarw)*
- 🐛 Hide messages topbar icon when backing module is disabled. (#1567) *(@jtomaszewski)*
- 🌍 Restore Jest module resolution and reduce false-positive unused i18n keys. (#1616) *(@pkarw)*
- 🐛 Use `yarn mercato db` commands in codex enforcement rules. (#1630) *(@pat-lewczuk)*
- 💰 [Business Logic] Shipment remains editable after full return and completed payment — missing state guards (#1624). (#1628) *(@pat-lewczuk)*
- 🐛 Customer portal review fixes. (#1629) *(@pat-lewczuk)*
- 🔄 Refresh inbox cache on unread events (#1634). (#1638) *(@pkarw)*
- 🐛 Hide UI and gate APIs when backing module is disabled (supersedes #1636). (#1641) *(@jtomaszewski, via @pkarw)*
- 🔐 Resolve CALL_API roles from the instance initiator. (#1643) *(@pkarw)*
- 🔐 Use security email URL helper in signup. (#1642) *(@pkarw)*
- 🐛 Eliminate race condition causing truncated dist files. (#1667) *(@staskolukasz)*
- 🔄 V7 generated cache recovery. (#1672) *(@pkarw)*
- 🔧 Restore recipient access to inbox and detail pages (#1633). (#1639) *(@pkarw)*
- 📦 Hide example links in lean starters. (#1684) *(@pkarw)*
- 🔄 Scope bulk-delete cache invalidation to worker tenant (fixes #1677). (#1687) *(@marcinwadon)*
- 🐳 Extend QA Dokploy slots and adapt Docker provider API. (#1683) *(@dominikpalatynski)*
- 📦 Update the create-app template copy path. (#1675) *(@dominikpalatynski)*
- 🐛 Use search_tokens for users list search on encrypted email (#1666). (#1674) *(@pkarw)*
- 🔄 Move default file-backed cache paths under .mercato. (#1682) *(@pkarw)*
- 🐛 Normalize interaction & deal customValues via shared response helper. (#1680) *(@pkarw)*
- 🔧 Update Docker ignore test exclusions and retain runtime helpers. (#1695) *(@dominikpalatynski)*
- 🐛 CRM issues resolution (fixes #1657). (#1700) *(@haxiorz)*
- 🐛 Disable rate limiting under OM_INTEGRATION_TEST. (#1673) *(@jtomaszewski)*
- 🔧 Skip ratelimit_probe path when module is absent (standalone scaffold). (#1756) *(@pat-lewczuk)*
- 🐛 CRM fixes 2 (fixes #1711). (#1743) *(@haxiorz)*
- 🔧 Unblock standalone CI under zod 4.4.x + capture app log. (#1764) *(@pat-lewczuk)*
- 💰 Fix company v2 currency collapse. (#1753) *(@dominikpalatynski)*
- 🔐 Expand auth users search to organizations and roles. (#1752) *(@dominikpalatynski)*
- 🐛 Resolve owning module from registry, not feature-id prefix. (#1768) *(@pat-lewczuk)*
- 🔐 Fix portal signup activation messaging. (#1754) *(@dominikpalatynski)*
- 🐛 Devsplash respects configured base URL across all variants. (#1726) *(@pkarw)*
- 🔧 Align MikroORM entity migration guidance. (#1710) *(@pkarw)*
- 🐛 Anchor storage/ and data/ ignore patterns to repo root. (#1697) *(@Kamyyylo)*
- 🐛 Prevent duplicate sends from composer (#1631). (#1640) *(@pkarw)*
- 🔧 Use OM_SEARCH_MIN_LEN env var for search query minimum length (supersedes #1761). (#1773) *(@haxiorz, via @pkarw)*
- 🐛 Fix numeric-string display names and collapsed-rail icon focus (supersedes #1766). (#1772) *(@haxiorz, via @pkarw)*
- 💰 [Forms] Native browser "Leave site?" dialog appears when submitting Create User or Create Payment Link forms (#1733). (#1759) *(@pat-lewczuk)*
- 🐛 [Custom Fields] Deleted custom fields still appear in API response after removal from entity definition (#1749). (#1760) *(@pat-lewczuk)*
- 🔐 [Customer Portal] Password reset link leads to 404 — reset page does not exist at generated URL (#1740). (#1758) *(@pat-lewczuk)*
- 🔧 Remove explicit NODE_ENV from env files to silence Next.js warning. (#1728) *(@pkarw)*
- 🐛 Keep organization switcher in topbar at all viewport widths (#1795). (#1798) *(@pkarw)*
- 🐛 Show variant duplicate-name errors inline inside add-variant dialog (#1793). (#1799) *(@pkarw)*

## 🛠️ Improvements
- 🛠️ Memoize Tabs context value to prevent consumer re-renders (#1409). (#1610) *(@pkarw)*
- 🛠️ Lazy-load heavy libraries for schedule, markdown, and API docs (#1408). (#1615) *(@pkarw)*
- 🛠️ Eliminate N+1 queries in user listing and role validation (#1398). (#1613) *(@pkarw)*
- 🛠️ Migrate deprecated Notice usages to Alert. (#1649) *(@pkarw)*
- 🛠️ MikroORM v7, use Kysely. (#1513) *(@staskolukasz)*
- 🛠️ DS foundation v1. (#1708) *(@zielivia)*
- 🛠️ Document v2 form primitives + new tokens. (#1707) *(@zielivia)*
- 🛠️ Update README.md. (#1765) *(@pat-lewczuk)*
- 🛠️ Add priority labels (low/medium/high/extreme). (#1785) *(@pkarw)*
- 🛠️ Migrate Dependabot PRs #1724 + #1723 to develop. (#1775) *(@pkarw)*

## 📝 Specs & Documentation
- 📝 Add local development walkthrough (#1435). (#1611) *(@pkarw)*
- 📝 Add Hall of Fame for Agentic Hackathon winners. (#1646) *(@pat-lewczuk)*
- 📝 Reassign authors on review and fix handoffs. (#1644) *(@pkarw)*
- 📝 Make vector auto-indexing opt-in by default. (#1679) *(@pkarw)*
- 📝 Add CRM call transcriptions + Zoom + tl;dv adapter specs. (#1645) *(@matgren)*
- 📝 Push notifications and devices modules. (#1746) *(@jtomaszewski)*
- 📝 Telemetry package with pluggable OTEL backend. (#1747) *(@jtomaszewski)*

## 👥 Contributors
- @pkarw
- @vloneskorpion
- @jtomaszewski
- @Sawarz
- @pat-lewczuk
- @haxiorz
- @staskolukasz
- @dominikpalatynski
- @matgren
- @WH173-P0NY
- @marcinwadon
- @MStaniaszek1998
- @zielivia
- @Kamyyylo

---

# 0.5.0 (2026-04-21)

## Highlights
Open Mercato `0.5.0` is the biggest release so far. It bundles more than 250 fixes and
improvements delivered after the Hackathon in Sopot, alongside several major and important
dependency upgrades across the platform.

This release is also the reason `UPGRADE_NOTES.md` now exists. If you maintain custom
modules, app-level code, or standalone extensions, review the upgrade notes before moving
from `0.4.10` to `0.5.0`.

## ✨ Features
- ✨ 928 - integrations health checks (supersedes #1177). (#1525) *(@Sawarz, via @pkarw)*
- ✨ LLM provider ports & adapters — unlock DeepInfra, Groq, and custom backends (supersedes #1498). (#1514) *(@bobec83, via @pkarw)*
- ✨ Redesign perspectives panel as Views with DS compliance (supersedes #1176). (#1463) *(@zielivia, via @pkarw)*
- ✨ Realtime messages. (#1590) *(@Sawarz)*
- ✨ Add default value support for custom fields (#824). (#1473) *(@pkarw)*
- ✨ Extend review-pr skill for worktree reviews and fix-forward flow. (#1440) *(@pkarw)*
- ✨ Add review-pr skill for automated PR reviews. (#1385) *(@pkarw)*
- ✨ Add product variant media display and default fallback logic #892. (#1346) *(@Marynat)*
- ✨ Link workflow instance ID in list table. (#1276) *(@jtomaszewski)*
- ✨ Add docs to user guide section about attachments. (#1190) *(@pawelleszczewicz)*
- ✨ Add invoice and credit memo CRUD commands, API routes, and events. (#1184) *(@lbajsarowicz)*
- ✨ Add name, sku to invoice/credit memo lines and reason to credit memos. (#1183) *(@lbajsarowicz)*
- ✨ Add seed:defaults command for existing databases (#1099). (#1181) *(@amtmich)*
- ✨ Init repo flow + AI coding flow, dev splash & search fixes. (#1175) *(@pkarw)*
- ✨ Add date and datetime custom field kinds. (#1172) *(@muhammadusman586)*
- ✨ Standalone app skills, navigation guide, and module-level guides. (#1151) *(@pat-lewczuk)*
- ✨ Advanced datatable CRM (spec + implementation). (#1150) *(@haxiorz)*
- ✨ Move backend chrome hydration to the client. (#1145) *(@pkarw)*
- ✨ SPEC 046c decoupling example module from CRM. (#1144) *(@haxiorz)*
- ✨ Integration commands, events & projects specs. (#1092) *(@pkarw)*
- ✨ SPEC-046a & SPEC-046b - customers v2. (#1050) *(@haxiorz)*

## 🔒 Security
- 🔒 Prevent host header poisoning in reset links (supersedes #1268). (#1523) *(@WXYZx, via @pkarw)*
- 🔒 SSRF-guard CALL_WEBHOOK activity (supersedes #1510). (#1520) *(@WH173-P0NY, via @pkarw)*
- 🔒 Atomic token consumption to prevent race conditions (fixes #1423). (#1497) *(@pkarw)*
- 🔒 Hash message access and quote acceptance tokens at rest (supersedes #1483). (#1486) *(@muhammadusman586, via @pkarw)*
- 🔒 Make JWTs revocable and isolate staff/customer audiences (supersedes #1286). (#1461) *(@WH173-P0NY, via @pkarw)*
- 🔒 Reject executable double extensions (#1597). (#1602) *(@pkarw)*
- 🔒 Fix/security customer signup tenant binding. (#1584) *(@WH173-P0NY)*
- 🔒 Pin tenant scope on PUT, reject body-supplied tenant fields. (#1583) *(@WH173-P0NY)*
- 🔒 Fix/security dashboards mass assign scope. (#1582) *(@WH173-P0NY)*
- 🔒 Reject // in redirect path to close open-redirect bypass (#1560). (#1570) *(@pkarw)*
- 🔒 Require authentication on native /api/events registry route. (#1547) *(@WH173-P0NY)*
- 🔒 Fix/hunt webhook 01. (#1546) *(@WH173-P0NY)*
- 🔒 Bump hono from 4.12.12 to 4.12.14 (develop). (#1545) *(@pkarw)*
- 🔒 Fix race conditions in payments, quotes, shipments, and password reset (#1414). (#1505) *(@pkarw)*
- 🔒 Revalidate portal user state from DB on every request (#1426). (#1501) *(@pkarw)*
- 🔒 Scope ID lookups by tenant to prevent cross-tenant existence oracles (#1428). (#1500) *(@pkarw)*
- 🔒 Upgrade next and @hono/node-server to fix Dependabot alerts. (#1475) *(@pkarw)*

## 🐛 Fixes
- 🐛 Mark Target Queue/Command as required with DS status token (#1588) (supersedes #1591). (#1607) *(@Sawarz, via @pkarw)*
- 🐛 Empty scheduled job list (supersedes #1594). (#1605) *(@Sawarz, via @pkarw)*
- 💰 Resolve 500 errors on shipment ops + integer quantities (supersedes #1543). (#1549) *(@muhammadusman586, via @pkarw)*
- 🔐 Use forwarded headers for redirect URLs behind reverse proxies (supersedes #1515). (#1521) *(@jtomaszewski, via @pkarw)*
- 🌍 Sync missing translations + restore BC-critical exports (supersedes #1485). (#1488) *(@Sawarz, via @pkarw)*
- 🐛 Use filterIds for org scoping in all GET handlers (supersedes #1482). (#1487) *(@jtomaszewski, via @pkarw)*
- 🐛 Accept date strings in rule form schema (supersedes #1273). (#1477) *(@RadnoK, via @pkarw)*
- 🔐 Reset attacker-controlled scope params and add auth.view guard (supersedes #1261). (#1476) *(@staskolukasz, via @pkarw)*
- 🐛 Sanitize HTML rich text fields at persistence boundary (supersedes #1265). (#1469) *(@AK-300codes, via @pkarw)*
- 💰 Regression test + findOneWithDecryption for quote-to-order (#919) (supersedes #1319). (#1468) *(@pawelleszczewicz, via @pkarw)*
- 🐛 UI contract violations + DS token migration (supersedes #1287). (#1467) *(@strzesniewski, via @pkarw)*
- 🐛 Add view-details action to delivery log (supersedes #1317). (#1466) *(@pawelleszczewicz, via @pkarw)*
- 🔐 Hash staff session and password-reset tokens with HMAC (supersedes #1277). (#1465) *(@WH173-P0NY, via @pkarw)*
- 🐛 Trim whitespace-padded organization scope IDs (supersedes #1307). (#1464) *(@pawelleszczewicz, via @pkarw)*
- 🔧 Preserve Redis URL semantics across queue and scheduler (supersedes #1136). (#1462) *(@pmadajthey, via @pkarw)*
- 💰 Add tag description to filters and fix useMemo deps (supersedes #777). (#1460) *(@MORY33, via @pkarw)*
- 🐛 Allow creating rules without conditionExpression (supersedes #1152). (#1457) *(@muhammadusman586, via @pkarw)*
- 🐛 Deassign deal from customer/company detail instead of deleting (#109) (supersedes #1228). (#1455) *(@pawelleszczewicz, via @pkarw)*
- 🐛 Prevent variant table overflow (supersedes #1240). (#1454) *(@amtmich, via @pkarw)*
- 🔐 Reject deleted users during session token refresh (supersedes #1368). (#1453) *(@RMN-45, via @pkarw)*
- 🐛 Prevent column truncation on definitions list. (#1623) *(@jtomaszewski)*
- 🌍 Restore Jest module resolution and reduce false-positive unused i18n keys. (#1616) *(@pkarw)*
- 🐛 Parallelize entity defs, search availability, and dictionary resolution (#1404). (#1614) *(@pkarw)*
- 🐛 Move layout above [...slug] to stop navigation remount (#1083). (#1612) *(@pkarw)*
- 💰 Link seeded deals to pipeline + prevent doc number increment on type switch. (#1609) *(@vloneskorpion)*
- 🐛 Load Stripe.js only on payment pages and update CSP (#1606). (#1608) *(@pkarw)*
- 🐛 Sanitize DB errors and drop NOT NULL on condition_expression (#1598). (#1604) *(@pkarw)*
- 🐛 Validate effectiveTo is after effectiveFrom (#1596). (#1603) *(@pkarw)*
- 🐛 Accept edit form payload and embed triggers in definition (#1586). (#1601) *(@pkarw)*
- 🐛 Close edit dialog before awaiting step delete confirm (#1585). (#1600) *(@pkarw)*
- 🐛 Always register backend route manifests in bootstrap-registrations (#1595). (#1599) *(@pkarw)*
- 🔐 Dev HMR origins for non-localhost login. (#1592) *(@pkarw)*
- 🐛 Missing asterisk. (#1591) *(@Sawarz)*
- 🔐 Extend PII encryption maps + use decryption helpers in auth (#1413). (#1581) *(@pkarw)*
- 🌍 I18n checkout-demo hardcoded strings (#1425). (#1580) *(@pkarw)*
- 🐛 Bound memory on legacy todos/activities reads (#1397). (#1579) *(@pkarw)*
- 🐛 Add timeouts to external service calls (#1419). (#1578) *(@pkarw)*
- 🔄 Replace synchronous file I/O with async fs.promises (#1401). (#1577) *(@pkarw)*
- 💰 Close shipment wizard before awaiting reload (#1561). (#1575) *(@pkarw)*
- 🔐 Gate role loader on actor-resolution (#1556). (#1574) *(@pkarw)*
- 🐛 Show offline-specific error UI and auto-recover on network loss (#1563). (#1573) *(@pkarw)*
- 🐛 Make route matching case-insensitive for static segments (#1559). (#1572) *(@pkarw)*
- 💰 Validate phone format on customer snapshot and channel contact (#1565). (#1571) *(@pkarw)*
- 🐛 Smooth product create/edit flow without redirect to list (#1564). (#1569) *(@pkarw)*
- 🐛 Hide messages topbar icon when backing module is disabled. (#1567) *(@jtomaszewski)*
- 🔐 Disambiguate sidebar labels from auth module (#1551). (#1558) *(@pkarw)*
- 💰 Cascade customer delete to portal users, sales docs, and custom fields (#1418). (#1557) *(@pkarw)*
- 🐛 Validate event names against module registry (#1421). (#1555) *(@pkarw)*
- 🔐 Scope role selector to selected tenant in user create/edit (#1538). (#1554) *(@pkarw)*
- 🐛 Prevent duplicate records on rapid Save clicks (#1539). (#1553) *(@pkarw)*
- 💰 Enforce integer return quantity and fix float precision in remaining qty (#1540). (#1552) *(@pkarw)*
- 🐛 Include env var names in missing API key error. (#1550) *(@Zales0123)*
- 🐛 ⚡ perf: LookupSelect and MessageObjectRecordPicker render all items without virtualization (#1410). (#1536) *(@pat-lewczuk)*
- 🐛 🔒 reliability: Workflow activity timeouts don't abort underlying work — phantom executions (#1417). (#1532) *(@pat-lewczuk)*
- 🐛 Separate execution plans from architectural specs. (#1531) *(@matgren)*
- 🐛 ⚡ perf: CrudForm triggers full re-renders on every keystroke (#1407). (#1530) *(@pat-lewczuk)*
- 🐛 ⚡ perf: Search indexer always does full table scans and indexes records individually (#1406). (#1529) *(@pat-lewczuk)*
- 🐛 Add server-side pagination to action logs (#1402). (#1526) *(@pkarw)*
- 🐛 Dispatch event subscribers in parallel (#1405). (#1524) *(@pkarw)*
- 🐛 Auto-copy .env.example when .env is missing in dev. (#1517) *(@jtomaszewski)*
- 🐛 Correct injection placement targets in example widgets + windows troubleshooting. (#1511) *(@pkarw)*
- 🐛 Bug(workflows): workflow execution failures not visible in dev console (#1446). (#1508) *(@pat-lewczuk)*
- 🐛 🔒 reliability: Search bulkIndex silently swallows strategy failures (#1424). (#1507) *(@pat-lewczuk)*
- 💰 Prevent premature state commits before side-effects complete (#1415). (#1504) *(@pkarw)*
- 🐛 Add retry and backoff for failed jobs in all queue strategies (#1416). (#1503) *(@pkarw)*
- 🔐 Require auth by default when route metadata is missing (#1420). (#1502) *(@pkarw)*
- 🐛 Remove SSE abort listeners on cleanup (#1422). (#1499) *(@pkarw)*
- 🐛 Stabilize develop integration and standalone flows. (#1494) *(@pkarw)*
- 🔐 Honor redirect query param on login page. (#1490) *(@jtomaszewski)*
- 🐛 Pg lock hopping connections. (#1484) *(@Sawarz)*
- 🐛 Remove markitdown shell-out, replace with pure-JS extractors (HUNT-PARSER-01). (#1481) *(@WH173-P0NY)*
- 🔐 Enforce tenantId requirement for roles. (#1470) *(@pkarw)*
- 🔧 Fix/windows build. (#1459) *(@PawelSydorow)*
- 💰 Add pessimistic locking to prevent duplicate side effects. (#1452) *(@pkarw)*
- 🐛 Halt workflow on activity failure by default. (#1445) *(@jtomaszewski)*
- 🔐 Migrate feature_toggles to requireFeatures and deprecate requireRoles. (#1443) *(@pkarw)*
- 🐛 Add OPENCODE_* env var fallbacks for AI provider keys. (#1438) *(@lchrusciel)*
- 🐛 Replace flaky TC-ADMIN-008 integration test with unit tests. (#1437) *(@pkarw)*
- 🐛 Cap one-time API key TTL and use soft-delete for cleanup. (#1388) *(@RMN-45)*
- 🐛 Wire CRUD events to rule engine via wildcard subscriber (#662). (#1387) *(@RMN-45)*
- 🐛 Show system and tenant-scoped jobs on list page (#815). (#1386) *(@RMN-45)*
- 🐛 Resolve app-level workers and exports from .ts source files. (#1378) *(@pawelleszczewicz)*
- 💰 Restore default UoM selection and search in line item dialog. (#1377) *(@pawelleszczewicz)*
- 🐛 Allow creating rules without conditionExpression. (#1375) *(@pawelleszczewicz)*
- 💰 Improve product search in sales line item dialog. (#1373) *(@amtmich)*
- 🐛 Prevent ReDoS in event trigger regex filter conditions. (#1371) *(@RMN-45)*
- 🐛 Prevent privilege escalation via CALL_API admin-by-name lookup. (#1370) *(@RMN-45)*
- 🐛 Block SSRF in outbound webhook delivery URLs. (#1369) *(@RMN-45)*
- 🐛 Enforce tenant scope on public-partition file access. (#1366) *(@RMN-45)*
- 🐛 Backport isolated-vm sandbox from main to develop (RCE fix). (#1365) *(@RMN-45)*
- 🔐 Honor All Organizations for ACL __all__ non-superAdmins. (#1357) *(@pawelleszczewicz)*
- 🌍 Add missing i18n translation files (#897). (#1354) *(@pawelleszczewicz)*
- 🐛 Add missing open-api specs for responses for workflows api #333. (#1345) *(@Marynat)*
- 🐛 Ensure tag filters display labels instead of UUIDs across affected pages (fixes #238). (#1344) *(@Marynat)*
- 🔧 Prevent build failures when the example module is disabled #601. (#1333) *(@Marynat)*
- 🐛 Standardize org validation error when context is missing (#958). (#1321) *(@pawelleszczewicz)*
- 🔐 Re-resolve customer portal ACL on every request. (#1316) *(@WH173-P0NY)*
- 🐛 Normalize empty/null extracted text in attachment preview (#979). (#1315) *(@pawelleszczewicz)*
- 🐛 Apply entityId filter in comments list endpoint (#1100). (#1314) *(@pawelleszczewicz)*
- 🐛 Consistent timestamp formatting in table views and tooltips (#946). (#1312) *(@pawelleszczewicz)*
- 🐛 Reject forged payment gateway webhooks. (#1311) *(@WH173-P0NY)*
- 💰 Add email and phone validation to shipment form (#1018). (#1304) *(@pawelleszczewicz)*
- 🐛 Gitignore test-results and playwright-report globally. (#1298) *(@jtomaszewski)*
- 🐛 Hide navbar search when search module is disabled. (#1297) *(@jtomaszewski)*
- 📦 Replace ghost `modules:prepare` references with `yarn generate`. (#1295) *(@matkowalski)*
- 🔄 Block Akeneo SSRF and credential leaks. (#1285) *(@WH173-P0NY)*
- 🐛 Accept date strings in definition form schema. (#1275) *(@RadnoK)*
- 🔧 Enforce tenant isolation on sudo challenge configs. (#1272) *(@WH173-P0NY)*
- 🔐 Prevent open redirect in locale switch endpoint. (#1264) *(@MarekUrzon)*
- 🐛 Return 422 for deal UUID passed as timeline entityId. (#1262) *(@amtmich)*
- 🔐 Reject non-superadmin actors with null tenant in roleTenantGuard. (#1257) *(@MarekUrzon)*
- 🔐 Apply input validation to feature-check endpoint to prevent DoS. (#1254) *(@staskolukasz)*
- 🐛 Replace PDF OCR delegate chain with pdfjs-dist. (#1250) *(@WH173-P0NY)*
- 💰 Prevent concurrent return double credits. (#1249) *(@WXYZx)*
- 💰 Prevent concurrent shipment overshipping. (#1247) *(@WXYZx)*
- 💰 Reorder document detail tabs. (#1245) *(@amtmich)*
- 🔐 Restore admin nav module source. (#1239) *(@adam-marszowski)*
- 🔐 Revoke customer sessions after admin password reset. (#1223) *(@MarekUrzon)*
- 🐛 Restore legacy output format for AST-generated module registry. (#1219) *(@pkarw)*
- 📦 Yarn dev doesn't work out of the box in devcontainer. command fails when opening splash. (#1218) *(@MarekUrzon)*
- 🐛 Enforce tenant isolation in isCancellationRequested. (#1213) *(@MarekUrzon)*
- 🐛 Visual editor step delete does not work with nested confirm dialog. (#1211) *(@RadnoK)*
- 🔐 Splash stuck on "preparing" when warmup login returns 401. (#1203) *(@jtomaszewski)*
- 🐛 Correct outdated statements in README files. (#1187) *(@matkowalski)*
- 🐛 Fix db:generate metadata leak and migration filename collision. (#1180) *(@staskolukasz)*
- 🐛 "Blocked" checkbox incorrectly placed inside Attachments section #1113. (#1178) *(@muhammadusman586)*
- 🐛 Stabilization fixes. (#1174) *(@pkarw)*
- 📦 Include build:packages prerequisite in README quickstart. (#1171) *(@lukaszbos)*
- 🐳 Dev container build fixes and personal compose overrides. (#1146) *(@kurrak)*
- 🐛 Bump vulnerable lodash-es and serialize-javascript resolutions. (#1140) *(@pkarw)*
- 🐛 Onoarding stabilization fix + onboarding progress. (#1135) *(@pkarw)*
- 🐛 CR fixes. (#1128) *(@pkarw)*
- 🐛 Todo priority field accepts values outside allowed range (1–5). (#1122) *(@haxiorz)*
- 🐛 Hide "All Organizations" when user lacks cross-org access. (#1102) *(@matgren)*
- 🐛 Wait for child processes on shutdown to prevent stale lock file. (#1096) *(@matgren)*

## 🛠️ Improvements
- 🛠️ Optimize treeshaking for icons (supersedes #1493). (#1516) *(@Sawarz, via @pkarw)*
- 🛠️ Fix stored XSS in attachment uploads (supersedes #1302). (#1442) *(@WH173-P0NY, via @pkarw)*
- 🛠️ Add unit test coverage for onboarding package (supersedes #1313). (#1441) *(@pawelleszczewicz, via @pkarw)*
- 🛠️ Lazy-load heavy libraries for schedule, markdown, and API docs (#1408). (#1615) *(@pkarw)*
- 🛠️ Eliminate N+1 queries in user listing and role validation (#1398). (#1613) *(@pkarw)*
- 🛠️ Memoize Tabs context value to prevent consumer re-renders (#1409). (#1610) *(@pkarw)*
- 🛠️ Cache API key auth resolution and debounce lastUsedAt writes (#1400). (#1576) *(@pkarw)*
- 🛠️ Bump follow-redirects from 1.15.11 to 1.16.0 (develop). (#1544) *(@pkarw)*
- 🛠️ Parallel job graph, sharded integration tests, Turbo cache. (#1509) *(@yokoszn)*
- 🛠️ Feat/windows prereq powershell setup. (#1496) *(@PawelSydorow)*
- 🛠️ Fix standalone dist cleanup for integration parity. (#1471) *(@pkarw)*
- 🛠️ PR label workflow — streamlined review & QA pipeline. (#1456) *(@pkarw)*
- 🛠️ Fix coverage warmup and prevent DB connection pool exhaustion. (#1439) *(@staskolukasz)*
- 🛠️ Dedupe inbound replays without message id. (#1394) *(@WXYZx)*
- 🛠️ Serialize quote acceptance to order conversion. (#1392) *(@WXYZx)*
- 🛠️ Serialize workflow instance execution. (#1391, #1393) *(@WXYZx)*
- 🛠️ Enforce endpoint RBAC in code mode api requests. (#1390) *(@WXYZx)*
- 🛠️ Enforce trusted tenant scope in subscribers. (#1389) *(@WXYZx)*
- 🛠️ Feature/smart test skill. (#1374) *(@AK-300codes)*
- 🛠️ Fix flaky test. (#1367) *(@AK-300codes)*
- 🛠️ Add low-level coverage for interceptors.ts. (#1364) *(@pawelleszczewicz)*
- 🛠️ Fix missing idempotency in shipping carrier webhook processing. (#1360) *(@WXYZx)*
- 🛠️ Add low-level coverage for presenter-enricher.ts. (#1356) *(@pawelleszczewicz)*
- 🛠️ Add low-level coverage for debug.ts. (#1355) *(@pawelleszczewicz)*
- 🛠️ Add low-level coverage for merger.ts. (#1352) *(@pawelleszczewicz)*
- 🛠️ Add low-level coverage for agentic-init.ts. (#1351) *(@pawelleszczewicz)*
- 🛠️ Add integration tests for sales, customers, and auth modules #622. (#1349) *(@Marynat)*
- 🛠️ Enforce RBAC on customer detail endpoints and add guardrail test. (#1327) *(@Tomeckyyyy)*
- 🛠️ Add low-level coverage for agentic-setup.ts. (#1322) *(@pawelleszczewicz)*
- 🛠️ Add normalization for nested profile payloads in people and companies (#793, #792). (#1320) *(@Marynat)*
- 🛠️ Fix API dispatcher auth default. (#1305) *(@WH173-P0NY)*
- 🛠️ Add unit test coverage for content package. (#1303) *(@pawelleszczewicz)*
- 🛠️ Prevent unsafe protocols in inline URL custom fields. (#1296) *(@WXYZx)*
- 🛠️ Harden attachment image rendering before sharp processing. (#1294) *(@WXYZx)*
- 🛠️ Fix staff session token rotation on login. (#1293) *(@WXYZx)*
- 🛠️ Fix customer auth compound rate-limit identifiers. (#1292) *(@WXYZx)*
- 🛠️ Fix customer signup account enumeration. (#1291) *(@WH173-P0NY)*
- 🛠️ Fix business rules page RBAC metadata alignment. (#1288) *(@WXYZx)*
- 🛠️ Add screenshot to workflows documentation. (#1284) *(@pawelleszczewicz)*
- 🛠️ Fix API dispatcher bypass for top-level RBAC metadata. (#1283) *(@AK-300codes)*
- 🛠️ Feat/ds semantic tokens v2. (#1281) *(@zielivia)*
- 🛠️ Replace raw fetch with apiCall/apiFetch, add readJsonSafe, expose openApi, fix Escape handler. (#1278) *(@strzesniewski)*
- 🛠️ Add error handling and encryption-safe lookups to notification subscriber and email worker. (#1270) *(@strzesniewski)*
- 🛠️ Fix/superadmin privilege escalation. (#1266) *(@WH173-P0NY)*
- 🛠️ Fix/Jwt not expired. (#1252) *(@MarekUrzon)*
- 🛠️ Refine unified AI tooling and sub-agents spec. (#1251) *(@pkarw)*
- 🛠️ Fix markAllAsRead to emit read + SSE events per notification. (#1248) *(@Tomeckyyyy)*
- 🛠️ Add low-level coverage for module-entities.ts. (#1246) *(@pawelleszczewicz)*
- 🛠️ Add Tenant org/scoped to all nativeDelete calls. (#1244) *(@strzesniewski)*
- 🛠️ Logout from develop environment redirects to demo environment. (#1242) *(@pawelleszczewicz)*
- 🛠️ Improve reliability of webhooks and fix cross-org data leak in webhook workers. (#1241) *(@strzesniewski)*
- 🛠️ Add low-level coverage for openapi-paths.ts. (#1238) *(@pawelleszczewicz)*
- 🛠️ Sales Documents Tenant Scope Fixes. (#1236) *(@strzesniewski)*
- 🛠️ Add low-level coverage for inspect.ts. (#1234) *(@pawelleszczewicz)*
- 🛠️ Fix #1229: roll out sticky actions column to wide backend lists. (#1233) *(@amtmich)*
- 🛠️ Add low-level coverage for list.ts. (#1231) *(@pawelleszczewicz)*
- 🛠️ Add low-level coverage for check.ts. (#1230) *(@pawelleszczewicz)*
- 🛠️ Custom fields of `kind: relation` render as raw UUIDs instead of entity titles/links in DataGrid. (#1227) *(@pawelleszczewicz)*
- 🛠️ Docs/design system audit 2026 04 10. (#1226) *(@zielivia)*
- 🛠️ Fix/hackon/005 sales payments integrity. (#1221) *(@strzesniewski)*
- 🛠️ Fix missing tenant scope on public quote endpoints (Sales Module). (#1216) *(@strzesniewski)*
- 🛠️ Move default encryption maps to per-module registration. (#1214) *(@amtmich)*
- 🛠️ Fix tenant isolation and race conditions in customer_accounts module. (#1212) *(@strzesniewski)*
- 🛠️ Add low-level coverage for metadata.ts. (#1209, #1308) *(@pawelleszczewicz)*
- 🛠️ Add low-level coverage for featureMatch.ts. (#1207) *(@pawelleszczewicz)*
- 🛠️ Add low-level coverage for passwordPolicy.ts. (#1206) *(@pawelleszczewicz)*
- 🛠️ Add low-level coverage for crud.ts. (#1205) *(@pawelleszczewicz)*
- 🛠️ Block enterprise tests when OM_ENABLE_ENTERPRISE_MODULES is false. (#1204) *(@strzesniewski)*
- 🛠️ Add low-level coverage for boolean.ts. (#1200) *(@pawelleszczewicz)*
- 🛠️ Add low-level coverage for appResolver.ts. (#1199, #1289) *(@pawelleszczewicz)*
- 🛠️ Add low-level coverage for jwt.ts. (#1198) *(@pawelleszczewicz)*
- 🛠️ Re-enable skipped test "should export generateApiClient". (#1197) *(@pawelleszczewicz)*
- 🛠️ Fix organization tenant selection and switcher refresh for issue #959. (#1195) *(@amtmich)*
- 🛠️ README getting-started grammar: 'a quickest way'. (#1189) *(@pawelleszczewicz)*
- 🛠️ Fix #902: keep product list actions column visible without horizontal scroll. (#1186) *(@amtmich)*
- 🛠️ Fix/suppress notice bars during integration testing. (#1167) *(@Marynat)*
- 🛠️ Add SPEC-072 CRM detail pages UX enhancements. (#1156) *(@zielivia)*
- 🛠️ Add SPEC-071 SEO helper validation visibility. (#1155) *(@zielivia)*
- 🛠️ Spec/perspectives views panel. (#1148) *(@zielivia)*
- 🛠️ Add empty app starter preset spec. (#1142) *(@pkarw)*
- 🛠️ Yarn dev optimization + support for structural changes. (#1141) *(@pkarw)*
- 🛠️ Feat/ready-apps-cli. (#1130) *(@dominikpalatynski)*

## 🧪 Testing
- 🧪 Integration tests for availability rule sets and CRUD (supersedes #1348). (#1474) *(@Marynat, via @pkarw)*
- 🧪 Add integration tests for workflow definitions and instances. (#1347) *(@Marynat)*

## 📝 Specs & Documentation
- 📝 Add local development walkthrough (#1435). (#1611) *(@pkarw)*
- 📝 Add sync-merged-pr-issues and auto-update-changelog skills. (#1568) *(@pkarw)*
- 📝 Add auto-qa-scenarios, auto-sec-report-pr, and auto-sec-report. (#1542) *(@pkarw)*
- 📝 Add auto-implement-spec skill specification. (#1537) *(@matgren)*
- 📝 Add auto-review loop and summary comment to auto-*-pr. (#1528) *(@pkarw)*
- 📝 Add create-pr and continue-pr skills. (#1522) *(@pkarw)*
- 📝 [codex] finalize PR label workflow. (#1489) *(@pkarw)*
- 📝 Integrate PR #1222 analysis into unified AI tooling spec. (#1478) *(@pkarw)*
- 📝 Improve and fix customization guide tutorials. (#1326) *(@pawelleszczewicz)*
- 📝 Fix broken spec references in AGENTS.md files (#1084). (#1301) *(@pawelleszczewicz)*
- 📝 Add missing sidebar entry for user-guide/self-service-onboarding. (#1290) *(@pawelleszczewicz)*
- 📝 Design System enforcement — AGENTS.md rules, PR checklist, and DS Guardian skill. (#1282) *(@zielivia)*
- 📝 Add missing sidebar entry for user-guide/checkout. (#1196) *(@pawelleszczewicz)*
- 📝 Portal custom domain routing. (#1173) *(@pat-lewczuk)*
- 📝 Add customers lead funnel specification. (#1149) *(@itrixjarek)*

## 👥 Contributors

- @jtomaszewski
- @pkarw
- @vloneskorpion
- @Sawarz
- @WH173-P0NY
- @Zales0123
- @muhammadusman586
- @matgren
- @pat-lewczuk
- @WXYZx
- @bobec83
- @yokoszn
- @PawelSydorow
- @RadnoK
- @staskolukasz
- @Marynat
- @AK-300codes
- @pawelleszczewicz
- @strzesniewski
- @zielivia
- @pmadajthey
- @MORY33
- @amtmich
- @RMN-45
- @lchrusciel
- @Tomeckyyyy
- @matkowalski
- @MarekUrzon
- @adam-marszowski
- @lbajsarowicz
- @lukaszbos
- @haxiorz
- @itrixjarek
- @kurrak
- @dominikpalatynski

---
# 0.4.10 (2026-04-01)

## Highlights
This release delivers **Customers v2** 👥 (SPEC-046a & SPEC-046b) — a complete redesign of the customers module with updated people/companies data model and enhanced CRUD operations. It also ships **Integration Marketplace specs** 🔌 for commands, events, and projects, a comprehensive **ACL wildcard hardening** 🔐 effort across navigation and runtime gates, and significant **Standalone & Docker** 🐳 infrastructure improvements.

## ✨ Features

### 👥 Customers v2 — SPEC-046a & SPEC-046b
- Complete redesign of the customers module with updated data models for people and companies, improved relationships, and enhanced CRUD operations. (#1050) *(@maciej-dudziak)*

### 🔌 Integration Commands, Events & Projects Specs
- New specifications for integration marketplace commands, events, and project-scoped integration management. (#1092) *(@pkarw)*

## 🐛 Fixes

### 🔐 Security & ACL
- 🛡️ Harden wildcard ACL handling — aligned wildcard feature matching across navigation sections, runtime gates (menu items, notification handlers, mutation guards, command interceptors), and audit permission checks. (#1079, #1086) *(@pkarw)*
- 🔒 Hide upload button for users without `attachments.manage` permission. (#1093) *(@BarWyDev)*
- 🏢 Hide "All Organizations" in directory when user lacks cross-org access. (#1102) *(@mat-gren)*
- 📦 Bump transitive deps to patch security vulnerabilities. (#1091) *(@pkarw)*

### 💰 Sales & Catalog
- 🔢 Generate new order number when converting quote to order instead of reusing quote number. (#1097) *(@muhammadusman586)*
- 🔄 Restore variant list after clearing selection in quote/order line items. (#1073) *(@pkarw)*

### 🖥️ UI & UX
- 🔔 Notification panel layout and behavior improvements. (#1081) *(@pkarw, @maciej-dudziak)*
- 🧹 Remove unused webhook settings component from the sidebar. *(@pkarw)*
- 🔄 Re-fetch LookupSelect items when options transitions from array to undefined. *(@amtmich)*

### 🐳 Standalone & Docker
- 🔧 Multiple standalone app packaging and runtime fixes. (#1105, #1109) *(@pkarw)*
- 🐳 Docker permissions, pre-built image support, and healthcheck endpoint fixes. *(@pkarw)*
- 📁 Update Dockerfile to use `.mercato` directory and adjust build steps. (#1094) *(@MStaniaszek1998)*
- ✅ Improve standalone `create-app` validation and query alias handling. (#1098) *(@pkarw)*

### ⚙️ Core & Infrastructure
- 🛑 CLI: wait for child processes on shutdown to prevent stale Next.js lock files. (#1096) *(@mat-gren)*
- 🔍 Fix onboarding vector reindex hanging. (#1117) *(@pkarw)*
- 📎 Fix todos attachments handling. (#1121) *(@maciej-dudziak)*
- ✅ Fix validation logic. (#1122) *(@maciej-dudziak)*
- 🔧 CR fixes — various code review follow-ups. (#1116, #1128) *(@pkarw)*

## 👥 Contributors

- @pkarw
- @maciej-dudziak
- @mat-gren
- @muhammadusman586
- @MStaniaszek1998
- @BarWyDev
- @amtmich

---

# 0.4.9 (2026-03-25)

## Highlights
This release delivers **Webhooks** 🔔 (SPEC-057) — full outbound & inbound webhook infrastructure with Standard Webhooks signing and delivery queues. It also ships **Pay Links & Checkout** 💳 with shareable payment links, the **Security Enterprise** module 🔐 with advanced access controls, and the **InPost Shipping Carrier** integration 🚚 with ShipX API conformance and shipment wizard (later extracted to official-modules). Additionally: **Official Modules CLI**, **Marketing Consents**, **AI Assistant Code Mode**, and a large batch of bug fixes, i18n additions, and integration test coverage.

## ✨ Features

### 🔔 Webhooks (SPEC-057)
- Full outbound and inbound webhooks implementation with Standard Webhooks signing, delivery queues, admin UI, and marketplace webhook settings. (#1010) *(@pkarw)*
- Webhook updates — bug fixes and refinements to the webhooks system. (#1059) *(@pkarw)*

### 💳 Pay Links & Checkout
- New `checkout` package and Pay Links feature per the `2026-03-19-checkout-pay-links.md` spec — shareable payment links for orders with checkout flow. (#1025, #1027) *(@pkarw)*

### ✅ Marketing Consents & Updated Terms/Privacy
- Marketing consent management with updated terms of service and privacy policy static pages. (#1058) *(@pkarw)*

### 📦 Official Modules CLI
- CLI commands to provision, add, and enable modules from the official-modules repository. (#1003) *(@dominikpalatynski)*
- `--eject` support for `module add` and `module enable` commands with aligned docs/tests. *(@dominikpalatynski)*
- `CliEnvironment` value-object for improved standalone app path resolution and integration test discovery. *(@dominikpalatynski)*
- Enhanced module management with module-specific options and improved documentation. *(@dominikpalatynski)*

### 🚚 InPost Shipping Carrier Integration
- Complete InPost carrier integration package with ShipX API conformance, drop-off point picker with Points API search, shipment creation wizard, parcel template selection, and full i18n (en/es/de). (#964) *(@gracjan-gorecki)*
- Shipment creation wizard with `ts-pattern` matching and unit tests. *(@gracjan-gorecki)*
- Official docs conformance, live test hardening, and demo page fixes. *(@gracjan-gorecki)*
- Later extracted to official-modules repository. *(@gracjan-gorecki)*

### 🔐 Security Enterprise Module
- Enterprise security module implementation with advanced access controls. (#938) *(@dominikpalatynski)*

### 🤖 AI Assistant Code Mode
- Code mode tools for the MCP AI assistant with type injection, sandbox evaluation, and improved error formatting. *(@wojciech-baklazec)*
- Optional session token with API key fallback and MCP code mode tests. *(@wojciech-baklazec)*
- Auto-wrap bare expressions in MCP sandbox. *(@wojciech-baklazec)*

### 🗃️ Other Features
- 🚀 Release channels documentation and develop snapshot release workflow. (#1041) *(@dominikpalatynski)*
- 🧪 SPEC-050 catalog unit tests phase 2 — expanded test coverage for catalog module. (#1024) *(@migsilva89)*
- 🧰 Integration test helpers exported at npm-published paths for standalone apps. (#1037, #1046) *(@mat-gren)*
- ⚙️ Settings page reorganization for improved usability. (#1055) *(@maciej-dudziak)*
- 🔄 Redundant flow improvement after creating product variant. (#950) *(@rotynski)*
- 🧪 SPEC-050 catalog integration tests phase 3 — 10 new test files (TC-CAT-016 through TC-CAT-025) covering category edit/delete, offer CRUD, price management, option schemas, advanced filtering, duplicate SKU validation, soft-delete, media, multi-variant products, and pricing edge cases. (#1053) *(@migsilva89)*
- 🔧 SPEC for Dev/build coexistence — safe side-by-side `yarn dev` and `yarn build` with onboarding lock and i18n fixes for checkout, security, and onboarding modules. *(@pkarw)*

## 🐛 Fixes
- 🧭 Move Security and Developers modules to Settings sidebar for better discoverability. (#1060) *(@muhammadusman586)*
- 💱 Derive order default currency from catalog price kind instead of hardcoded default (fixes #982). (#1056) *(@mwardon)*
- 🔄 Redirect to workflow definitions list after create (fixes #971). (#983) *(@rafal-makara)*
- 🔑 Seed custom role ACLs after `seedDefaults` — correct initialization order. (#1049) *(@mat-gren)*
- 🔑 Support custom roles in `defaultRoleFeatures` alongside built-in roles. (#1040) *(@mat-gren)*
- 🔍 Keep session on global search 403 and show permission message instead of logout. (#1008, #1026) *(@muhammadusman586, @pkarw)*
- 📦 Fix product SKU & category hidden in UI (fixes #970). (#995) *(@maciej-dudziak)*
- 👥 Fix filtering users + missing translations (fixes #997). (#1011) *(@maciej-dudziak)*
- 👤 Fix role assignment issues. (#1013) *(@maciej-dudziak)*
- 📋 Populate select options for inline grouped fields in CrudForm. (#993) *(@muhammadusman586)*
- 🔢 Remove 8-item cap from combobox suggestions for currency dropdown. (#998) *(@muhammadusman586)*
- 🔙 Add back-to-login navigation on reset password page (fixes #969). (#984) *(@jszarras)*
- 🌍 Add missing translations for double name label (fixes #893). (#1009) *(@karol-kozer)*
- 🌍 Add missing validation translations (fixes #900). (#1002) *(@karol-kozer)*
- 🌍 Add missing translations (fixes #896). (#1001) *(@karol-kozer)*
- 🪟 Handle OpenAPI generator paths correctly on Windows. (#1043) *(@dominikpalatynski)*
- 🛡️ Guard `catalog_product_offers` references in translation migration. (#1048) *(@mat-gren)*
- 🔧 Wire integration test infrastructure for standalone `create-app` projects. (#1046) *(@mat-gren)*
- 📄 Preserve regex patterns, fix ZodRecord/passthrough schemas in OpenAPI generation. *(@wojciech-baklazec)*
- 🔑 Restrict employee role from accessing module settings pages — added proper `defaultRoleFeatures` for catalog, customers, and sales. (#1065) *(@amtmich)*
- 💬 Keep messages autosuggest working for multi-character recipient queries with unit tests. (#1062) *(@dominikpalatynski)*

## 🛠️ Improvements
- 🏗️ Type `buildAdminNav` params and optimize parent-finding algorithm. (#1045) *(@maciej-cielecki)*
- 📝 Spec naming strategy fixed to avoid filename conflicts. (#1022) *(@pkarw)*
- 🔧 Add `chance` and `@types/chance` as explicit devDependencies. *(@gracjan-gorecki)*

## 📝 Specs & Documentation
- 📋 SPEC-052: Use-Case Starters Framework. (#825) *(@mat-gren)*
- 📋 SPEC-053c: Partner Portal & Module Slimming. (#1012) *(@mat-gren)*
- 📖 Updated examples repo to ready-apps, removed superseded SPEC-062. (#1036) *(@mat-gren)*
- 📖 Aligned SPEC-053 family bootstrap flow with SPEC-062. (#1006) *(@mat-gren)*
- 📖 Updated enterprise README with all delivered modules and fixed license year. (#1007) *(@mat-gren)*
- 📋 SPEC-041: Core timesheets functionality specification (SPEC-069). (#678) *(@mpiatkowski)*
- 📁 Move implemented specs to `implemented/` folder for better organization (fixes #1039). (#1064) *(@karol-kozer)*
- 🔗 Specs reorganization and links fixes. *(@pkarw)*

## 👥 Contributors

- @pkarw
- @gracjan-gorecki
- @mat-gren
- @wojciech-baklazec
- @dominikpalatynski
- @muhammadusman586
- @maciej-dudziak
- @karol-kozer
- @marcinwadon
- @rafal-makara
- @maciej-cielecki
- @migsilva89
- @jszarras
- @rotynski
- @amtmich
- @mpiatkowski

---

# 0.4.8 (2026-03-17)

## Highlights
This release delivers the **Customer Accounts & Portal** (SPEC-060) — a full customer identity and portal authentication module with RBAC, magic links, CRM auto-linking, and an extensible customer portal with dashboard, sidebar, and widget injection. It also ships **Order Returns**, **AI Inbox Phase 2** enhancements, migration generation improvements for standalone apps, and numerous security, validation, and UX fixes.

## ✨ Features

### 👤 Customer Accounts & Portal (SPEC-060)
- Customer Accounts module — two-tier `CustomerUser` identity model with JWT pipeline, invitation system, signup/login/magic links, customer RBAC, and CRM auto-linking. (#973) *(@pat-lewczuk)*
- Customer Portal — extensible portal shell with dashboard, sidebar navigation, notifications, and full UMES widget injection support. (#973) *(@pat-lewczuk)*
- Portal feature toggle gate — portal access gated behind a feature flag for controlled rollout. *(@pat-lewczuk)*
- Admin user management — staff-facing APIs for managing customer accounts from the backoffice. *(@pat-lewczuk)*
- Server-side portal auth and org resolution — eliminated all layout blink on portal pages. *(@pat-lewczuk)*

### 📦 Order Returns
- Full order returns workflow — customers and staff can initiate, review, and process product returns with status tracking. (#907) *(@Sawarz)*

### 🤖 AI Inbox Phase 2
- Enhanced AI-powered inbox operations with improved message processing, action fixes, and agent capabilities. (#976) *(@haxiorz)*

### 🗃️ Other Features
- Integration tests Phase 2 coverage for AI Inbox flows. (#975) *(@janzaremski)*

## 🔒 Security
- 🔑 Require current password for self-service password change — prevents unauthorized password changes from stolen sessions. (#961) *(@mkadziolka)*

## 🐛 Fixes
- 📧 Add client-side email validation to reset password form — prevents invalid submissions before server round-trip. (#974) *(@JSzarras)*
- 📎 Avoid duplicate file-required validation message on attachment fields. (#986) *(@musman)*
- 👥 Fix duplicate "Add address" actions in Customer addresses empty state. (#977) *(@mkadziolka)*
- 💰 Validate price amounts before DB flush to avoid 500 on overflow for very large values (fixes #908). (#963) *(@mkadziolka)*
- 🌍 Translate CRUD validation messages — server-side zod errors now return localized strings. (#962) *(@mkadziolka)*
- 🔐 Localize profile update validation errors in auth module. *(@mkadziolka)*
- 📦 Resolve `workspace:*` protocol leaking into published npm packages. (#985) *(@pat-lewczuk)*
- 🔧 Add missing `"type": "module"` to standalone app template. *(@pat-lewczuk)*
- 🔄 Replace raw `fetch` with `apiCall` in portal hooks and sync template. *(@pat-lewczuk)*

## 🛠️ Improvements
- 🗂️ Migration generation improvements for `@app` modules — separate tsx detection from ts import fallback, idempotent constraint drops, CLI jest alias mapping. (#905) *(@armal)*
- 🐳 Forward ports for PostgreSQL, Redis, and Meilisearch services in dev container. (#957) *(@jhorubala)*
- 📖 Customer accounts AGENTS.md documentation and standalone app guide updates. *(@pat-lewczuk)*

## 🚀 CI/CD & Infrastructure
- 🔧 CI release flow and canary publish fixes. *(@pkarw)*
- 📦 Dependabot security insights integration. *(@pkarw)*

## 👥 Contributors

- @pat-lewczuk
- @Sawarz
- @haxiorz
- @mkadziolka
- @janzaremski
- @JSzarras
- @armal
- @pkarw
- @jhorubala
- @musman

---

# 0.4.7 (2026-03-12)

## Highlights
This release delivers the **Integration Marketplace** with Payment Gateways, Shipping Carriers hubs, and the first integration provider — **Akeneo PIM sync** (SPEC-044/045c/045h). It also ships **Agentic Tool Setup** for standalone apps (SPEC-058), **Docker Command Parity** for Windows developers (SPEC-054), a critical **session invalidation security fix**, **Railway deployment** support, and numerous sales and UX bug fixes.

## ✨ Features

### 🔌 Integration Marketplace — Payment & Shipping Hubs (SPEC-044/045c/045h)
- Payment Gateways hub module — unified `GatewayAdapter` contract, payment session lifecycle (create/capture/refund/cancel), transaction entity with status machine, webhook receiver with signature verification, status polling worker, and admin UI. (#859) *(@pkarw)*
- Shipping Carriers hub module — unified carrier adapter contract, shipment tracking, label generation, and rate calculation infrastructure. (#859) *(@pkarw)*
- Akeneo PIM integration provider — full product sync adapter with field mapping, scheduled sync, and Integration Marketplace wiring. (#935) *(@pkarw)*

### 🤖 Agentic Tool Setup for Standalone Apps (SPEC-058)
- Standalone app developers using AI coding tools now get auto-generated AGENTS.md, CLAUDE.md, and tool configuration out of the box. (#932) *(@pat-lewczuk)*

### 🐳 Docker Command Parity for Windows (SPEC-054)
- Cross-platform Docker command wrappers (`scripts/docker-exec.mjs`) enabling Windows developers to run any monorepo command from their native terminal without WSL. (#866) *(@dominikpalatynski)*

### 🗃️ Other Features
- 🏠 Moved demo-credentials hint from /login to the start page for production build visibility. (#873) *(@mkadziolka)*

## 🔒 Security
- 🔑 Invalidate all user sessions (access + refresh tokens) on password change and reset — prevents stolen token reuse. (#888) *(@mkadziolka)*

## 🐛 Fixes
- 🛒 Cancel/back on document creation now returns to the correct list page instead of `/backend/sales/channels`. (#942) *(@rengare)*
- 📦 Auto-select primary shipping address when a customer is chosen on document creation forms. (#943) *(@rengare)*
- 🖼️ Enrich quote/order line images with current product media when catalog images are updated. (#914) *(@piorot)*
- 🔍 Scroll active result into view on arrow key navigation in global search dialog. (#884) *(@MrBuldops)*
- 🔐 Show access denied page instead of login redirect for authenticated users lacking permissions (#807). (#874) *(@Gajam19)*
- 🔧 Fix deal pipeline data not saving when adding a new deal. (#924) *(@MYMaj)*
- 📋 Display fallback "Select" option when form value is empty — fixes TenantSelect validation mismatch. (#882) *(@wisniewski94)*
- 💰 Handle price variant validation properly with improved coverage (#904). (#913) *(@Magiczne)*
- 📦 Return user-friendly validation error for duplicate SKU instead of 500 (#909). (#912) *(@michal1986)*
- 🔄 Finish duplicate definition flow in workflows and add regression tests. (#887) *(@mkadziolka)*
- 🔢 Validate quantity limit on sales line items to prevent `NUMERIC field overflow` on extremely large values (#920). (#925) *(@michal1986)*
- 🕐 Consistent timestamp format in Payments table tooltip — localized time instead of raw UTC ISO string (#946). (#951) *(@michal1986)*
- 💳 Fix payment method not displayed in Order Details after adding a payment (#947). (#952) *(@michal1986)*

## 🧪 Testing
- 🔍 Cover search fallback presenter and improve name/title resolution with unit tests. (#886) *(@mkadziolka)*
- 🔑 Add route-level GET tests for `/api/auth/users` and `/api/auth/roles` with tenant/RBAC filtering. (#885) *(@mkadziolka)*

## 📝 Specs & Documentation
- 📋 SPEC-060: Customer Identity & Portal Authentication — two-tier `CustomerUser` identity model with RBAC, JWT pipeline, invitation system, and CRM auto-linking. (#863) *(@pat-lewczuk)*
- 📖 Add screenshots and fix search documentation to match actual codebase state (#331). (#881) *(@MrBuldops)*

## 🚀 CI/CD & Infrastructure
- 🚂 Railway deployment support with dependency hardening — fixes `@ai-sdk/openai` version conflicts and hoisting issues. (#937) *(@freakone)*

## 👥 Contributors

- @pkarw
- @pat-lewczuk
- @mkadziolka
- @rengare
- @MrBuldops
- @dominikpalatynski
- @michal1986
- @piorot
- @MYMaj
- @freakone

### 🌟 First-time Contributors

Welcome and thank you to our new contributors! 🙌

- @mkadziolka
- @Magiczne
- @wisniewski94
- @Gajam19

---

# 0.4.6 (2026-03-06)

## Highlights
This release delivers **Single Sign-On (SSO)** 🔐 — a full enterprise-grade SSO module with OIDC, SCIM directory sync, and JIT provisioning supporting Google Workspace, Microsoft Entra ID, and Zitadel. It also ships the **Integration Hub** foundation (SPEC-045a/b), **VS Code Dev Container** for one-click development, major **UMES progression** (phases E–N covering mutation lifecycle, query engine extensibility, recursive widgets, DevTools, and integration extensions), **SSE-based real-time notifications & progress**, **Actionable Notifications** (SPEC-042/043), **AI Inbox Phase 2**, and **Preview Environments** for QA. Welcome to **7 first-time contributors**! 🎉

## ✨ Features

### 🔐 Single Sign-On (SSO) — Enterprise
- Full SSO module with OIDC provider support (Google Workspace, Microsoft Entra ID, Zitadel) including login flow, error handling, and email verification. (#765) *(@MStaniaszek1998, @pkarw)*
- SCIM 2.0 directory sync with filter and patch operations for automated user provisioning. *(@pkarw)*
- Just-In-Time (JIT) provisioning with mutual exclusivity enforcement between JIT and SCIM modes. *(@pkarw)*
- Administrator UI for configuring SSO domains via widget injection (decoupled from core auth). *(@pkarw)*
- Google Workspace OIDC blockers resolved with automatic provider detection. *(@pkarw)*
- Security audit fixes addressing critical and high severity findings. *(@pkarw)*
- Enterprise feature flag toggle for SSO module visibility. *(@pkarw)*
- SSO documentation with setup guides for Entra ID, Google Workspace, and Zitadel. (#862) *(@MStaniaszek1998)*
- Multi-language i18n support (EN, PL, DE, ES) for all SSO strings. *(@pkarw)*

### 🔌 Integration Hub (SPEC-045)
- 🏪 Integration Marketplace foundation — registry, bundles, credentials, state management, health checks, logs, and admin UI. (#831) *(@pkarw)*
- 🔄 Data Sync Hub — adapters, run lifecycle, workers, mapping APIs, scheduled sync, and progress linkage. (#831) *(@pkarw)*
- 📋 Gap-filling for integration hub specifications and edge cases. (#828) *(@pkarw)*

### 🔄 UMES (Unified Module Event System) — Phases E–N
- 📦 Phases E–H — extended module event patterns and subscriber infrastructure. (#751) *(@pkarw)*
- 🔗 Phase L — integration extensions enabling cross-module event wiring. (#781) *(@pat-lewczuk)*
- 🧬 Phase M — mutation lifecycle hooks (m1–m4) with before/after guards and sync subscribers. (#782) *(@pat-lewczuk)*
- 🔍 Phase N — query engine extensibility with query-level enrichers and sync query events. (#811) *(@pat-lewczuk)*
- 🔁 Phase J — recursive widgets for nested injection patterns. (#821) *(@pkarw)*
- 🛠️ Phase K — UMES DevTools with conflict detection for debugging event flows. (#834) *(@pat-lewczuk)*

### 📢 Actionable Notifications & Multi-ID Filtering (SPEC-042/043)
- Actionable notification handlers with `useNotificationEffect`, record locks polling refactor, and filter-by-IDs query parameter support. (#797) *(@pkarw)*

### 📡 SSE Real-Time Notifications & Progress
- Migration of progress tracking and notifications from polling to Server-Sent Events (SSE) for real-time browser updates. (#810) *(@pkarw)*

### 🤖 AI Inbox Phase 2 (SPEC-053)
- Enhanced AI-powered inbox operations with improved message processing and agent capabilities. (#816) *(@haxiorz)*

### 🐳 VS Code Dev Container
- One-click development setup with full VS Code Dev Container configuration (PostgreSQL, Redis, Elasticsearch). (#758) *(@kurrak)*
- Dev container maintenance skill and migration to Debian-slim base image. *(@pkarw)*
- Corepack download prompt disabled in lifecycle scripts. *(@pkarw)*

### 🚀 Preview Environments
- Preview Docker build stage and entrypoint script for automated QA environment deployments. *(@pkarw)*
- QA deployment documentation for Dokploy-based ephemeral environments. (#851) *(@dominikpalatynski)*

### 🧹 Code Quality
- SPEC-051 deduplication — SonarQube-safe phase 1 removing code duplications across modules. (#813) *(@haxiorz)*
- SonarQube fixes first batch — addressing static analysis findings. (#784) *(@haxiorz)*
- Mandatory CI/CD-like verification gate added to code-review skill. (#788) *(@haxiorz)*

### 🗃️ Other Features
- 🐘 Support for custom PostgreSQL schema via `DATABASE_URL` — enables multi-schema deployments. (#753) *(@jtomaszewski)*
- 💬 Universal message object attachments for the messages module. (#756) *(@dominikpalatynski)*
- 🔔 Unified notification and message icons across the platform. (#836) *(@karolkozer)*
- 📊 SPEC-050 catalog unit tests phase 1. (#766) *(@migsilva89)*
- 📜 Messages ACL check reworked for backward compatibility. (#762) *(@pkarw)*
- 🔧 AI Inbox Actions Phase 1 gap fixes. (#760) *(@haxiorz)*
- 🖱️ Added scroll function for improved UX navigation. (#789) *(@michal1986)*

## 🐛 Fixes
- 💰 Variant price no longer decreases by VAT on reopen — fixes pricing recalculation bug. (#786) (#860) *(@knatalicz)*
- 🔄 CrudForm infinite loop — resolved re-render loop in form initialization. (#845) *(@haxiorz)*
- 📄 Hide pagination bar on empty results and fix loading flash. (#806) (#867) *(@rengare)*
- 🧭 Reset stale breadcrumb on client-side navigation. (#847) (#848) *(@knatalicz)*
- 💱 Correct `handleSetBase` API path in currencies module. (#843) (#844) *(@knatalicz)*
- 🤖 AI assistant visibility fix — proper feature flag toggling. (#852) (#855) *(@MrBuldops)*
- 👥 Fix `updatedAt` value in customer people API route. (#812) *(@karolkozer)*
- ✅ Resolve 404 loop and duplicate loading/error state in CustomerTodosTable. (#808) (#850) *(@michal1986)*
- 🔍 Fix search settings visibility. (#746) (#840) *(@MrBuldops)*
- 📂 TenantSelect 400 error, misleading validation response, and missing auto-select. (#857) (#858) *(@knatalicz)*
- 🌙 Fix text not visible in dropdown using dark mode. (#800) *(@haxiorz)*
- 🚪 Fix dead-end screens UX — improved navigation fallbacks. (#801) *(@haxiorz)*
- 🔧 Remove redundant ternary branches in DataTable error display. (#839) *(@rengare)*
- 🪟 Fix create-app Windows ESM import compatibility. (#776) *(@armal)*
- 🧩 Zod v4 `.partial()` on refined product schema. (#750) *(@andrzejewsky)*
- 🔑 Update `requireFeatures` for GET requests in metadata to align with permissions. *(@pkarw)*
- 🐳 Remove preview stage from root Dockerfile. (#865) *(@dominikpalatynski)*
- 🪟 Normalize shell script EOL and set Testcontainers Docker Desktop overrides for Windows. *(@pkarw)*
- 🔒 CodeQL security fixes. *(@pkarw)*

## 📝 Specs & Documentation
- 📋 SPEC-053: B2B PRM Starter & Operations documentation. (#826) *(@matgren)*
- 📋 SPEC-037: WhatsApp external communication + AI chat integration. (#674) *(@MastalerzKamil)*
- 📋 SPEC-046b/046c: Customer detail workstreams alignment. (#771) (#775) *(@matgren, @michal1986)*
- 📋 SPEC-051: Code duplication fixes specification. (#799) *(@haxiorz)*
- 📖 UMES Phase N implementation documentation. (#829) *(@pat-lewczuk)*
- 📖 Updated README and QA deployment guide for ephemeral environments. (#851) *(@dominikpalatynski)*
- 📖 Database migration docs update. (#767) *(@kriss145)*

## 🚀 CI/CD & Infrastructure
- 🐳 Dev Container setup with Docker Compose, lifecycle scripts, and Debian-slim base. (#758)
- 🚀 Preview environment Docker build stage for automated QA deployments.
- 🔒 CodeQL security scanning fixes across the codebase.

## 👥 Contributors

- @pkarw
- @pat-lewczuk
- @haxiorz
- @knatalicz
- @dominikpalatynski
- @michal1986
- @karolkozer
- @jtomaszewski
- @MStaniaszek1998
- @matgren
- @rengare
- @MrBuldops
- @migsilva89
- @andrzejewsky
- @kriss145

### 🌟 First-time Contributors

Welcome and thank you to our new contributors! 🙌

- @armal
- @kurrak
- @rengare
- @knatalicz
- @MrBuldops
- @kjuliaa
- @MastalerzKamil

---

# 0.4.5 (2026-02-26)

## Highlights
This release delivers the **Unified Module Event System (UMES)** — a major architectural upgrade unifying all module events across the platform, the **Messages module**, **Multiple CRM Pipelines** (SPEC-028), **Units of Measure**, **Record Locking** (enterprise), **Inbox Email Parser Phase 1**, the **Progress Tracking module**, **Database Decryption CLI** (SPEC-031), and **header-based auth token refresh** for mobile/API clients. It also ships significant CI/CD improvements, expanded test coverage, and numerous bug fixes. Welcome to **19 first-time contributors**!

## ✨ Features
- 🔄 Unified Module Event System (UMES) — phases A+B+C+D implementing a unified, typed event infrastructure across all modules with consistent emit/subscribe patterns and client broadcast support. (#734) *(@pkarw)*
- 💬 Messages module — full in-app messaging system for internal communication between users. (#569) *(@dominikpalatynski)*
- 🔀 Multiple CRM pipelines (SPEC-028) — support for multiple sales pipelines in CRM with configurable stages, drag-and-drop, and pipeline switching. (#694) *(@MYMaj)*
- 📏 Units of measure — define and manage measurement units for products and inventory tracking. (#636) *(@msoroka)*
- 🔐 Record locking (SPEC-005, enterprise) — pessimistic record locking to prevent concurrent edit conflicts. (#635) *(@pkarw)*
- 📧 Inbox Email Parser Phase 1 — initial email parsing infrastructure for the Inbox Ops module. (#682) *(@haxiorz)*
- ⏳ Progress tracking module — real-time progress tracking for long-running operations with UI feedback. (#645) *(@piotrchabros)*
- 🔓 Database decryption CLI (SPEC-031) — CLI tool for decrypting encrypted database fields for data export and migration. (#610) *(@strzesniewski)*
- 🔑 Header-based token refresh for mobile/API clients — enables auth token refresh via response headers, supporting non-browser clients. (#729) *(@jtomaszewski)*
- 🌍 Translations command pattern with undo — save/delete translation operations now use the command pattern for undo/redo support. (#695) *(@marcinwadon)*
- 🔍 Autocomplete in events selector — improved event selection UX with type-ahead search. (#654) *(@karolkozer)*
- 🐳 Auto-detect Docker socket from active context — CLI now automatically detects the correct Docker socket. (#727) *(@jtomaszewski)*
- 📅 DatePicker/DateTimePicker components (SPEC-034) — new reusable date and datetime picker UI components. (#663) *(@michal1986)*
- 🧹 Removed scaffolding code from CLI — cleaner CLI codebase with updated AGENTS.md. (#726) *(@kurs0n)*
- 🗂️ Module directory scanning refactor — improved module registry with cleaner directory scanning. (#598) *(@redjungle-as)*
- 🎨 Layout refactor with buttons — improved layout consistency and button patterns. (#638) *(@kriss145)*

## 🐛 Fixes
- 🔧 Pre-release fixes for v0.4.5 stability. (#747) *(@pkarw)*
- 🔗 Parse Redis URL before passing to BullMQ — fixes queue connections with `redis://` URLs. (#737) *(@jtomaszewski)*
- 🌙 Fix SEO widget headers invisible in dark mode. (#733) *(@karolkozer)*
- 👤 Fix user update command in auth module. (#732) *(@michal1986)*
- 🔍 Fix vector search ignoring selected organization — search now properly scopes to tenant. (#730) *(@gsobczyk)*
- 🛡️ Fix superadmin null orgId returning 401 — superadmin requests now handled correctly. (#701) *(@Dawidols)*
- 🌐 Replace hardcoded strings with translation keys and add missing translations. (#693) *(@marcinwadon)*
- 🔗 Restore dynamic User Entities sidebar links in auth/UI. (#677) *(@adam-marszowski)*
- 📝 Fix translations CrudForm integration for all entity types. (#656) *(@idziakjakub)*
- 📦 Align module metadata with ModuleInfo type across all packages. (#655) *(@piorot)*
- 🏗️ Rebuild packages after generate in dev:greenfield script. (#652) *(@michalpikosz)*
- 🔄 Prevent CrudForm from resetting fields on initialValues change. (#650) *(@marcinprusinowski)*
- 🛠️ dev:greenfield ephemeral dev mode for working-trees. (#648) *(@pkarw)*
- 📐 Align resource detail header with version history pattern. (#639) *(@sebapaszynski)*
- 🌍 Fix base values not displayed in Translation Manager. (#637) *(@idziakjakub)*
- 🧹 Deduplication and code cleanup refactor. (#628) *(@mkutyba)*
- 📜 Fix SPEC-006 show action and comments in History. (#681) *(@MYMaj)*

## 🧪 Testing
- 🧪 Integration tests for staff module. (#745) *(@Eclip7e)*
- 📈 Improved test code coverage across modules. (#683) *(@janzaremski)*
- 🧪 SPEC-030 catalog unit tests. (#632) *(@migsilva89)*
- 🔄 Add standalone app integration tests to snapshot CI. (#714) *(@andrzejewsky)*

## 📝 Specs & Documentation
- 📋 UMES specification — initial Unified Module Event System spec. (#710) *(@pkarw)*
- 📋 SPEC-029: User Invite via Email. (#689) *(@matgren)*
- 📋 SPEC-037: Promotions module. (#680) *(@B0G3)*
- 📋 SPEC-034: Document Parser Module. (#665) *(@fto-aubergine)*
- 📋 SPEC-006 v2: Version History update. (#646) *(@MYMaj)*
- 📖 Improve standalone-app guide and add cross-links from overview and setup pages. (#705) *(@abankowski)*
- 📖 Surface `create-mercato-app` in docs and homepage. (#713) *(@andrzejewsky)*
- 📖 Fix deprecated module creation guide. (#643) *(@abankowski)*
- 📖 Lessons learned and AGENTS.md update for the UI package. (#649) *(@pkarw)*
- 📖 Update enterprise description in README. (#692) *(@pat-lewczuk)*
- 🤖 AI skills: add Socratic questions skills. (#715) *(@michal1986)*

## 🚀 CI/CD & Infrastructure
- 📣 GitHub Actions annotations for test and lint errors. (#718) *(@jtomaszewski)*
- 🔄 Unify snapshot and canary release into a single workflow. (#711) *(@andrzejewsky)*
- 🔧 Fix standalone app: sync i18n templates and add scheduler to publish. (#709) *(@andrzejewsky)*
- 🔧 Add dedicated develop-branch release workflow. (#707) *(@andrzejewsky)*

## 👥 Contributors

- @pkarw
- @jtomaszewski
- @andrzejewsky
- @MYMaj
- @karolkozer
- @michal1986
- @marcinwadon
- @idziakjakub
- @haxiorz
- @abankowski
- @pat-lewczuk
- @matgren
- @sebapaszynski

### 🌟 First-time Contributors

Welcome and thank you to our new contributors! 🙌

- @dominikpalatynski
- @msoroka
- @piotrchabros
- @Eclip7e
- @gsobczyk
- @Dawidols
- @adam-marszowski
- @piorot
- @michalpikosz
- @marcinprusinowski
- @mkutyba
- @janzaremski
- @migsilva89
- @B0G3
- @kurs0n
- @jtomaszewski
- @marcinwadon
- @michal1986
- @abankowski

---

# 0.4.4 (2026-02-20)

## Highlights
This release delivers **System-Wide Entity Translations** (SPEC-026) — a complete localization infrastructure for all entity types, the **Enterprise package scaffold**, **Sales Dashboard Widgets**, expanded **OpenAPI coverage** across feature toggles, workflows, attachments, and configs, a new **Integration Test framework** with CRM, Sales, Catalog, Admin ... test coverage (57% overall coverage), and the **UI Confirm dialog migration**. It also ships the **i18n sync checker**, rate limiting on auth endpoints, and numerous bug fixes. This is our biggest community release yet — welcome to **10 first-time contributors**! 🎉

## ✨ Features
- 🌍 System-wide entity translations (SPEC-026) — full localization infrastructure including `entity_translations` table, REST API (`GET/PUT/DELETE /api/translations`), locale management, `TranslationManager` React component with standalone and embedded modes, and translation overlay pipeline. (#552, #566, #585) *(@idziakjakub)*
- 🏗️ Enterprise package scaffold — initial structure for the `@open-mercato/enterprise` package for commercial/enterprise-only modules and overlays. (#580) *(@pkarw)*
- 📊 Sales dashboard widgets — new orders and quotes dashboard widgets with date range filtering, payload caching, and time formatting. (#582) *(@MYMaj)*
- 🔀 OpenAPI response specifications — added missing API response specs across feature toggles, workflows, workflow instances, attachments, library, and configs endpoints. (#581) *(@karolkozer)*
- 🔲 UI confirm dialog migration — unified confirmation dialog pattern (`Cmd/Ctrl+Enter` submit, `Escape` cancel) rolled out across the UI. (#550, #554, #555) *(@AK-300codes)*
- 🧪 Integration test framework — Playwright-based CRM integration tests with API fixtures, self-contained setup/teardown, and CI pipeline support. (#558, #562, #568) *(@pkarw)*
- 🌐 i18n sync checker — usage scanner that detects missing, unused, and out-of-sync translation keys across all locales. (#593) *(@cielecki)*
- 📅 `formatDateTime` and `formatRelativeTime` — extracted to shared `lib/time.ts` with full test coverage. (#586, #589) *(@MYMaj)*
- 🔗 Exposed `TruncatedCell` component for reuse across data table modules. (#560) *(@matgren)*
- 👥 Resource and staff detail form heading alignment — consistent heading layout matching the deals pattern. (#578, #591) *(@sebapaszynski)*
- 🔒 Rate limiting on authentication endpoints — configurable rate limits to protect login, registration, and password reset flows. (#521) *(@sapcik)*

## 🐛 Fixes
- Fixed scheduler issues on local queue strategy (#543). (#575) *(@LukBro)*
- Resolved broken links in notification emails. (#553) *(@LukBro)*
- Fixed MikroORM config to support `sslmode=require` for cloud-hosted PostgreSQL. (#604) *(@maciejsimm)*
- Fixed Docker Compose dev build issues. (#595) *(@MStaniaszek1998)*
- Fixed specs sorting order. (#614) *(@pkarw)*

## 📝 Specs & Documentation
- SPEC-028: Multiple sales pipelines for CRM. (#571) *(@itrixjarek)*
- SPEC-029: Inbox Ops Agent. (#579) *(@haxiorz)*
- SPEC-029: E-commerce/storefront architecture. (#587) *(@kapIsWizard)*
- SPEC-032: Notification template system. (#608) *(@kriss145)*
- SPEC-033: Omnibus Directive price tracking. (#600) *(@strzesniewski)*
- SPEC-031: Database decryption CLI. (#599) *(@strzesniewski)*
- SPEC-ENT-002: SSO & directory sync (enterprise). (#603) *(@MStaniaszek1998)*
- DevCloud infrastructure specification. (#621) *(@MStaniaszek1998)*
- CRM pipeline QA test scenarios (TC-CRM-001..007). (#577) *(@itrixjarek)*
- PostgreSQL port-conflict troubleshooting guide. (#594) *(@kriss145)*

## 📦 Dependencies
- Bump `tar` from 7.5.6 to 7.5.7 — security patch. (#551)

## 👥 Contributors

- @pkarw
- @idziakjakub
- @LukBro
- @MYMaj
- @itrixjarek
- @matgren
- @sebapaszynski
- @haxiorz
- @AK-300codes
- @cielecki
- @MStaniaszek1998
- @strzesniewski
- @kriss145
- @kapIsWizard
- @maciejsimm
- @sapcik
- @karolkozer
- @pat-lewczuk

### 🌟 First-time Contributors

Welcome and thank you to our new contributors! 🙌

- @idziakjakub
- @LukBro
- @MYMaj
- @itrixjarek
- @sebapaszynski
- @cielecki
- @strzesniewski
- @kriss145
- @kapIsWizard
- @maciejsimm

# 0.4.3 (2026-02-13)

## Highlights
This release introduces **`mercato eject`** for deep module customization without forking, a **Version History** system with undo/redo and related-record tracking, **Docker dev mode with hot reload**, **sidebar reorganization**, significant **mobile UX improvements**, and a new **`create-mercato-app`** standalone app workflow. It also ships Windows compatibility fixes, search indexing safeguards, and expanded i18n coverage.

## Features
- Added `mercato eject` CLI command — copy any ejectable core module into your local `src/modules/` for full customization. Nine modules are ejectable at launch: catalog, currencies, customers, perspectives, planner, resources, sales, staff, and workflows. (#514) *(@andrzejewsky)*
- Standalone app development improvements — better `create-mercato-app` scaffolding, module resolver, and generator support for apps outside the monorepo. (#472) *(@andrzejewsky)*
- Documentation for standalone app creation with `create-mercato-app`, module ejection guide, and README updates. (#547) *(@pkarw)*
- Version history system — track entity changes over time with full audit trail. (#479) *(@pkarw)*
- Version history extension — support for related records in version history tracking. (#508, #509) *(@pkarw)*
- `withAtomicFlush` — SPEC-018 extensions for atomic unit-of-work flushing, ensuring consistent data persistence. (#507) *(@pkarw)*
- Compound commands refactor and optimization — improved undo/redo command batching and performance. (#510) *(@pkarw)*
- Docker Compose dev mode with containerized app and hot reload — run the full stack in Docker with source-mounted volumes for automatic rebuilds. Recommended setup for Windows. (#466) *(@Sawarz)*
- Sidebar reorganization — restructured admin navigation for improved discoverability and grouping. (#467) *(@haxiorz)*
- Mobile UI improvements — better responsive layouts and touch interactions across the admin panel. (#518) *(@haxiorz)*
- Form headers and footers reorganization for a cleaner, more consistent CRUD form layout. (#477) *(@pkarw)*
- Prevent auto-reindex feedback loops in search indexing to avoid infinite reindex cycles. (#520) *(@simonkak)*
- Windows build and runtime compatibility spike — fixes for path handling, shell scripts, and platform-specific behaviors. (#516) *(@freakone)*

## Fixes
- Fixed mobile scroll issues reported in #451. (#465) *(@Sawarz)*
- Fixed wrong migration in workflows module (#409). (#474) *(@pat-lewczuk)*
- Fixed `extractUndoPayload` deduplication in the command system. (#480) *(@pkarw)*
- Fixed missing translations in workflows module for pl, es, and de locales. (#489) *(@pat-lewczuk)*
- Added missing translations in business rules module for pl, es, and de locales. (#490) *(@pat-lewczuk)*
- Fixed event emission issues in the events module. (#493) *(@simonkak)*
- Fixed unit of work changes tracking for reliable entity persistence. (#497) *(@pkarw)*
- Fixed search OpenAPI specs — added missing descriptions in OpenAPI params. (#504) *(@simonkak)*
- Fixed CMD+K shortcut opening both Search and AI Assistant dialogs simultaneously. (#506) *(@sapcik)*
- Fixed dark mode rendering in the visual workflow editor. (#534) *(@pat-lewczuk)*
- Fixed missing translations across multiple modules (issue #536). (#538) *(@karolkozer)*
- Added missing pl, de, and es translations in customer detail views (#540). (#541) *(@karolkozer)*
- Added environment variable overrides for superadmin credentials during init. (#459) *(@MStaniaszek1998)*
- Added storage volume configuration for image uploads. (#462) *(@MStaniaszek1998)*
- Improved DataTable pagination layout on mobile. (#503) *(@sapcik)*

## Specs & Documentation
- Two-factor authentication (2FA) specification. (#500) *(@pkarw)*
- Unit of work system solution specification (SPEC-018). (#499) *(@pkarw)*
- POS module specification. (#528) *(@matgren)*
- UI confirmation migration specification. (#530) *(@pat-lewczuk)*
- Financial module specification. (#531) *(@pat-lewczuk)*
- Catalog content localization specification (SPEC-023). (#537) *(@AK-300codes)*
- AI-assisted form suggestion specification. (#542) *(@pat-lewczuk)*
- README installation update. (#515) *(@michaelkrasuski)*

## Agent & Tooling
- Restructured AGENTS.md files with task router, detailed per-module guides, and best practices for Claude agents. (#469, #492, #519) *(@pkarw, @pat-lewczuk)*
- Added spec-writing skill for standardized specification authoring. (#525) *(@matgren)*
- Added code review skill for AI-assisted pull request reviews. (#526) *(@pat-lewczuk)*

## Dependencies
- Bump `npm_and_yarn` group across 1 directory with 2 updates. (#476)
- Bump `@modelcontextprotocol/sdk` from 1.25.3 to 1.26.0. (#487)

# 0.4.2 (2026-01-29)

## Highlights
This release introduces the **Notifications module**, **Agent Skills infrastructure**, **Dashboard Analytics Widgets**, and a major architectural improvement decoupling module setup with a centralized config. It also includes important security fixes, Docker infrastructure improvements, and dependency updates.

## Features
- Full implementation of the in-app notifications system, including notification types, subscribers, custom renderers, and user preferences. (#422, #457) *(@pkarw)*
- Created the foundational structure for agent skills in Open Mercato, enabling extensible AI-powered capabilities. (#455) *(@pat-lewczuk)*
- New analytics widgets for the dashboard, providing richer data visualization and insights. (#408) *(@haxiorz)*
- Decoupled module setup using a centralized `ModuleSetupConfig`, improving modularity and reducing coupling between modules. Resolves #410. (#446) *(@redjungle-as)*
- Reorganized architecture specs and added new specifications for SDD, messages, notifications, progress tracking, and record locking. (#436, #416) *(@pkarw)*
- Addressed CodeQL-identified security issues across the codebase. (#418) *(@pkarw)*

## Fixes
- Fixed an open redirect vulnerability in the authentication session refresh flow. (#429) *(@bartek-filipiuk)*
- Resolved issues in the AI assistant module. (#442) *(@fto-aubergine)*
- Corrected the dialog title for global search and added specs for new widgets. (#440) *(@pkarw)*
- Resolved Docker Compose service conflicts where services were overlapping. (#448, #449) *(@MStaniaszek1998)*
- General Docker Compose configuration fixes. (#423, #424) *(@pkarw)*
- Switched the OpenCode container base image to Debian for better compatibility. (#443) *(@MStaniaszek1998)*

## Infrastructure & DevOps
- Updated the default service port configuration. (#434) *(@MStaniaszek1998)*
- Added a dedicated Dockerfile for building and serving the documentation site. (#425) *(@MStaniaszek1998)*

## Dependencies
- Bump `tar` from 7.5.6 to 7.5.7 — security patch. (#454)
- Bump `npm_and_yarn` group across 2 directories. (#447)

# 0.3.3 (2025-11-16)

## Improvements
- Catalog UI pages - create products page, product price kind settings
- Shifted catalog product attributes onto custom-field fieldsets so vertical-specific definitions travel through CRUD forms, filters, and APIs without bespoke schema code.
- Product edit view now lists variant prices with inline edit/delete controls for quicker maintenance.
- Fixed product edit validation crashes and restricted variant actions to the proper ACL feature to avoid forced re-auth on delete.
- Added variant auto-generation and lighter edit page cards, and fixed the edit link routing for catalog variants.
- Channel offer form now surfaces a validation error if a price override is missing its price kind selection.
- `mercato init` seeds default USD regular and sale price kinds configured as tax-inclusive overrides.

# 0.3.0 (2025-10-31)

## Highlights
- Consolidated modular architecture across auth, customers, sales, dictionaries, query index, and vector search modules.
- Delivered multi-tenant RBAC, CLI scaffolding, and extensibility primitives for module discovery and entity customization.
- Added query index and vector pipelines with coverage monitoring, incremental re-indexing, and pgvector driver support.
- Hardened CRM workflows (tasks, todos, deals, dictionaries, custom data) and sales configuration (catalog, pricing, tax, shipping).
- Stabilized CRUD factories, undo/redo command bus, and background subscribers for predictable data sync.

## Improvements
- Standardized API endpoints, backend pages, and CLI entries for each module.
- Expanded documentation for the framework API, query index, and module guides.
- Introduced profiling flags, coverage metrics, and engine optimizations for faster indexing.
- Enhanced validation, custom field handling, and locale support across UI surfaces.

## Fixes
- Resolved dictionary filtering, customer coverage, ACL feature flags, and access log retention issues.
- Addressed form validation, undo/redo edge cases, and task linkage bugs across CRM pages.
- Improved type safety in API routes, CLI commands, and MikroORM entities.

## Tooling
- Added OpenAPI generator updates and shared registry cleanup.
- Hardened migrations for dictionaries, sales, and query index modules.
- Synchronized vector service CLI, background subscribers, and reindex tooling.

## Previous Releases
Releases prior to 0.3.0 are archived. Refer to git history for full details.
