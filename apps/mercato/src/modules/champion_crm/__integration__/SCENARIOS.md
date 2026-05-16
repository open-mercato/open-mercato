# Champion CRM Integration Coverage

Executable specs in this folder cover the 20 confirmed Champion CRM business paths.

Slice 2 adds 30 Investment/Apartment/demo-flow UI business scenarios in `SCENARIOS_SLICE2_INVESTMENTS_UI.md` (`TC-CHAMP-CRM-021` through `TC-CHAMP-CRM-050`).

| ID | Scenario | Spec |
| --- | --- | --- |
| 01 | Lead intake from website/form -> new Lead -> new Contact | `TC-CHAMP-CRM-001-006-intake.spec.ts` |
| 02 | Same email intake -> dedup -> existing Contact | `TC-CHAMP-CRM-001-006-intake.spec.ts` |
| 03 | Same phone intake -> dedup -> existing Contact | `TC-CHAMP-CRM-001-006-intake.spec.ts` |
| 04 | Lead without email/phone -> manual_review in inbox | `TC-CHAMP-CRM-001-006-intake.spec.ts` |
| 05 | Lead with UTM/source payload -> campaign/source saved | `TC-CHAMP-CRM-001-006-intake.spec.ts` |
| 06 | Lead with consents -> ConsentEvent + Contact 360 visibility expectation | `TC-CHAMP-CRM-001-006-intake.spec.ts` |
| 07 | Lead inbox list/sort/status filter path | `TC-CHAMP-CRM-007-009-ui.spec.ts` |
| 08 | Lead inbox search by name/email/phone path | `TC-CHAMP-CRM-007-009-ui.spec.ts` |
| 09 | Lead detail Contact 360 shell path | `TC-CHAMP-CRM-007-009-ui.spec.ts` |
| 10 | Qualify lead -> status zakwalifikowany + Activity + AuditEvent path | `TC-CHAMP-CRM-010-020-business-contracts.spec.ts` |
| 11 | Disqualify lead -> reason + niezakwalifikowany + AuditEvent path | `TC-CHAMP-CRM-010-020-business-contracts.spec.ts` |
| 12 | Lead detail -> create Deal path | `TC-CHAMP-CRM-010-020-business-contracts.spec.ts` |
| 13 | Deal -> assign Investment path | `TC-CHAMP-CRM-010-020-business-contracts.spec.ts` |
| 14 | Deal -> assign Apartment path | `TC-CHAMP-CRM-010-020-business-contracts.spec.ts` |
| 15 | Apartment reservation -> apartment reserved + Deal relation path | `TC-CHAMP-CRM-010-020-business-contracts.spec.ts` |
| 16 | Manual activity note/call/task on Contact 360 path | `TC-CHAMP-CRM-010-020-business-contracts.spec.ts` |
| 17 | Follow-up scheduling -> nextFollowupAt visible path | `TC-CHAMP-CRM-010-020-business-contracts.spec.ts` |
| 18 | Audit trail for business changes path | `TC-CHAMP-CRM-010-020-business-contracts.spec.ts` |
| 19 | ACL read-only user can read but not mutate path | `TC-CHAMP-CRM-010-020-business-contracts.spec.ts` |
| 20 | AI adapter disabled by default path | `TC-CHAMP-CRM-010-020-business-contracts.spec.ts` |
