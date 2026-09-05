# Diffusion Studio GitHub Setup BBC State

REQUEST_ID: `DIFFUSION-STUDIO-GITHUB-SETUP-20260905`
BBC_VERSION: `v3.0`
CANONICAL_REPOSITORY: `ahmedpharma10-sketch/Editor`
ACTIVE_BRANCH: `chatgpt/diffusionstudio-github-setup-20260905`
UPSTREAM_SOURCE: `diffusionstudio/editor`
UPSTREAM_BASE_COMMIT: `d4faad7155cfc450c439fe0bc3745a90d8aa7593`
UPSTREAM_BASE_TREE: `2b24800b142c8bf51674a1aaa5f4f0d97cf5dfd2`
CURRENT_MAIN_COMMIT: `799eb0d03c82ada7906a7ee0e7d34f270249269d`
CURRENT_MAIN_TREE: `2b24800b142c8bf51674a1aaa5f4f0d97cf5dfd2`
LAST_CI_VERIFIED_SOURCE_COMMIT: `45c78cb41aa068cb76f5e52ad56756d89a4b82ed`
CONTEXT_HEALTH: `HEALTHY`
CTX_BASELINE: `ESTABLISHED`
CTX_MICRO: `CLEAN`
CTX_PRESSURE: `NOT_EXPOSED`
CTX_INTEGRITY: `REPAIRED`
CTX_REHYDRATION: `PASS`
CTX_DRIFT_STATE: `REPAIRABLE`
CAUSE_CLASS: `PROJECT_STATE`
FINAL_COMPLETION_FLAG: `FALSE`
INTERNAL_AUDIT_STATUS: `AUDIT_PENDING`

## 1. Outcome Contract / Frozen Scope

### OWNER_OUTCOME
Set up Ahmed's fork of Diffusion Studio on GitHub, make the official web editor genuinely usable from Ahmed-controlled source, activate BBC, and continue until the evidence-backed completion gate passes.

### OWNER_CONSTRAINTS

- Keep `ahmedpharma10-sketch/Editor` as the canonical implementation source.
- Preserve MPL-2.0 and upstream-rebase friendliness.
- Use meaningful exact-commit CI, not decorative green status.
- Do not promote code or CI evidence into runtime or production proof.
- Prefer Ahmed's connected Vercel Hobby account for hosted runtime when the real app can be bound to the verified source.
- Preserve required COOP/COEP browser headers.
- Do not merge to `main` until required source/CI/runtime gates in this frozen contract permit it.
- Only BBC Internal Completion Audit verdict `AUDIT_PASS_CLOSE_ALLOWED` permits full closure.

### REQUIRED_OUTCOMES

- REQ-01: `ahmedpharma10-sketch/Editor` remains the canonical Ahmed-owned implementation source and stays upstream-rebase friendly.
- REQ-02: meaningful GitHub CI installs dependencies and runs typecheck, lint, web build, and built-app HTTP smoke testing on an exact commit.
- REQ-03: monorepo root is configured so the official `apps/web` Vite editor can be deployed without manually relocating source.
- REQ-04: CI failures introduced or exposed by the setup are diagnosed from direct logs and repaired or truthfully classified.
- REQ-05: obtain the strongest available real hosted web-editor runtime proof, preferring Ahmed's connected Vercel Hobby account and preserving required COOP/COEP headers.
- REQ-06: distinguish `CODE_PRESENT`, `CI_VERIFIED`, `RUNTIME_VERIFIED`, and `PRODUCTION_VALIDATED`; never promote one evidence class into another.
- REQ-07: preserve MPL-2.0 licensing and avoid broad unrelated upstream source changes.
- REQ-08: BBC durable state, continuation, successor reserve, evidence ledger, and Internal Completion Audit remain valid until closure.

### EXPLICIT_OUT_OF_SCOPE

