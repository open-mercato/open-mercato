import datetime
import json
import re
import sys
from pathlib import Path


CRITERIA = {
    "1.1.1", "1.2.1", "1.2.2", "1.2.3", "1.2.4", "1.2.5",
    "1.3.1", "1.3.2", "1.3.3", "1.3.4", "1.3.5", "1.4.1", "1.4.2",
    "1.4.3", "1.4.4", "1.4.5", "1.4.10", "1.4.11", "1.4.12", "1.4.13",
    "2.1.1", "2.1.2", "2.1.4", "2.2.1", "2.2.2", "2.3.1",
    "2.4.1", "2.4.2", "2.4.3", "2.4.4", "2.4.5", "2.4.6", "2.4.7", "2.4.11",
    "2.5.1", "2.5.2", "2.5.3", "2.5.4", "2.5.7", "2.5.8",
    "3.1.1", "3.1.2", "3.2.1", "3.2.2", "3.2.3", "3.2.4", "3.2.6",
    "3.3.1", "3.3.2", "3.3.3", "3.3.4", "3.3.7", "3.3.8", "4.1.2", "4.1.3",
}
METHODS = {"source", "automated", "browser", "measurement", "manual", "manual_at"}
BROWSER_METHODS = {"browser", "measurement", "manual_at"}
STATUSES = {"pass", "fail", "not_applicable", "not_evaluated"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def nonempty(value):
    return isinstance(value, str) and bool(value.strip())


def evidence_valid(evidence, snapshot):
    require(isinstance(evidence, dict), "Evidence must be an object")
    for field in ("source", "description", "observedAt"):
        require(nonempty(evidence.get(field)), "Missing evidence " + field)
    require(evidence.get("snapshotId") == snapshot, "Stale or mismatched evidence snapshot")
    datetime.date.fromisoformat(evidence["observedAt"])


def environment_valid(assessment):
    method = assessment["method"]
    if method not in BROWSER_METHODS and method != "automated":
        return
    environment = assessment.get("environment")
    require(isinstance(environment, dict), "Runtime or tool evidence requires environment")
    if method == "automated":
        require(nonempty(environment.get("tool")), "Automated evidence requires tool/version")
        return
    require(nonempty(environment.get("browser")), "Runtime evidence requires browser/version")
    if method == "manual_at":
        require(nonempty(environment.get("os")) and nonempty(environment.get("assistiveTechnology")), "AT evidence requires OS and reader/version")


def validate_report(report, today=None):
    today = today or datetime.date.today()
    require(isinstance(report, dict), "Report must be an object")
    require(type(report.get("schemaVersion")) is int and report["schemaVersion"] == 1, "Unsupported schemaVersion")
    for field in ("base", "head"):
        require(isinstance(report.get(field), str) and re.fullmatch(r"[a-f0-9]{40}", report[field]), "Invalid commit " + field)
    require(nonempty(report.get("snapshotId")), "Missing snapshotId")
    require(type(report.get("scopeRelevant")) is bool, "scopeRelevant must be boolean")
    require(nonempty(report.get("scopeRationale")), "Missing scopeRationale")
    required = report.get("requiredChecks")
    assessments = report.get("assessments")
    findings = report.get("findings")
    legacy = report.get("legacyDebt")
    require(isinstance(required, list) and all(nonempty(check) for check in required), "Invalid requiredChecks")
    require(len(required) == len(set(required)), "Duplicate required checks")
    require(isinstance(assessments, list), "Invalid assessments")
    require(isinstance(findings, list), "Invalid findings")
    require(isinstance(legacy, list), "Invalid legacyDebt")
    if not report["scopeRelevant"]:
        require(not required and not assessments and not findings, "N/A scope must have no assessed UI checks/findings")
        require(report.get("verdict") == "not_applicable", "N/A scope verdict mismatch")
        return "not_applicable"
    require(bool(required), "Relevant scope must declare required checks")
    checked = {}
    for assessment in assessments:
        require(isinstance(assessment, dict), "Assessment must be an object")
        check_id = assessment.get("checkId")
        require(nonempty(check_id) and check_id in required and check_id not in checked, "Unknown or duplicate assessment checkId")
        require(assessment.get("criterionId") in CRITERIA, "Criterion outside WCAG 2.2 A/AA target")
        for field in ("surfaceId", "state"):
            require(nonempty(assessment.get(field)), "Missing assessment " + field)
        require(assessment.get("method") in METHODS, "Invalid assessment method")
        status = assessment.get("status")
        require(status in STATUSES, "Invalid assessment status")
        evidence = assessment.get("evidence")
        require(isinstance(evidence, list), "Assessment evidence must be a list")
        if status in {"pass", "fail"}:
            require(bool(evidence), "Pass/fail requires evidence")
            environment_valid(assessment)
        for item in evidence:
            evidence_valid(item, report["snapshotId"])
        if status == "not_applicable":
            require(nonempty(assessment.get("rationale")), "N/A assessment requires rationale")
        if status == "not_evaluated":
            require(nonempty(assessment.get("rationale")), "Unverified assessment requires rationale")
        checked[check_id] = assessment
    finding_ids = set()
    for finding in findings:
        require(isinstance(finding, dict), "Finding must be an object")
        check_id = finding.get("checkId")
        require(nonempty(check_id) and check_id in checked and checked[check_id]["status"] == "fail", "Finding must reference a failed assessment")
        require(finding.get("severity") in {"blocker", "major", "minor"}, "Confirmed A/AA finding severity invalid")
        require(nonempty(finding.get("userImpact")) and nonempty(finding.get("reproduction")), "Finding requires impact and reproduction")
        finding_ids.add(check_id)
    failed = {check_id for check_id, assessment in checked.items() if assessment["status"] == "fail"}
    require(failed <= finding_ids, "Failed assessment requires a finding")
    for debt in legacy:
        require(isinstance(debt, dict), "Legacy debt must be an object")
        for field in ("fingerprint", "owner", "reference", "expiry", "surfaceId"):
            require(nonempty(debt.get(field)), "Missing legacy debt " + field)
        require(datetime.date.fromisoformat(debt["expiry"]) >= today, "Expired legacy debt must be repaired or renewed")
    missing = set(required) - set(checked)
    unverified = any(assessment["status"] == "not_evaluated" for assessment in checked.values())
    expected = "changes_required" if failed else "incomplete" if missing or unverified else "ready"
    require(report.get("verdict") == expected, "Expected verdict " + expected)
    return expected


def main():
    if len(sys.argv) != 2:
        print("Usage: validate_report.py report.json", file=sys.stderr)
        return 2
    try:
        report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
        verdict = validate_report(report)
    except (OSError, ValueError, TypeError, KeyError) as error:
        print("Invalid report: " + str(error), file=sys.stderr)
        return 1
    print("Report structurally valid; declared verdict=" + verdict + "; scope/evidence truth not independently verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
