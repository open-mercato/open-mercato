
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
- ✨ Catalog: add first-class services management with media, work requirements, and Sales service lines.
- ✨ CLI: one-command Railway deployment. (#2683) *(@WXYZx)*
- ✨ CRM: deals list redesign. (#2903) *(@haxiorz)*
- ✨ Manual Dokploy Dev compose deployment workflow. (#2865) *(@MStaniaszek1998)*
- ✨ Add the `om-help` workflow navigator skill. (#2140) *(@adeptofvoltron)*
- ✨ Branding: add an organization sidebar logo. (#2822) *(@pmadajthey)*
- ✨ Bootstrap: fail-loud production guard for single-instance strategies (#2987). (#3030) *(@adeptofvoltron)*

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