- Broad product redesign or feature changes unrelated to making the existing official web editor build/deploy reliably.
- Replacing Diffusion Studio's architecture or license.
- Calling a hosting probe or empty project the real editor runtime.
- Treating optional example-only dependencies as required shipped-workspace dependencies without upstream evidence.

### REQUIRED_EVIDENCE_LEVELS

- Repository/source claims: direct GitHub remote readback and exact commit/tree identity.
- CI claims: exact commit -> workflow run -> job/step results -> build artifact identity.
- Hosted runtime claims: deployment identity bound to accepted source/artifact plus HTTP/UI startup and required-header readback; stronger user-journey/browser evidence when available.
- Final completion: final repository/runtime readback plus MD Builder-compatible evidence reconciliation plus BBC Internal Completion Audit.

## 2. Adaptive Execution Plan

EXECUTION_PLAN_VERSION: `2`
OUTCOME_CONTRACT_PRESERVED: `YES`

- P01 BASELINE: verify fork, upstream identity, source layout, existing workflows, official web deployment assumptions, and isolation branch.
- P02 BUILD CONTROL: add GitHub CI plus root Vercel configuration with official web build/env/header behavior.
- P03 CI PROOF: open PR, run exact-commit CI, inspect job logs, repair bounded failures, and obtain green required verification or an exact irreducible infrastructure blocker.
- P04 HOSTED RUNTIME: deploy the verified source through the strongest connected hosting path, bind deployment identity to source, verify HTTP/UI startup and required headers, and inspect runtime errors where exposed.
- P05 REGRESSION/READBACK: verify branch/PR diff is limited to setup scope, remote-read critical files, and confirm no temporary probe artifacts remain.
- P06 DELIVERY: merge only after required source/CI/runtime gates pass and merge is consistent with the frozen contract; verify final `main` readback.
- P07 INTERNAL AUDIT: reconcile REQ-01..REQ-08 against direct evidence; only `AUDIT_PASS_CLOSE_ALLOWED` permits final completion and BBC shutdown.

### PLAN_REVISION DS-PLAN-R02

- FROM_VERSION: `1`
- TO_VERSION: `2`
- EVIDENCE_TRIGGER: Personal OS authority advanced from BBC v2.9 to BBC v3.0 and current hosting connectors were re-negotiated.
- WHAT_CHANGED: execution routing only. GitHub Actions remains CI substrate; P04 now explicitly checks connected Vercel and Netlify project/deploy state before selecting a hosted-runtime route.
- WHY_CHANGED: BBC v3.0 requires current capability negotiation and adaptive routing while preserving the frozen outcome.
- AFFECTED_UNITS: `DS-008, DS-009`
- OUTCOME_CONTRACT_PRESERVED: `YES`
- NEW_OWNER_SCOPE: `NO`
- VERIFICATION_IMPACT: none; hosted-runtime proof remains required at the original strength.

### PLAN_TO_REQUIREMENT_MAP

- P01 -> REQ-01, REQ-06, REQ-07
- P02 -> REQ-02, REQ-03, REQ-05, REQ-07
- P03 -> REQ-02, REQ-04, REQ-06
- P04 -> REQ-05, REQ-06
- P05 -> REQ-01, REQ-07
- P06 -> REQ-01, REQ-02, REQ-03, REQ-05
- P07 -> REQ-08 and all requirements

### COMPLETION_STANDARD

All executable frozen-scope requirements must have direct evidence; final repository state must be remotely read back; hosted-runtime claims require real deployment/runtime evidence bound to accepted source/artifact; and the BBC Internal Completion Audit must return exactly `AUDIT_PASS_CLOSE_ALLOWED` before successful shutdown.

## 3. Current State / Work Queue

CURRENT_STAGE: `P04_HOSTED_RUNTIME`
PRIMARY_LANE_STATUS: `RUNNING`
PRIMARY_CURRENT_UNIT: `DS-008`
WORK_AHEAD_LANE_STATUS: `ELIGIBLE`
ACTIVE_LEASE: `PRIMARY_SCHEDULED_EXECUTOR`
LAST_VERIFIED_CHECKPOINT: `EXACT_COMMIT_CI_VERIFIED_45c78cb`
NEXT_UNIT: `DS-008`

