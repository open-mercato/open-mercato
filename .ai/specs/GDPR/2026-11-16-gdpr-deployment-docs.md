# GDPR deployment documentation

> **Tracker:** open-mercato/open-mercato#8593
> **Program:** [program](2026-11-15-gdpr-ready-deployments-program.md)
> **Edition:** OSS (the pages also describe Enterprise steps and label them)
> **GDPR basis:** Art. 5(1)(e), 12–22, 25, 28, 30, 32–35, 44–46; ePrivacy Directive Art. 5(3) and 13

## TLDR

- Ten pages under `apps/docs/docs/deployment/gdpr/` tell an operator what a deployment sends where, how to configure it safely, and how to handle requests, retention, restores, breaches, records of processing, impact assessments and tenant exit.
- Every step that needs the Enterprise `privacy` module ([Enterprise spec](../enterprise/GDPR/2026-11-16-privacy-dsr-engine.md)) is labelled **Enterprise**. The **OSS** path is a manual procedure, which Art. 12 allows.
- One docs test fails when a workspace package is neither in the sub-processor table nor on a no-outbound list.
- A short pointer in `packages/create-app/README.md`. No application code.

## Overview

The pages serve four readers: whoever picks vendors, whoever configures production, whoever answers a request, and whoever handles an incident. Rules for every page:
- Open with one line: the page describes the product and is not legal advice. The controller decides.
- Describe only what ships in the release the page goes out with. A step for an unshipped feature is marked "not yet available", with the manual step beside it.
- Cite official sources inline, using only the links in this spec. Cite code claims by file path.
- Label each procedure step **OSS** or **Enterprise**.

## Problem Statement

- `apps/docs/docs/user-guide/encryption.mdx` is the only page that mentions GDPR. No page lists the third parties a deployment calls, which settings matter, or what to do with a request or a breach.
- Some flows are on by default and are coupled:
  - Setting `OPENAI_API_KEY` turns on assistant chat, attachment OCR and embedding auto-indexing. OCR defaults to on (`attachments/lib/ocrConfig.ts:8-12`).
  - OCR calls OpenAI even when `OM_AI_PROVIDER` names another provider (`attachments/lib/ocrService.ts:88-96`).
  - The deals map and the EUDR plot map load OpenStreetMap tiles from the viewer's browser.
- Several procedures the law expects have no home: restriction, objection, Art. 19 notices, re-applying erasures after a restore, the breach register, the Art. 30 records and tenant exit. This spec now owns all of them.

## Proposed Solution

Ten `.mdx` pages, in a "GDPR" category under "Deployment". Required content per page:

