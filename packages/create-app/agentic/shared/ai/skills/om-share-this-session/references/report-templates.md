# Issue and final report templates

Fill these templates in steps 5–6. Never add raw session excerpts, source paths, or redaction matches.

## Issue

```markdown
# Harness session report: <share-name>

<!-- [session-share:<share-name>] -->

## 🎯 Why this is shared
<Sanitized 2–5 sentence account of the requested outcome, what the harness did poorly, and what should improve.>

## 📦 Public artifacts
- Sanitized complete session JSON: <public link>
- Sanitized generated-files ZIP: <public link>
- Bundle manifest: <public link>
- Privacy report: <public link>
- Temporary branch: <branch link> at `<commit>`

## 📋 Scope
- Session entries: <count>
- Recognized user turns: <count>
- Recognized assistant turns: <count>
- Generated files: <count>
- Models/harness: <sanitized values when reliably available, otherwise “not asserted”>

## ⏹ Stop cause
- Classification: `<completed | provider-limit | provider-error | user-abort | unknown>`
- Last-entry error: <sanitized name, status, and message when present; otherwise “none”>

## 🔒 Privacy gate
- Local automated sanitization: passed; <category counts>.
- Full semantic review of the sanitized session and unpacked generated files: passed.
- Fresh informed consent for these exact artifact hashes: received.
- Original session export, source manifest, literal-redaction list, and local review tree: not uploaded.

## ⚠️ Retention
The artifact branch is temporary, but public copies may persist after branch deletion. Delete the branch after the harness investigation no longer needs the evidence.
```

## Final user report

```markdown
## 🚀 Session share published

**Issue:** #<number> (<url>)
**Temporary branch:** `<branch>` (<url>) at `<commit>`
**Artifacts:** `session.json`, `generated-files.zip`, `manifest.json`, and `privacy-report.json` matched the consented hashes.

### 🔒 Privacy result
The local automated sanitizer and complete semantic review passed. <redaction-count summary>. The original export and local review material were not uploaded.

### ⚠️ Public-retention reminder
Branch deletion cannot erase copies already cached, cloned, forked, logged, indexed, or archived. Remove the temporary branch when the investigation is complete.

Issue: #<number> (link: <url>)
```

On failure, state whether no external write occurred, the branch was rolled back, or a branch remains exposed and needs manual deletion. Never imply cleanup succeeded without verifying it.