| Unit | Requirement | Status | Evidence / next gate |
|---|---|---|---|
| DS-001 Fork/upstream baseline | REQ-01/06/07 | DONE | Fork/upstream identity verified; current `main` tree equals upstream base tree. |
| DS-002 Restore accidental setup probes | REQ-01/07 | DONE | Temporary probe files removed; current `main` tree SHA is exactly `2b24800b...`. |
| DS-003 Add meaningful CI workflow | REQ-02/04 | DONE | CI source present and exact-commit run verified green. |
| DS-004 Add root Vercel config | REQ-03/05 | DONE_CODE_ONLY | `vercel.json` present; real deployment still required. |
| DS-005 Persist BBC control plane | REQ-08 | DONE | Durable state and successor control exist; authority reconciled to v3.0. |
| DS-006 Open PR and execute CI | REQ-02/04/06 | DONE | PR #1 open/mergeable; exact commit CI run completed success. |
| DS-007 Repair CI until accepted | REQ-02/04/06 | DONE | `showSaveFilePicker` type failure repaired surgically; Node 22/shipped-workspace check adopted; final exact commit CI green. |
| DS-008 Hosted runtime deployment | REQ-05/06 | RUNNING | Vercel project exists but its only deployment is an unbound probe; Netlify project exists but source binding/deploy contents are not yet proven. |
| DS-009 Final diff/regression/readback | REQ-01/07 | READY | PR diff already shows scoped files only; final readback must use final accepted branch head after runtime work. |
| DS-010 Merge verified setup | REQ-01/02/03/05 | BLOCKED_DEPENDENCY | Requires DS-008 and final exact-head regression/readback. |
| DS-011 Internal Completion Audit | REQ-08 | BLOCKED_DEPENDENCY | Final stage only. |

## 4. Runtime Capability Negotiation

| Capability | Current state | Evidence / limitation |
|---|---|---|
| GITHUB_READ | PROVEN_RUNNING_NOW | Branch, PR, files, commits and workflow evidence read in current run. |
| GITHUB_WRITE | PROVEN_RUNNING_NOW | Existing isolated branch is writable; state reconciliation commit uses this route. |
| GITHUB_ACTIONS | PROVEN_RUNNING_NOW | Exact commit run `33963597565` completed success and artifact readback succeeded. |
| VERCEL_PROJECT_READ | PROVEN_RUNNING_NOW | Connected Hobby team and `diffusion-studio-editor-ahmed` project/deployment read directly. |
| VERCEL_REAL_SOURCE_BINDING | CONNECTED_NOT_PROVEN_FOR_ACTION | Project reports `link=null`; current deployment has empty meta/framework and no build logs. |
| VERCEL_PRODUCTION_RUNTIME | CONNECTED_NOT_PROVEN_FOR_ACTION | Existing READY deployment is not bound to the verified Diffusion Studio artifact and cannot count as runtime proof. |
| NETLIFY_PROJECT_READ | PROVEN_RUNNING_NOW | Connected project `diffusion-studio-editor-ahmed` read directly. |
| NETLIFY_REAL_SOURCE_BINDING | UNKNOWN | Project read exposes no Git/source binding and current deploy details are empty. |
| NETLIFY_PRODUCTION_RUNTIME | CONNECTED_NOT_PROVEN_FOR_ACTION | Site exists but real Diffusion Studio deployment is unverified. |
| LOCAL_SANDBOX_NETWORK | PROVEN_PREVIOUSLY_NOT_RECHECKED | Earlier bounded clone failed DNS; classified as execution-surface limitation, not app failure. |
| CHAT_NATIVE_BROWSER | SOURCE_DISCOVERED | BBC v3.0 authority defines the route; not needed or claimed running for this unit unless hosting UI becomes the best verified route. |
| CODEX_OWNER_RUNTIME | AVAILABLE_NOT_CONNECTED | MD Builder doctrine loaded; no current Codex host/owner review execution is claimed. |

