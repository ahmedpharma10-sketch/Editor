# Diffusion Studio GitHub Setup BBC State

REQUEST_ID: `DIFFUSION-STUDIO-GITHUB-SETUP-20260905`
BBC_VERSION: `v2.9`
CANONICAL_REPOSITORY: `ahmedpharma10-sketch/Editor`
ACTIVE_BRANCH: `chatgpt/diffusionstudio-github-setup-20260905`
UPSTREAM_SOURCE: `diffusionstudio/editor`
UPSTREAM_BASE_COMMIT: `d4faad7155cfc450c439fe0bc3745a90d8aa7593`
UPSTREAM_BASE_TREE: `2b24800b142c8bf51674a1aaa5f4f0d97cf5dfd2`
CONTEXT_HEALTH: `HEALTHY`
CTX_MICRO: `CLEAN`
CTX_PRESSURE: `NOT_EXPOSED`
FINAL_COMPLETION_FLAG: `FALSE`
INTERNAL_AUDIT_STATUS: `PENDING`

## 1. Request Contract / Frozen Plan

### OWNER_REQUEST
Set up Ahmed's fork of Diffusion Studio on GitHub, make it work there, activate BBC, and continue until the evidence-backed completion gate passes.

### IN_SCOPE_OUTCOMES

- REQ-01: `ahmedpharma10-sketch/Editor` remains the canonical Ahmed-owned implementation source and stays upstream-rebase friendly.
- REQ-02: meaningful GitHub CI installs dependencies and runs typecheck, lint, web build, and built-app HTTP smoke testing on an exact commit.
- REQ-03: monorepo root is configured so the official `apps/web` Vite editor can be deployed without manually relocating source.
- REQ-04: CI failures introduced or exposed by the setup are diagnosed from direct logs and repaired or truthfully classified.
- REQ-05: obtain the strongest available real hosted web-editor runtime proof, preferring Ahmed's connected Vercel Hobby account and preserving required COOP/COEP headers.
- REQ-06: distinguish `CODE_PRESENT`, `CI_VERIFIED`, `RUNTIME_VERIFIED`, and `PRODUCTION_VALIDATED`; never promote one evidence class into another.
- REQ-07: preserve MPL-2.0 licensing and avoid broad unrelated upstream source changes.
- REQ-08: BBC durable state, continuation, successor reserve, evidence ledger, and Internal Completion Audit remain valid until closure.

### PLAN

- P01 BASELINE: verify fork, upstream identity, source layout, existing workflows, official web deployment assumptions, and isolation branch.
- P02 BUILD CONTROL: add GitHub CI plus root Vercel configuration with official web build/env/header behavior.
- P03 CI PROOF: open PR, run exact-commit CI, inspect job logs, repair bounded failures, and obtain green required verification or an exact irreducible infrastructure blocker.
- P04 HOSTED RUNTIME: deploy the verified source through the strongest connected hosting path, bind deployment identity to source, verify HTTP/UI startup and required headers, and inspect runtime errors where exposed.
- P05 REGRESSION/READBACK: verify branch/PR diff is limited to setup scope, remote-read critical files, and confirm no temporary probe artifacts remain.
- P06 DELIVERY: merge only after required source/CI gates pass and merge is consistent with the frozen plan; verify final `main` readback.
- P07 INTERNAL AUDIT: reconcile REQ-01..REQ-08 against direct evidence; only `AUDIT_PASS_CLOSE_ALLOWED` permits final completion and BBC shutdown.

### PLAN_TO_REQUIREMENT_MAP

- P01 -> REQ-01, REQ-06, REQ-07
- P02 -> REQ-02, REQ-03, REQ-05, REQ-07
- P03 -> REQ-02, REQ-04, REQ-06
- P04 -> REQ-05, REQ-06
- P05 -> REQ-01, REQ-07
- P06 -> REQ-01, REQ-02, REQ-03
- P07 -> REQ-08 and all requirements

### COMPLETION_STANDARD

All executable frozen-plan requirements must have direct evidence; final repository state must be remotely read back; hosted-runtime claims require real deployment/runtime evidence; and the BBC Internal Completion Audit must return exactly `AUDIT_PASS_CLOSE_ALLOWED` before successful shutdown.

## 2. Current State / Work Queue

CURRENT_STAGE: `P02_BUILD_CONTROL`
ACTIVE_LEASE: `PRIMARY_INTERACTIVE_EXECUTOR`
LAST_VERIFIED_CHECKPOINT: `BASELINE_AND_SETUP_FILES_CREATED`