### 1. `index` — GDPR and Open Mercato
- **Roles** ([EDPB 07/2020](https://www.edpb.europa.eu/documents/guideline/guidelines-072020-on-the-concepts-of-controller-and-processor-in-the-gdpr_en); [EDPB 4/2019](https://www.edpb.europa.eu/documents/guideline/guidelines-42019-on-article-25-data-protection-by-design-and-by-default_en) §94):
  - The Open Mercato project is neither controller nor processor of deployment data unless it actually touches that data (hosting, support access). There is no telemetry by default (`TELEMETRY_BACKEND` unset means no-op).
  - A self-hoster is the controller. A SaaS operator is a processor for each tenant (Art. 28) and controller of its own account data. A tenant is the controller of its CRM, portal, forms and sales data.
- **What the product provides:**
  - tenant and organization isolation, roles, field encryption, action and access logs;
  - edit and delete screens, list exports, switchable providers;
  - tenant-owned `/privacy` and `/terms` (`.ai/specs/2026-08-18-tenant-legal-documents-and-consent-versioning.md`);
  - Enterprise adds subject export, erasure, tenant-set retention and tenant purge.
- **What stays with the controller:** the privacy notice, lawful basis, retention periods, provider contracts (DPAs), records of processing, DPIAs, request handling, breach notification and backups.
- **Known limits:**
  - No per-record technical restriction; Art. 18 is a procedure.
  - No automatic Art. 19 notification of recipients.
  - A restore brings erased data back until the erasures are re-applied.
  - Log, queue and other operational copies expire only by their retention windows.
  - The OSS edition has no request-running tooling. Requests are handled manually or with Enterprise.
  - Free-text mentions of a person in other people's records are not found automatically. Neither are copies held by external providers.
- **Cookie inventory.** All cookies are first-party, and strictly necessary or a preference the user set. No consent banner is needed ([ePrivacy Art. 5(3)](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:02002L0058-20091219), [WP194](https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2012/wp194_en.pdf)). List purpose and lifetime for each:
  - Sessions: `auth_token` and `session_token` (staff), `customer_auth_token` and `customer_session_token` (portal). All HttpOnly, SameSite=Lax, Secure in production (`auth/api/login.ts:263-270`).
  - `sso_state` (Enterprise), the mailbox OAuth state cookie, `om_selected_tenant`, `om_selected_org`, `om_login_tenant`, `locale` (1 year).
  - UI preferences (`om_sidebar_collapsed`, table and markdown preferences), checkout-link password access, and notice dismissals (`om_cookie_notice_ack`, `om_demo_notice_ack`, `start_page_dismissed`; demo-only `om_feedback_*`). `localStorage` holds UI flags and drafts only.
  - Adding analytics, pixels or third-party embeds needs prior consent under Art. 5(3) ([EDPB 2/2023](https://www.edpb.europa.eu/documents/guideline/guidelines-22023-on-technical-scope-of-art-53-of-eprivacy-directive_en)), and the deployer adds the consent mechanism.
- **Third-party calls from the browser.**
  - The UI uses system fonts and loads no CDN scripts or avatars.
  - Exceptions: map tiles (the viewer's IP goes to the tile host; [C-582/14 Breyer](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62014CJ0582)) and Stripe.js on payment pages.
  - Point tiles at a self-hosted or contracted server ([CNIL sheet 09](https://www.cnil.fr/en/sheet-ndeg09-control-your-libraries-and-sdks)).

### 2. `sub-processors`
- One row per outbound flow. Columns:
  - package or module, and the data sent;
  - trigger and default, and how to disable or replace it;
  - region: a vendor document with its checked date, or "controller to verify";
  - transfer note: [EU-US DPF](https://eur-lex.europa.eu/eli/dec_impl/2023/1795/oj) if the vendor is certified, else [SCCs](https://eur-lex.europa.eu/eli/dec_impl/2021/914/oj) plus an assessment ([EDPB Rec 01/2020](https://www.edpb.europa.eu/documents/recommendation/recommendations-012020-on-measures-that-supplement-transfer-tools-to_en)). See the [adequacy list](https://commission.europa.eu/law/law-topic/data-protection/international-dimension-data-protection/adequacy-decisions_en). Targets the operator runs are marked "operator-hosted".
- The page opens by saying that one `OPENAI_API_KEY` turns on chat, OCR and embeddings.
- Rows, verified against code (each row cites its file on the page):

| Package / module | Data sent | Trigger / default | Disable or replace |
|---|---|---|---|
| `core` communication_channels: system email via `SYSTEM_EMAIL_PROVIDER` (default `resend`) | recipient, sender, subject, body, attachments | every system email (`system-email-provider-config.ts:7,17`) | `ses` or `smtp`; `OM_DISABLE_EMAIL_DELIVERY` |
| `channel-resend` / `channel-ses` / `channel-smtp` | same | `RESEND_API_KEY` / `AWS_SES_REGION` / `SMTP_HOST` (operator-hosted) | another transport |
| `core` inbox_ops: Resend SDK directly, ignoring `SYSTEM_EMAIL_PROVIDER` | inbound mail; reply recipient and body | inbound webhook, reply send; needs `RESEND_API_KEY` | unset the key; `OM_DISABLE_EMAIL_DELIVERY` |
| `core` inbox_ops extraction | full email text | every inbound email; `OM_AI_PROVIDER`, else the first provider with a key | unset keys; local model |
| `ai-assistant` chat and typed agents (customers, catalog, eudr, staff, warranty_claims, workflows, Discord replies) | prompt, page context, tool output with record data, attachments | on use; default `openai` / `gpt-5-mini` once `OPENAI_API_KEY` is set | `OM_AI_PROVIDER`, `OM_AI_MODEL`, `OPENAI_BASE_URL`; Ollama, LM Studio, LiteLLM; tenant base URLs only within `AI_RUNTIME_BASEURL_ALLOWLIST` |
| `ai-assistant` input moderation | latest user message, to OpenAI `/moderations` | off (`OM_AI_INPUT_MODERATION=false`) | leave off |
| `core` attachments OCR (direct OpenAI client) | image and PDF page content | image/PDF uploads whenever `OPENAI_API_KEY` is set; `OCR_MODEL` default `gpt-4o` | `OM_DEFAULT_ATTACHMENT_OCR_ENABLED=false`; per partition `requiresOcr=false` |
| `search` embeddings | indexed record text, search queries | auto-indexing on once the provider key exists; default OpenAI `text-embedding-3-small` | `OM_DISABLE_VECTOR_SEARCH_AUTOINDEXING=true`, tenant toggle, Ollama |
| `search` Meilisearch | indexed fields, including decrypted values by default | `MEILISEARCH_HOST`; self-hosted in Compose | `SEARCH_EXCLUDE_ENCRYPTED_FIELDS=true`; a hosted Meilisearch is a processor |
| `core` customers deals map, eudr plot map | from the browser: viewer IP, user agent, viewed area, to `tile.openstreetmap.org` | page view | `NEXT_PUBLIC_OM_DEALS_MAP_TILE_URL` (build time), recommended |
| `core` forms captcha | token; respondent IP only for Turnstile | off; needs `FORMS_CAPTCHA_PROVIDER`, `FORMS_CAPTCHA_SECRET` and the form setting | leave off |
| `core` currencies | none (exchange rates from NBP, Raiffeisen) | admin action | — |
| `telemetry` | spans, metrics, logs; emails, tokens and query strings redacted | off; `TELEMETRY_BACKEND` | leave unset |
| `cli` New Relic APM agent | APM transaction data (controller to verify scope) | only with `NEW_RELIC_LICENSE_KEY` | leave unset |
| `gateway-stripe` | server: amount, description, ids; browser: card data and payer IP via Stripe.js | configured integration | another gateway |
| `gateway-tpay` / `gateway-autopay` | payer email and name / customer email; amount, description | configured integration | another gateway |
| `carrier-inpost` | sender and receiver name, company, email, phone, address | shipment creation | — |
| `channel-apns` / `channel-fcm` / `channel-expo` | device token, title, body, data | configured channel | — |
| `channel-discord` / `channel-gmail` / `channel-imap` | message content and user ids / mailbox read and send / operator-hosted mailbox | configured channel | — |
| `tillio` | pulls call records: numbers, status, durations, recording references | configured; the operator's Tillio instance and its telephony provider | — |
| `storage-s3` | attachment files | configured; `S3_REGION`, `S3_ENDPOINT` | local storage |
| `sync-akeneo` | OAuth credentials only; imports product data | configured | — |
| `webhooks` | event payloads to operator-set URLs, kept in `webhook_deliveries` | per subscription | — |
| `enterprise` sso / agent_orchestrator | OIDC token exchange (SCIM is inbound) / model calls with run context, model-native web search, optional OTLP trace export | configured | — |
| `web-research-*` | search query text (Exa, Firecrawl, Tavily, DuckDuckGo, SearXNG, browser fetch, model web search) | opt-in `OM_WEB_SEARCH_ADAPTERS`; used by Enterprise agents | leave unset |
| `create-app` / `cli` / `starter` | developer IP only (npm, GitHub, Railway, nodejs.org) | development time only | — |

- **No outbound flow, each listed with its reason:** `cache`, `events`, `queue`, `scheduler` (local Redis or Postgres); `checkout` (pays through the gateway packages); `content`, `documents`, `onboarding` (demo feedback goes to the operator's own `ADMIN_EMAIL`); `shared`, `ui`, `eslint-plugin-ds`, `apps/mercato`, `apps/docs`.
- The official-modules submodule is outside the check.

### 3. `hardening`
Sources: [GDPR Art. 25, 32](https://eur-lex.europa.eu/eli/reg/2016/679/oj), [EDPB 4/2019](https://www.edpb.europa.eu/documents/guideline/guidelines-42019-on-article-25-data-protection-by-design-and-by-default_en), [ENISA handbook](https://www.enisa.europa.eu/publications/handbook-on-security-of-personal-data-processing), [CNIL passwords](https://www.cnil.fr/fr/mots-de-passe-recommandations-pour-maitriser-sa-securite), [CNIL logging](https://www.cnil.fr/fr/la-cnil-publie-une-recommandation-relative-aux-mesures-de-journalisation).
- **Unique secrets per deployment:** `AUTH_SECRET`/`JWT_SECRET`, `TENANT_DATA_ENCRYPTION_KEY` (or KMS/Vault), `FORMS_ENCRYPTION_MASTER_KEY`, `MEILISEARCH_API_KEY`, the database password. Production refuses a published tenant or forms key; a weak or unset key only warns. Exit runbook: [key guard](2026-11-16-runtime-encryption-key-guard.md).
- **Encryption on:** `TENANT_DATA_ENCRYPTION=yes` (link `user-guide/encryption.mdx`).
- **Search:** set `SEARCH_EXCLUDE_ENCRYPTED_FIELDS=true`, then run `mercato search reindex`. The default `false` indexes decrypted values (`search/src/di.ts:63`).
- **Demo mode off:** `DEMO_MODE=false`. Anything other than literal `false` keeps demo accounts and the feedback widget on (`auth/lib/setup-app.ts:575-578`).
- **TLS and HSTS** at the reverse proxy (link `deployment/production-readiness.mdx`).
- **Workers and scheduler running.** Without them no pruner runs ([retention spec](2026-11-16-operational-retention-pruners.md)).
- **MFA for admin accounts:** recommended by ENISA and CNIL, not named in the GDPR. Options: Enterprise `security`, an IdP via Enterprise `sso`, or an identity-aware proxy in OSS.
- **Least privilege.** Use roles and organization visibility; nothing is public by default (Art. 25(2)).
- **Turn off unused flows** (`sub-processors`). Keep application-log retention bounded at the log platform; CNIL suggests 6–12 months.
- **Backups** encrypted and time-bounded (`backups-and-restore`).

### 4. `data-subject-requests`
Sources: [GDPR Art. 12, 15–21](https://eur-lex.europa.eu/eli/reg/2016/679/oj), [EDPB 01/2022](https://www.edpb.europa.eu/documents/guideline/guidelines-012022-on-data-subject-rights-right-of-access_en), [CNIL sheet 13](https://www.cnil.fr/en/sheet-ndeg13-prepare-exercise-peoples-rights), [WP242](https://ec.europa.eu/newsroom/article29/items/611233), [C-487/21](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62021CJ0487), [WP216](https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2014/wp216_en.pdf).
- **Intake.** Any channel counts, email included. A self-service portal is not required (EDPB 01/2022 §136; CNIL sheet 13). Portal users ask the tenant, and staff run the request. Free of charge (Art. 12(5)).
- **Identity.** Ask for more information only on reasonable doubt (Art. 12(6)). Prefer a reply from the account's known email address.
- **Deadline.** One month. It may be extended by two months if the person is told within the first month, with reasons (Art. 12(3)).
- **Find the person.** OSS: search plus the per-module table on `records-of-processing`. Enterprise: an export run with `--subject kind:id`, `--email` or `--phone`, which also lists related subjects to run separately.
- **Access and portability.**
  - **OSS:** list exports filtered to the person (CSV/JSON/XML/Markdown, `exportScope=full`), record pages and attachment downloads.
  - **Enterprise:** `mercato privacy export … --out <dir>` or `/backend/privacy` produces `subject.json` plus files.
  - Art. 20 covers only data the person provided, under consent or contract (WP242). The copy must be faithful and intelligible (C-487/21).
  - **Cover letter.** Include the Art. 15(1)(a)–(h) and 15(2) information: purposes, categories, recipients, retention, rights, complaint, source, automated decisions, transfer safeguards. Take it from the records of processing and the privacy notice. Enterprise pre-fills categories and set retention.
  - Mention data still held in backups (EDPB 01/2022 §110).
- **Rectification.**
  - Use the edit screens; a staff user's email is editable.
  - Staff cannot change a portal sign-in email today. Deactivate the old account, invite the person at the corrected address, then delete the old account.
  - Then do the Art. 19 step.
- **Erasure.**
  - Choose delete or anonymize. Anonymization must be irreversible; masking or hashing is not erasure (WP216).
  - **Enterprise:**
    1. Run `mercato privacy erase …` as a dry run and review the report.
    2. Rerun with `--apply --out report.json`. The report is the register entry.
    3. Read `retained` for what Art. 17(3) keeps: `legal_retention`, `open_case` (retry later) or `other_party`. Read `notCovered` for tables the run did not touch.
  - **OSS:** delete module by module, following the per-module table.
  - **Both editions:**
    - Search free text (notes, comments, message bodies, documents) for the person's name and address, and edit it by hand.
    - Tell the person that operational copies expire by their windows.
    - If the data must be kept for a legal claim, do not erase; record why.
- **Restriction (Art. 18), Recital 67 procedure.** Pick one option:
  - **(A) Move out.** Export a copy to an access-controlled store, then erase it from the live system (Enterprise run or OSS manual delete). If the restriction is lifted, re-enter or re-import from the copy; ids and links are not restored.
  - **(B) Mark and narrow:**
    1. Mark the person visibly: a `restricted` tag plus a note with the date and the ground.
    2. Narrow access through roles, feature grants and organization visibility (`organizations_json` on role and user ACLs). This works per organization, not per record.
    3. Pause automations: cancel running workflow instances, stop outreach, and stop syncs that carry the person.
  - **Either way:** allow only storage and the Art. 18(2) exceptions, and tell the person before lifting the restriction (Art. 18(3)).
- **Objection (Art. 21).**
  - **Marketing objection is absolute.** Set the person-level do-not-contact flag once it ships (`.ai/specs/2026-10-22-crm-contact-permissions-and-consent-history.md`) and honour it immediately. Until then, tag the person and suppress them by hand in every sending tool.
  - **General objection:** assess compelling grounds, and restrict meanwhile (Art. 18(1)(d)).
- **Art. 19 recipients.**
  - Find them in the `sub-processors` rows in use, plus `integration_logs`, `webhook_deliveries` and provider dashboards.
  - Notify each one unless that is impossible or disproportionate, and record that assessment.
  - Name the recipients to the person if asked.
- **DSR log.** Per request: received, identity check, deadline, actions, outcome, answered, Art. 19 notices. Keep identifiers only. Enterprise: each run writes an action-log entry, shown in the page's request log. OSS: a register the controller keeps.

### 5. `retention`
Sources: [GDPR Art. 5(1)(e), Recital 39](https://eur-lex.europa.eu/eli/reg/2016/679/oj), [CNIL sheet 14](https://www.cnil.fr/en/sheet-ndeg14-define-data-retention-period), [CNIL retention periods](https://www.cnil.fr/fr/passer-laction/les-durees-de-conservation-des-donnees), [VAT Directive](https://eur-lex.europa.eu/eli/dir/2006/112/oj) Art. 247.
- **Window table** (table, default, setting, edition).
  - From the [retention spec](2026-11-16-operational-retention-pruners.md): every `OM_<MODULE>_<TABLE>_RETENTION_DAYS`, `QUEUE_FAILED_JOB_RETENTION_HOURS` (168 h) and per-form submission retention.
  - Existing windows:
    - access logs: 7 d core, 8 h other (`AUDIT_LOGS_CORE_RETENTION_DAYS`, `AUDIT_LOGS_NON_CORE_RETENTION_HOURS`; `accessLogService.ts:45-46`);
    - AI agent runs: 30 d (`AI_AGENT_RUNS_RETENTION_DAYS`);
    - AI token usage: 90 d (`AI_TOKEN_USAGE_EVENTS_RETENTION_DAYS`);
    - payment session initializations: 24 h;
    - cart idempotency keys: 90 d;
    - Enterprise agent-orchestrator trace content: tenant policy, default 30 d;
    - Enterprise sign-in log: 90 d once shipped (`.ai/specs/enterprise/2026-11-13-sign-in-activity.md`);
    - action log: kept until an Enterprise retention setting bounds it.
- **Business records.** The controller chooses. Enterprise: per-class settings on `/backend/privacy`; unset means keep. OSS: manual deletion through the periodic review.
- **Periodic review of inactive people** (Recital 39). Each period:
  1. Staff users by `last_login_at`: deactivate, then delete leavers.
  2. Portal users by `last_login_at`.
  3. CRM people with no open deal, order or claim and no interaction within the period.
  4. Delete or anonymize, keeping legally retained commercial records, and record the review.
- **Legal retention.** Member States set invoice storage periods under VAT Directive Art. 247; other national periods vary. Record them in the records of processing.

### 6. `backups-and-restore`
Sources: [GDPR Art. 17, 32(1)(c)](https://eur-lex.europa.eu/eli/reg/2016/679/oj), [EDPB CEF 2025 erasure report](https://www.edpb.europa.eu/system/files/documents/2026-02/edpb_cef-report_2025_right-to-erasure_en.pdf) Issue 6, [EDPB 01/2022](https://www.edpb.europa.eu/documents/guideline/guidelines-012022-on-data-subject-rights-right-of-access_en) §110.
- **Backups:** encrypted, access-restricted, with a stated maximum retention. That maximum bounds how long erased data survives; put it in the records of processing.
- **Erasure register:**
  - Enterprise: the erase runs' `--out` reports and page downloads, stored outside the database with restricted access. Each holds the run date and the request: subject `kind:id`, plus the email or phone of a lookup-only subject, which a re-run needs.
  - OSS: the DSR log entries of manual erasures.
- **After any restore or point-in-time recovery, before reopening:**
  1. Re-run every erasure recorded after the backup's timestamp. Enterprise runs are idempotent; in OSS, repeat the manual deletions.
  2. Run `mercato search reindex`.
  3. Admit users.

### 7. `breach-response`
Sources: [GDPR Art. 33–34](https://eur-lex.europa.eu/eli/reg/2016/679/oj), [EDPB 9/2022](https://www.edpb.europa.eu/documents/guideline/guidelines-92022-on-personal-data-breach-notification-under-gdpr_en) §37, [EDPB 01/2021](https://www.edpb.europa.eu/documents/guideline/guidelines-012021-on-examples-regarding-personal-data-breach-notification_en).
- **Detection sources, with their retention:**
  - the action log; Enterprise export and erase runs add entries, but ordinary list exports are not logged;
  - access logs (7 d / 8 h);
  - the Enterprise sign-in log (90 d, once shipped);
  - `integration_logs` and `webhook_deliveries`;
  - proxy, database and provider logs (retention set by the operator).
- **Preserve evidence first.** Copy logs before their windows expire; raise the access-log variables during an investigation if needed. Snapshot the database and image hosts before cleanup.
- **Clock.**
  - Notify the authority within 72 h of awareness unless risk is unlikely (Art. 33(1)); details may follow in phases (33(4)).
  - A processor tells the controller without undue delay (33(2)).
- **Content (Art. 33(3)):** nature, categories and approximate numbers of people and records; contact point; likely consequences; measures taken.
- **Telling people (Art. 34):** required when the risk is high, unless the data was unintelligible (e.g. encrypted), later measures removed the risk, or a public notice replaces disproportionate individual notices.
- **Register template (Art. 33(5); every breach, notified or not):** id; dates (occurred, aware, contained); description; data and people affected; consequences; risk assessment; who was notified and when, or why not; remedial actions.

### 8. `records-of-processing`
Sources: [GDPR Art. 30](https://eur-lex.europa.eu/eli/reg/2016/679/oj), [EDPB SME guide](https://www.edpb.europa.eu/sme_en).
- **Art. 30(1) controller template:** (a) controller, representative and DPO; (b) purposes; (c) categories of people and data; (d) recipients; (e) transfers and safeguards; (f) erasure time limits; (g) security measures.
- **Art. 30(2) processor template (SaaS operator):** (a) processor and each controller; (b) categories of processing per controller; (c) transfers; (d) security measures.
- **Per-module table, written by hand.**
  - Columns: module, data subjects, data categories, typical purpose, retention setting.
  - Built from the module tables in [privacy coverage](2026-11-16-privacy-coverage.md) and [Enterprise coverage](../enterprise/GDPR/2026-11-16-privacy-coverage-enterprise.md).
  - Retention links to `retention`; recipients and transfers link to `sub-processors`.

### 9. `impact-assessment-notes`
Sources: [GDPR Art. 22, 35](https://eur-lex.europa.eu/eli/reg/2016/679/oj), [WP248](https://ec.europa.eu/newsroom/article29/items/611236), [AI Act](https://eur-lex.europa.eu/eli/reg/2024/1689/oj).
- **DPIA triggers.** Two or more WP248 criteria usually mean a DPIA. Typical here:
  - the assistant or agents over CRM data (new technology, large scale);
  - staff and planner data (employees);
  - call records;
  - scoring or profiling fields;
  - consumer portals at scale.
- **What the assistant sends to a model** (anchor `#what-the-assistant-sends-to-a-model`), one row per route, each stating the data may leave the installation:
  - typed-agent tool output, page-context records, OpenCode over MCP, code mode, search titles and snippets;
  - agent-runtime callers: chat, run-object, workflow drafts, Discord replies;
  - Enterprise agent-orchestrator context, OCR and eval judge;
  - command routing, inbox_ops extraction and translation, warranty assist;
  - attachments and OCR, embeddings, web research, moderation, the decision model, and the user's own text.
- **Provider choice.**
  - Each route uses the configured provider. Region and zero-retention options are vendor terms (controller to verify).
  - Fully local: Ollama or LM Studio for chat and agents, Ollama for embeddings, and OCR off or no `OPENAI_API_KEY`.
- **No field-level masking.** Anything a tool returns can reach the model. Allowing a provider is not data minimisation.
- **Art. 22.** Assistant writes wait for user confirmation (pending actions), and Enterprise agents only propose. No solely automated decision with legal effect ships; the controller assesses its own workflows.
- **AI Act Art. 50(1):** from 2 August 2026, people who interact with an AI system must be told so. This applies when an operator exposes an agent to customers.

### 10. `tenant-offboarding`
Sources: [GDPR Art. 28(3)(g)](https://eur-lex.europa.eu/eli/reg/2016/679/oj), [EDPB 07/2020](https://www.edpb.europa.eu/documents/guideline/guidelines-072020-on-the-concepts-of-controller-and-processor-in-the-gdpr_en), [Art. 28 SCCs](https://eur-lex.europa.eu/eli/dec_impl/2021/915/oj).
- **The controller chooses:** return or delete.
- **Export.**
  - OSS: list exports per module (`exportScope=full`). Attachment files: copy the storage paths with segment `tenant_<id>` from the storage root or S3 bucket.
  - Enterprise: subject exports where per-person files are needed.
- **Delete.**
  - Soft-delete the tenant. `directory/commands/tenants.ts:203-209` only sets `deleted_at`.
  - Enterprise: `mercato privacy purge-tenant --tenant <id>` dry run, then `--apply --out`. It removes files, search entries and rows.
  - OSS: no purge command. Use the operator's own database procedure, or Enterprise.
- **Written confirmation** to the controller: date, scope, what external providers still hold, and when the last backup holding the tenant expires.

## Architecture

| File | Action |
|---|---|
| `apps/docs/docs/deployment/gdpr/{index,sub-processors,hardening,data-subject-requests,retention,backups-and-restore,breach-response,records-of-processing,impact-assessment-notes,tenant-offboarding}.mdx` | Create, by stage |
| `apps/docs/sidebars.ts` | "GDPR" sub-category under "Deployment" |
| `apps/docs/__tests__/gdpr-subprocessors.test.mjs`, `apps/docs/__tests__/gdpr-no-outbound-packages.json` | Create; add to the `apps/docs` `test` script (pattern: `push-env-table.test.mjs`) |
| `packages/create-app/README.md` | One "Privacy and GDPR" paragraph linking the section (the template has no README) |

**The test** reads the root `package.json` workspaces (`apps/*`, `packages/*`) and the backticked package names in the first column of the `sub-processors` table. It fails when:
- a package is in neither the table nor the JSON list;
- a package is in both;
- a JSON entry has an empty `reason`;
- a row or entry names a package that no longer exists.

It checks packages, not flows. A new flow inside a listed package is caught only by review, and the page says so.

## Data Models

None.

## API Contracts

None. The pages cite env vars and the Enterprise commands `mercato privacy export|erase|purge-tenant`, owned by other specs. A rename there updates the page in the same change.

## Risks & Impact Review

| Scenario | Severity | Affected area | Mitigation | Residual risk |
|---|---|---|---|---|
| A default, env var or provider flow changes and the page keeps the old claim | High | Operators' vendor and config decisions | Per-row file citations; package test; a change to an outbound flow or retention default edits the page in the same PR | A new flow inside a listed package is caught only by review |
| Pages read as legal advice or a compliance guarantee | Medium | Controllers | Not-legal-advice line on every page; index puts duties and Known limits first | Readers who skip the index |
| A page describes an unshipped feature | Medium | Operators answering requests | Staging rule; unshipped steps marked "not yet available" with the manual step | Low |
| Manual OSS procedures miss data (free text, an unlisted module, provider copies) | Medium | Data subjects | Per-module table, free-text search step, Art. 19 from the matrix, Known limits | Accepted; Art. 12 permits manual routines |
| A vendor's region or transfer claim goes stale | Low | Transfer assessments | Checked date or "controller to verify" per row | Controller re-checks its vendors |

## Implementation Plan

### Stage 1 — ships now (existing controls only)
1. Add `index`, `sub-processors`, `hardening`, `breach-response`, `records-of-processing` and `impact-assessment-notes`, plus the sidebar category. The docs build passes.
2. Add the package test and the no-outbound JSON, and wire them into the docs `test` script. The test passes, and fails on the fixtures below.
3. Add the create-app README paragraph.

### Stage 2 — ships with the features described, manual procedure first
1. `data-subject-requests` with the OSS manual procedures, restriction, objection and Art. 19. Enterprise steps arrive in the change that ships the `privacy` module; the do-not-contact step arrives with the 10-22 flag.
2. `retention`: existing windows now. New rows arrive in the change that ships each pruner phase.
3. `backups-and-restore`: OSS register and re-apply now. Enterprise `--out` reports arrive with the module.
4. `tenant-offboarding`: OSS export and manual deletion now. `purge-tenant` arrives with the module.

## Integration Coverage

No application API or UI path is added. Coverage is at the docs level:

| Id | Asserts |
|---|---|
| TC-DOCS-GDPR-001 | `gdpr-subprocessors.test.mjs`. Fails for: a temporary package missing from both lists, a row naming a removed package, a package in both lists, an empty reason. Passes for a reasoned JSON entry. Fixtures are cleaned in `finally`. |
| TC-DOCS-GDPR-002 | Each page of the current stage exists under `deployment/gdpr/` and appears in `sidebars.ts`. `impact-assessment-notes` holds the `what-the-assistant-sends-to-a-model` anchor. |
| TC-DOCS-GDPR-003 | The docs build passes with `onBrokenLinks: 'throw'` (`docusaurus.config.ts:12`), so internal links resolve. |

## Final Compliance Report — 2026-11-20

| Rule | Status | Notes |
|---|---|---|
| No enterprise-only scope in OSS specs | Compliant | OSS docs; Enterprise steps are labelled and specified in the Enterprise spec |
| Integration coverage | Scoped | Docs tests above; no API or UI added |
| Backward compatibility | N/A | Documentation only |
| Spec links only to the final GDPR set | Compliant | Other specs are named by path |

## Changelog

- 2026-11-20 — Rewritten to minimal GDPR scope.