## 5. Run Ledger

### RUN-001

- SCHEDULED_TRIGGER_AT: `INTERACTIVE_OWNER_START`
- STARTED_AT: `2026-09-05T11:15Z`
- READY_WORK_AT_START: `YES`
- SELECTED_UNITS: `DS-001, DS-002, DS-003, DS-004, DS-005`
- RESULT: `PROGRESS`
- MEANINGFUL_PROGRESS: `YES`
- MATERIAL_PROGRESS: fork verified; BBC v2.9 authority loaded at that time; isolated branch created; CI and root Vercel configs written; primary continuation created; two frozen successor reserves provisioned and disabled.
- RECOVERED_SETUP_ERROR: transient probe files were accidentally created while discovering branch tooling; all were removed. Final `main` tree SHA was remotely verified as exactly the original upstream tree SHA, so source content was restored before production setup continued.
- LOCAL_RUNTIME_LIMITATION: bounded sandbox clone attempt could not resolve github.com due outbound DNS restriction; this is execution-surface evidence only, not an application failure. GitHub Actions selected as remote execution substrate.
- NEXT_ACTION_AT_CLOSE: open PR and inspect exact CI evidence.

### RUN-002

- SCHEDULED_TRIGGER_AT: `2026-09-05T12:21Z`
- STARTED_AT: `2026-09-05T12:21Z`
- READY_WORK_AT_START: `YES`
- REHYDRATION_STATUS: `FULL_RELOAD_REQUIRED_AND_PASS`
- AUTHORITY_CHANGE: BBC current authority advanced from v2.9 to v3.0; complete mandatory stack and Software Development/GitHub App Builder/ChatGPT MD Builder authority reloaded.
- CTX_MICRO_AT_START: `ANOMALY:STALE_PROJECT_STATE`
- CTX_INTEGRITY: `REPAIRED`
- CTX_REHYDRATION: `PASS`
- CTX_DRIFT_STATE: `REPAIRABLE`
- CAUSE_CLASS: `PROJECT_STATE`
- CONTEXT_HEALTH_AFTER_REPAIR: `HEALTHY`
- SELECTED_UNITS: `DS-005_RECOVERY, DS-006_RECOVERY, DS-007_RECOVERY, DS-008`
- NO_UNRECORDED_WORK_RECOVERY: direct GitHub evidence showed PR/CI/repair work had advanced beyond the prior durable state. This run reconciled that physical reality before further production credit.
- VERIFIED_RECOVERY: branch head `45c78cb41aa068cb76f5e52ad56756d89a4b82ed`; PR #1 open/mergeable; CI run `33963597565` success; verify job `101299658869` all required steps success; artifact `diffusionstudio-web-dist` digest `sha256:01f15ca95a2b6ff1e2c41efb0aadba9fe728804566745ba7a4107b01c8d789a3`.
- HOSTING_RECHECK: Vercel connected project exists, but only deployment `dpl_6c9NFZfdUVoZ4KbWAi9jkG1Titow` has empty source metadata/framework and no build logs, so it is classified probe-only and NOT runtime proof. Netlify connected project exists but currently exposes no verified source/deploy payload.
- RESULT_SO_FAR: `REHYDRATED_PROGRESS`
- MEANINGFUL_PROGRESS: `YES`
- NEXT_ACTION: determine a legitimate source-bound hosted deployment route, then perform final exact-head regression/readback.

## 6. Work Unit Ledger

### DS-001
STATUS_BEFORE: READY
STATUS_AFTER: DONE
WHAT_CHANGED: none
TESTS_OR_CHECKS_RUN: GitHub repository metadata, `main` branch identity, upstream source/layout inspection.
VERIFICATION_RESULT: PASS
EVIDENCE_REFS: `EV-001, EV-002, EV-003`

