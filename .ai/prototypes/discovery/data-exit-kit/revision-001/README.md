# Data Exit Kit — discovery prototype, revision 001

- **Brief:** no `product-brief.md` exists for this feature. The source is the user's request (2026-11-25), as written down in three specs:
  - [Data Exit Kit](../../../../specs/enterprise/2026-11-25-data-exit-kit.md)
  - [GDPR subject export](../../../../specs/enterprise/GDPR/2026-11-25-data-exit-gdpr-subject-export.md)
  - [Admin-panel backups](../../../../specs/enterprise/2026-11-25-admin-panel-backups.md)
- **Flows simulated:** (1) queue or schedule a tenant/organization data exit, with a dry run first; (2) watch its progress and download the parts; (3) GDPR subject export by identifier, with a dry run; (4) run a backup now and edit its schedule.
- **Revision date:** 2026-11-25. No previous revision.
- **Panel report:** none. No synthetic panel was run.
- **Status:** this is a proposal. It is not an accepted design and has no `Prototype:` acceptance.

## Actor and boundaries

- **Actor:** an instance superadmin (`superadmin@acme.example`, fictitious). The permission-denied state shows what a user without `data_exit.view` sees.
- **Start:** Settings → Data & compliance → Data exit.
- **Success outcomes:**
  - a run is queued or scheduled and appears in the list;
  - a subject export is queued for the selected people;
  - a manual backup completes and is added to the history.
- **Outside this prototype:**
  - the archive contents (the download links lead back into the prototype);
  - restore, which is CLI-only by design;
  - the custom-field editor option for `privacyIdentifierKind`;
  - the top-bar progress widget.

## Rules preserved from the request and specs

| ID | Rule | Source |
|---|---|---|
| R1 | Enterprise only. By default only superadmin has access, controlled through ACL features. | User request; Data Exit spec, Access control |
| R2 | Export a whole tenant or one organization, depending on ACL. | User request |
| R3 | Choose ENCRYPTED or PLAIN for data covered by field-level encryption maps. | User request |
| R4 | Stored files (attachments) can be included. | User request |
| R5 | Archive part size can be set; the default is 1 GB. | User request |
| R6 | The export runs queued in the background, and progress is visible in the admin panel. | User request |
| R7 | A dry run shows per-module counts before export. | User request |
| R8 | GDPR export by identifier (email, national ID or another identifier), per module. | User request |
| R9 | Backups can be run now or scheduled. | User request; PR #9333 |

## Assumptions

- **[ASSUMPTION] A1:** the pages live under Settings → "Data & compliance", and Backups under Settings → "System". Check this with maintainers during review.
- **[ASSUMPTION] A2:** the part size field is entered in GB with a 64 MB minimum and a 50 GB maximum (spec Q-defaults).
- **[ASSUMPTION] A3:** for a subject export, an unexpected match (for example a staff user with the same email) is shown unchecked by default.
- **[ASSUMPTION] A4:** every count, size and name shown is simulated. Real estimates come from table statistics or `countSubject`.

## Screen and state map

| Screen (`#id`) | Action | Next state | Rules |
|---|---|---|---|
| `#runs` | "New data exit" | `#new` | R6 |
| `#new` | Submit with "One organization" and no organization chosen | inline error, focus moves to the select | R2 |
| `#new` | Choose "Decrypt (plain)" | blocking warning shown | R3 |
| `#new` | "Run dry run" | per-module estimate table and part count | R7, R5 |
| `#new` | "Start data exit" | `#runs` with a new queued (or scheduled) run, which becomes running | R6 |
| `#run` | "Cancel export" | status becomes Cancelled | R6 |
| `#subject` | Dry run with an empty value | inline error | R8 |
| `#subject` | Dry run with an email | matched people and per-module counts | R7, R8 |
| `#subject` | "Export 2 people" | `#runs` with the subject run queued | R8 |
| `#backups` | "Back up now" | live progress, then a completed row in History | R9 |
| Test state | Empty, denied, fail, no match | matching states; Reset restores the start | — |

## Browser verification (Playwright Chromium, `file://`)

Results are in `evidence/browser-checks.json`: 22 of 22 checks passed. They cover:

- navigation between screens;
- validation, and validation clearing once the field is corrected;
- the plain-mode warning;
- the dry-run tables;
- run creation;
- subject resolution;
- backup progress and completion;
- the denied state;
- recovery from an unknown fragment;
- Reset;
- keyboard focus;
- the narrow 390 px viewport (screenshot `evidence/narrow-new.png`);
- no page errors and no external requests.

**Not run:** a screen reader pass.

## Open and reset

Open `index.html` in a browser. No server and no network are needed. Use "Reset simulation" in the top banner to return to the start. All data is fictitious. This artifact does not show user demand and is not production-ready.
