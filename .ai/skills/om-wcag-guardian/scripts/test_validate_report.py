import copy
import datetime
import unittest
from validate_report import validate_report


TODAY = datetime.date(2026, 10, 1)


def valid_report():
    return {
        "schemaVersion": 1,
        "base": "a" * 40,
        "head": "b" * 40,
        "snapshotId": "fixture-snapshot-1",
        "scopeRelevant": True,
        "scopeRationale": "Fixture dialog focus change",
        "requiredChecks": ["dialog-focus"],
        "assessments": [{
            "checkId": "dialog-focus", "criterionId": "2.4.3", "surfaceId": "dialog",
            "state": "close", "method": "browser", "status": "pass",
            "environment": {"browser": "Fixture Chromium 1"},
            "evidence": [{"snapshotId": "fixture-snapshot-1", "source": "fixture-trace", "observedAt": "2026-10-01", "description": "Synthetic validator fixture, not app evidence"}],
        }],
        "findings": [], "legacyDebt": [], "verdict": "ready",
    }


def legacy_debt(expiry):
    return {"fingerprint": "color-contrast|orders-table|default|th", "owner": "fixture-owner", "reference": "fixture-issue-1", "expiry": expiry, "surfaceId": "orders-table"}


def finding():
    return {"checkId": "dialog-focus", "severity": "major", "userImpact": "Focus lost", "reproduction": "Open then close"}