### DS-002
STATUS_BEFORE: RECOVERY_REQUIRED
STATUS_AFTER: DONE
WHAT_CHANGED: removed all temporary setup probe files.
TESTS_OR_CHECKS_RUN: remote `main` branch readback.
VERIFICATION_RESULT: PASS; current `main` tree SHA `2b24800b142c8bf51674a1aaa5f4f0d97cf5dfd2` equals original upstream tree SHA.
EVIDENCE_REFS: `EV-003`

### DS-003
STATUS_BEFORE: DONE_CODE_ONLY
STATUS_AFTER: DONE
WHAT_CHANGED: CI workflow retained; later repaired to Node 22 and shipped-workspace typecheck semantics.
TESTS_OR_CHECKS_RUN: exact-head GitHub Actions CI including install, typecheck, lint, build, HTTP smoke and artifact upload.
VERIFICATION_RESULT: PASS / CI_VERIFIED
EVIDENCE_REFS: `EV-007, EV-008, EV-009`

### DS-004
STATUS_BEFORE: READY
STATUS_AFTER: DONE_CODE_ONLY
WHAT_CHANGED: root `vercel.json` uses official `apps/web` build output plus SPA rewrite and COOP/COEP headers.
TESTS_OR_CHECKS_RUN: source read/diff; real source-bound deployment still pending.
VERIFICATION_RESULT: CODE_PRESENT_ONLY
EVIDENCE_REFS: `EV-005`

### DS-005
STATUS_BEFORE: RUNNING_STALE
STATUS_AFTER: DONE
WHAT_CHANGED: durable control state reconciled to current BBC v3.0 and current physical repository/CI reality.
TESTS_OR_CHECKS_RUN: Personal OS full authority reload plus current branch/PR/Actions/hosting readback.
VERIFICATION_RESULT: PASS
EVIDENCE_REFS: `EV-010`

### DS-006
STATUS_BEFORE: READY_STALE
STATUS_AFTER: DONE
WHAT_CHANGED: PR #1 already existed from prior execution and was independently reread in this run.
TESTS_OR_CHECKS_RUN: PR metadata/diff/head/base readback.
VERIFICATION_RESULT: PASS
EVIDENCE_REFS: `EV-006A`

### DS-007
STATUS_BEFORE: BLOCKED_DEPENDENCY_STALE
STATUS_AFTER: DONE
WHAT_CHANGED: bounded `showSaveFilePicker` TypeScript repair and CI check-route repair were already committed; current run independently validated the final exact-commit CI result.
TESTS_OR_CHECKS_RUN: GitHub Actions run/job/step/artifact readback.
VERIFICATION_RESULT: PASS / CI_VERIFIED
FAILURES_AND_REPAIRS: upstream type declaration mismatch repaired locally without changing runtime semantics; Node runtime raised to 22; optional examples excluded from shipped-workspace typecheck based on upstream project structure rather than adding false dependencies.
EVIDENCE_REFS: `EV-007, EV-008, EV-009`

### DS-008
STATUS_BEFORE: READY
STATUS_AFTER: RUNNING
WHAT_CHANGED: none yet to accepted app source in this run.
ACTIONS: verified connected Vercel and Netlify project state and rejected probe/empty hosting state as runtime proof.
VERIFICATION_RESULT: NOT_YET_RUNTIME_VERIFIED
EVIDENCE_REFS: `EV-011, EV-012, EV-013`

## 7. Evidence Ledger