| Unit | Requirement | Status | Evidence / next gate |
|---|---|---|---|
| DS-001 Fork/upstream baseline | REQ-01/06/07 | DONE | Fork verified; upstream base SHA/tree recorded. |
| DS-002 Restore accidental setup probes | REQ-01/07 | DONE | `main` current tree remotely verified equal to original upstream tree `2b24800b...`. |
| DS-003 Add CI workflow | REQ-02/04 | DONE_CODE_ONLY | `.github/workflows/ci.yml` on isolated branch; runtime CI pending. |
| DS-004 Add root Vercel config | REQ-03/05 | DONE_CODE_ONLY | `vercel.json` on isolated branch; deployment pending. |
| DS-005 Persist BBC control plane | REQ-08 | RUNNING | This file plus successor control. |
| DS-006 Open PR and execute CI | REQ-02/04/06 | READY | Create PR, inspect workflow run/job/logs. |
| DS-007 Repair CI until accepted | REQ-02/04/06 | BLOCKED_DEPENDENCY | Depends on DS-006 result. |
| DS-008 Hosted runtime deployment | REQ-05/06 | READY | Prefer connected Vercel; if project creation unavailable, test legitimate connected alternative without weakening headers. |
| DS-009 Final diff/regression/readback | REQ-01/07 | BLOCKED_DEPENDENCY | Depends on CI/runtime state. |
| DS-010 Merge verified setup | REQ-01/02/03 | BLOCKED_DEPENDENCY | Requires source/CI gate. |
| DS-011 Internal Completion Audit | REQ-08 | BLOCKED_DEPENDENCY | Final stage only. |

NEXT_UNIT: `DS-006`

## 3. Run Ledger

### RUN-001

- SCHEDULED_TRIGGER_AT: `INTERACTIVE_OWNER_START`
- STARTED_AT: `2026-09-05T11:15Z`
- READY_WORK_AT_START: `YES`
- SELECTED_UNITS: `DS-001, DS-002, DS-003, DS-004, DS-005`
- RESULT: `PROGRESS`
- MEANINGFUL_PROGRESS: `YES`
- MATERIAL_PROGRESS: fork verified; full BBC v2.9 authority loaded; isolated branch created; CI and root Vercel configs written; primary hourly BBC created; two frozen successor reserves provisioned and disabled.
- RECOVERED_SETUP_ERROR: transient probe files were accidentally created while discovering branch tooling; all were removed. Final `main` tree SHA was remotely verified as exactly the original upstream tree SHA, so source content was restored before production setup continued.
- LOCAL_RUNTIME_LIMITATION: bounded sandbox clone attempt could not resolve github.com due outbound DNS restriction; this is execution-surface evidence only, not an application failure. GitHub Actions selected as remote execution substrate.
- NEXT_ACTION: open PR and inspect exact CI evidence.

## 4. Work Unit Ledger

### DS-001
STATUS_BEFORE: READY
STATUS_AFTER: DONE
WHAT_CHANGED: none
TESTS_OR_CHECKS_RUN: GitHub repository metadata, `main` branch identity, upstream README/package/config inspection.
VERIFICATION_RESULT: PASS

### DS-002
STATUS_BEFORE: RECOVERY_REQUIRED
STATUS_AFTER: DONE
WHAT_CHANGED: removed all temporary setup probe files.
TESTS_OR_CHECKS_RUN: remote `main` branch readback.
VERIFICATION_RESULT: PASS; final `main` tree SHA `2b24800b142c8bf51674a1aaa5f4f0d97cf5dfd2` equals original upstream tree SHA.

### DS-003
STATUS_BEFORE: READY
STATUS_AFTER: DONE_CODE_ONLY
WHAT_CHANGED: added `.github/workflows/ci.yml` on isolated branch.
TESTS_OR_CHECKS_RUN: runtime not yet executed.
VERIFICATION_RESULT: CODE_PRESENT_ONLY

### DS-004
STATUS_BEFORE: READY
STATUS_AFTER: DONE_CODE_ONLY
WHAT_CHANGED: added root `vercel.json` on isolated branch using official `apps/web` build/env/header semantics.
TESTS_OR_CHECKS_RUN: deployment not yet executed.
VERIFICATION_RESULT: CODE_PRESENT_ONLY

## 5. Evidence Ledger

- EV-001 | GitHub fork metadata | `ahmedpharma10-sketch/Editor` | proves Ahmed-owned fork exists and is writable; does not prove app runtime.
- EV-002 | Upstream/fork base commit | `d4faad7155cfc450c439fe0bc3745a90d8aa7593` | proves starting source identity.
- EV-003 | Upstream/final-restored main tree | `2b24800b142c8bf51674a1aaa5f4f0d97cf5dfd2` | proves accidental probe cleanup restored source tree content exactly; does not erase harmless Git history entries.
- EV-004 | CI source commit | `311f19be54605c7e4c3200cd12be21e47cf44db8` | proves CI file write existed on branch; does not prove CI passed.
- EV-005 | Vercel-config source commit | `f09f7b476a3c65b1f511342f7e887690715b83cb` | proves root deployment config write existed on branch; does not prove deployment.
- EV-006 | BBC automation control | primary hourly continuation enabled; two frozen reserves provisioned disabled | proves governed future continuation exists; does not prove project completion or visible new chats.

## 6. Internal Completion Audit Record

AUDIT_ID: `DIFFUSION-STUDIO-FINAL-AUDIT-001`
AUDITED_AT: `NOT_RUN`
REQUIREMENTS_TOTAL: `8`
REQUIREMENTS_PASS: `0_FINAL`
REQUIREMENTS_FAIL: `0`
REQUIREMENTS_BLOCKED: `0`
REQUIREMENTS_UNVERIFIED: `8`
VERDICT: `AUDIT_PENDING`
CLOSURE_ALLOWED: `NO`
OPEN_CORRECTIVE_UNITS: `DS-006..DS-011`

No final completion claim is authorized at this state.
