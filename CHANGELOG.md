
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
- 🛠️ Tiered agent skills install: `yarn install-skills` now installs the 13-skill `core` tier by default; opt into more via `--with`, `--tiers`, or `--all`. New `--list` and `--clean` flags. (Refs #1744)

## 📝 Specs & Documentation
- 📝 Add local development walkthrough (#1435). (#1611) *(@pkarw)*
- 📝 Add Hall of Fame for Agentic Hackathon winners. (#1646) *(@pat-lewczuk)*
- 📝 Reassign authors on review and fix handoffs. (#1644) *(@pkarw)*
- 📝 Make vector auto-indexing opt-in by default. (#1679) *(@pkarw)*
- 📝 Add CRM call transcriptions + Zoom + tl;dv adapter specs. (#1645) *(@matgren)*
- 📝 Push notifications and devices modules. (#1746) *(@jtomaszewski)*
- 📝 Telemetry package with pluggable OTEL backend. (#1747) *(@jtomaszewski)*
- 📝 Document the tiered skills install scheme in `.ai/skills/README.md` and add the `2026-05-05-tiered-skills-install` spec. (Refs #1744)

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