- EV-001 | GitHub fork metadata | `ahmedpharma10-sketch/Editor` | proves Ahmed-owned fork exists and is writable; does not prove app runtime.
- EV-002 | Upstream/fork base commit | `d4faad7155cfc450c439fe0bc3745a90d8aa7593` | proves starting source identity.
- EV-003 | Current restored `main` tree | commit `799eb0d03c82ada7906a7ee0e7d34f270249269d`, tree `2b24800b142c8bf51674a1aaa5f4f0d97cf5dfd2` | proves current source tree content equals original upstream base tree; Git history still truthfully contains the recovered probes.
- EV-004 | Original CI source commit | `311f19be54605c7e4c3200cd12be21e47cf44db8` | historical code-present evidence only.
- EV-005 | Root Vercel-config source | present in PR #1 branch diff | proves deploy configuration source exists; does not prove deployment.
- EV-006 | BBC control-plane presence | `.bbc/BBC-STATE.md` + `.bbc/SUCCESSOR-CONTROL.md` | proves durable control state exists; reserve runtime must be checked independently for user-facing liveness claims.
- EV-006A | Pull request | PR #1, open, mergeable, head `45c78cb41aa068cb76f5e52ad56756d89a4b82ed`, base `main` | proves isolated delivery surface and current scoped diff at that head.
- EV-007 | GitHub Actions workflow run | run `33963597565` on exact commit `45c78cb41aa068cb76f5e52ad56756d89a4b82ed` | conclusion `success`; proves exact-commit CI execution.
- EV-008 | GitHub Actions verify job | job `101299658869` | all required install/typecheck/lint/build/HTTP-smoke/upload steps completed success.
- EV-009 | Web build artifact | `diffusionstudio-web-dist`, 2,595,798 bytes, digest `sha256:01f15ca95a2b6ff1e2c41efb0aadba9fe728804566745ba7a4107b01c8d789a3` | proves production web `dist` artifact exists from exact CI source; does not by itself prove hosted runtime.
- EV-010 | Personal OS authority readback | current router says BBC v3.0 Chat-Native WorkOS | proves authority-version change requiring durable state reconciliation.
- EV-011 | Vercel project/deployment readback | project `diffusion-studio-editor-ahmed`; one production deployment `dpl_6c9NFZfdUVoZ4KbWAi9jkG1Titow` state READY | proves a hosting project/probe exists only.
- EV-012 | Vercel source-binding limitation | project `link=null`; deployment `meta={}`, framework null; no build log events found | proves current READY deployment cannot be bound to accepted Diffusion Studio source and therefore is not `RUNTIME_VERIFIED`.
- EV-013 | Netlify project readback | project `diffusion-studio-editor-ahmed`; no access controls; current deploy payload empty in connector readback | proves site container exists, but not a real Diffusion Studio deployment.

## 8. Evidence Class State

CODE_PRESENT: `PASS`
CI_VERIFIED: `PASS_FOR_COMMIT_45c78cb41aa068cb76f5e52ad56756d89a4b82ed`
RUNTIME_VERIFIED: `NO`
PRODUCTION_VALIDATED: `NO`

No stronger class may be inferred until DS-008 produces direct source-bound runtime evidence.

## 9. Internal Completion Audit Record

AUDIT_ID: `DIFFUSION-STUDIO-FINAL-AUDIT-001`
AUDITED_AT: `NOT_RUN`
REQUEST_ID: `DIFFUSION-STUDIO-GITHUB-SETUP-20260905`
OUTCOME_CONTRACT_REF: `this file / Section 1`
PLAN_REF: `this file / Section 2`
REQUIREMENTS_TOTAL: `8`
REQUIREMENTS_PASS_FINAL: `0_FINAL_UNTIL_AUDIT`
REQUIREMENTS_FAIL: `0`
REQUIREMENTS_BLOCKED: `0`
REQUIREMENTS_UNVERIFIED: `8_FINAL_AUDIT_PENDING`
CRITICAL_EVIDENCE_REFS: `EV-003, EV-006A, EV-007, EV-008, EV-009, EV-012, EV-013`
FINAL_READBACK: `PENDING`
VERDICT: `AUDIT_PENDING`
OPEN_CORRECTIVE_UNITS: `DS-008, DS-009, DS-010, DS-011`
BLOCKERS: `No source-bound hosted Diffusion Studio runtime has yet been verified.`
CLOSURE_ALLOWED: `NO`

No final completion claim is authorized at this state.