class ReportTests(unittest.TestCase):
    def test_complete_current_evidence_accepts_ready(self):
        self.assertEqual(validate_report(valid_report(), TODAY), "ready")

    def test_missing_required_check_cannot_pass(self):
        report = valid_report()
        report["requiredChecks"].append("reader")
        with self.assertRaises(ValueError):
            validate_report(report, TODAY)
        report["verdict"] = "incomplete"
        self.assertEqual(validate_report(report, TODAY), "incomplete")

    def test_empty_scope_cannot_claim_ready(self):
        report = valid_report()
        report["requiredChecks"] = []
        report["assessments"] = []
        with self.assertRaises(ValueError):
            validate_report(report, TODAY)

    def test_invalid_commit_rejected(self):
        report = valid_report()
        report["head"] = "HEAD"
        with self.assertRaises(ValueError):
            validate_report(report, TODAY)

    def test_stale_evidence_rejected(self):
        report = valid_report()
        report["assessments"][0]["evidence"][0]["snapshotId"] = "older-build"
        with self.assertRaises(ValueError):
            validate_report(report, TODAY)

    def test_no_evidence_rejected(self):
        report = valid_report()
        report["assessments"][0]["evidence"] = []
        with self.assertRaises(ValueError):
            validate_report(report, TODAY)

    def test_invalid_observed_date_rejected(self):
        report = valid_report()
        report["assessments"][0]["evidence"][0]["observedAt"] = "yesterday"
        with self.assertRaises(ValueError):
            validate_report(report, TODAY)

    def test_unverified_cannot_pass(self):
        report = valid_report()
        report["assessments"][0].update(status="not_evaluated", evidence=[], rationale="Browser unavailable")
        with self.assertRaises(ValueError):
            validate_report(report, TODAY)
        report["verdict"] = "incomplete"
        self.assertEqual(validate_report(report, TODAY), "incomplete")

    def test_na_assessment_requires_rationale(self):
        report = valid_report()
        report["assessments"][0].update(status="not_applicable", evidence=[])
        with self.assertRaises(ValueError):
            validate_report(report, TODAY)
        report["assessments"][0]["rationale"] = "Dialog has no dismissible trigger in this state"
        self.assertEqual(validate_report(report, TODAY), "ready")

    def test_failure_requires_finding_and_changes(self):
        report = valid_report()
        report["assessments"][0]["status"] = "fail"
        report["verdict"] = "changes_required"
        with self.assertRaises(ValueError):
            validate_report(report, TODAY)
        report["findings"] = [finding()]
        self.assertEqual(validate_report(report, TODAY), "changes_required")

    def test_failure_outranks_missing_checks(self):
        report = valid_report()
        report["requiredChecks"].append("reader")
        report["assessments"][0]["status"] = "fail"
        report["findings"] = [finding()]
        report["verdict"] = "incomplete"
        with self.assertRaises(ValueError):
            validate_report(report, TODAY)
        report["verdict"] = "changes_required"
        self.assertEqual(validate_report(report, TODAY), "changes_required")

    def test_finding_cannot_reference_passed_assessment(self):
        report = valid_report()
        report["findings"] = [finding()]
        with self.assertRaises(ValueError):
            validate_report(report, TODAY)

    def test_unknown_method_rejected(self):
        report = valid_report()
        report["assessments"][0]["method"] = "axe"
        with self.assertRaises(ValueError):
            validate_report(report, TODAY)

    def test_fake_at_without_reader_metadata_rejected(self):
        report = valid_report()
        report["assessments"][0]["method"] = "manual_at"
        with self.assertRaises(ValueError):
            validate_report(report, TODAY)
        report["assessments"][0]["environment"].update(os="Fixture OS 1", assistiveTechnology="Fixture Reader 1")
        self.assertEqual(validate_report(report, TODAY), "ready")

    def test_measurement_requires_browser(self):
        report = valid_report()
        report["assessments"][0].update(method="measurement", criterionId="1.4.3")
        self.assertEqual(validate_report(report, TODAY), "ready")
        del report["assessments"][0]["environment"]
        with self.assertRaises(ValueError):
            validate_report(report, TODAY)

    def test_automated_requires_tool_not_browser(self):
        report = valid_report()
        report["assessments"][0]["method"] = "automated"
        with self.assertRaises(ValueError):
            validate_report(report, TODAY)
        report["assessments"][0]["environment"] = {"tool": "Fixture Linter 1"}
        self.assertEqual(validate_report(report, TODAY), "ready")

    def test_source_and_manual_need_no_environment(self):
        for method in ("source", "manual"):
            report = valid_report()
            report["assessments"][0]["method"] = method
            del report["assessments"][0]["environment"]
            self.assertEqual(validate_report(report, TODAY), "ready")

    def test_true_no_ui_scope_accepts_na_with_rationale(self):
        report = valid_report()
        report.update(scopeRelevant=False, scopeRationale="Only internal non-user-facing API logging", requiredChecks=[], assessments=[], verdict="not_applicable")
        self.assertEqual(validate_report(report, TODAY), "not_applicable")

    def test_na_cannot_hide_assessed_failure(self):
        report = valid_report()
        report.update(scopeRelevant=False, verdict="not_applicable")
        with self.assertRaises(ValueError):
            validate_report(report, TODAY)

    def test_duplicate_assessment_rejected(self):
        report = valid_report()
        report["assessments"].append(copy.deepcopy(report["assessments"][0]))
        with self.assertRaises(ValueError):
            validate_report(report, TODAY)

    def test_undeclared_assessment_rejected(self):
        report = valid_report()
        extra = copy.deepcopy(report["assessments"][0])
        extra["checkId"] = "undeclared"
        report["assessments"].append(extra)
        with self.assertRaises(ValueError):
            validate_report(report, TODAY)

    def test_aaa_criterion_outside_target_rejected(self):
        report = valid_report()
        report["assessments"][0]["criterionId"] = "2.4.13"
        with self.assertRaises(ValueError):
            validate_report(report, TODAY)

    def test_current_legacy_debt_does_not_change_verdict(self):
        report = valid_report()
        report["legacyDebt"] = [legacy_debt("2026-10-01")]
        self.assertEqual(validate_report(report, TODAY), "ready")

    def test_expired_legacy_debt_rejected(self):
        report = valid_report()
        report["legacyDebt"] = [legacy_debt("2026-09-30")]
        with self.assertRaises(ValueError):
            validate_report(report, TODAY)

    def test_legacy_debt_requires_owner(self):
        report = valid_report()
        debt = legacy_debt("2026-12-31")
        del debt["owner"]
        report["legacyDebt"] = [debt]
        with self.assertRaises(ValueError):
            validate_report(report, TODAY)


if __name__ == "__main__":
    unittest.main()
