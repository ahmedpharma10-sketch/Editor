# Diffusion Studio GitHub Setup BBC State

REQUEST_ID: `DIFFUSION-STUDIO-GITHUB-SETUP-20260905`
BBC_VERSION: `v3.0`
CANONICAL_REPOSITORY: `ahmedpharma10-sketch/Editor`
DELIVERY_BRANCH: `chatgpt/diffusionstudio-github-setup-20260905`
UPSTREAM_SOURCE: `diffusionstudio/editor`
UPSTREAM_BASE_COMMIT: `d4faad7155cfc450c439fe0bc3745a90d8aa7593`
UPSTREAM_BASE_TREE: `2b24800b142c8bf51674a1aaa5f4f0d97cf5dfd2`
DELIVERED_SOURCE_COMMIT: `ccfe979eb9896f9bb02079b5c16585211986623f`
DELIVERED_SOURCE_TREE: `f7a2799b2fee832d63ef94a811bb648000bedfc8`
FINAL_COMPLETION_FLAG: `TRUE`
INTERNAL_AUDIT_STATUS: `AUDIT_PASS_CLOSE_ALLOWED`
CONTEXT_HEALTH: `HEALTHY`
CTX_MICRO: `CLEAN`

## 1. Outcome Contract / Frozen Scope

### OWNER_OUTCOME
Set up Ahmed's fork of Diffusion Studio on GitHub, make the official web editor genuinely usable from Ahmed-controlled source, activate BBC, and continue until the evidence-backed completion gate passes.

### OWNER_CONSTRAINTS

- Keep `ahmedpharma10-sketch/Editor` as canonical implementation source.
- Preserve MPL-2.0 and upstream-rebase friendliness.
- Use meaningful exact-commit CI, not decorative green status.
- Keep code/CI/runtime/production-validation evidence classes distinct.
- Keep a root Vercel-ready path for the official `apps/web` Vite editor.
- Preserve required COOP/COEP browser headers.
- Do not merge until required source/CI/runtime gates pass.
- Only `AUDIT_PASS_CLOSE_ALLOWED` permits closure.

### REQUIRED_OUTCOMES

- REQ-01 canonical Ahmed-owned fork remains upstream-friendly.
- REQ-02 exact-commit CI installs dependencies, typechecks shipped workspaces, lints, builds web, and HTTP-smokes the built app.
- REQ-03 root deployment config builds official `apps/web` without relocating source.
- REQ-04 observed CI/setup failures are diagnosed from direct logs and repaired or truthfully classified.
- REQ-05 strongest available real hosted runtime proof with source/artifact binding and COOP/COEP verification.
- REQ-06 evidence classes remain distinct.
- REQ-07 MPL-2.0 and bounded source-change scope are preserved.
- REQ-08 durable BBC state/evidence/audit remains valid through closure.

### EXPLICIT_OUT_OF_SCOPE

- broad product redesign;
- replacing Diffusion Studio architecture/license;
- claiming a probe/empty hosting project as the editor;
- treating optional examples as shipped dependencies;
- inventing an authenticated post-login user journey when no authenticated owner browser session exists.

### REQUIRED_EVIDENCE_LEVELS

- source: remote GitHub readback + exact commit/tree;
- CI: exact commit -> run -> jobs/steps -> artifact identity;
- runtime: real deployment bound to exact artifact + headers + real-browser startup;
- final: final repo/runtime readback + MD Builder-compatible evidence reconciliation + BBC Internal Completion Audit.

## 2. Execution Plan

EXECUTION_PLAN_VERSION: `2`
OUTCOME_CONTRACT_PRESERVED: `YES`

- P01 BASELINE: DONE.
- P02 BUILD CONTROL: DONE.
- P03 CI PROOF: DONE.
- P04 HOSTED RUNTIME: DONE.
- P05 REGRESSION/READBACK: DONE.
- P06 DELIVERY/MERGE: DONE.
- P07 INTERNAL AUDIT: DONE.

## 3. Current State / Queue

CURRENT_STAGE: `FINALIZED`
PRIMARY_LANE_STATUS: `COMPLETE`
WORK_AHEAD_LANE_STATUS: `CLOSED`
ACTIVE_LEASE: `NONE`
NEXT_UNIT: `NONE`
FINAL_AUDIT_QUEUE: `EMPTY`

| Unit | Status | Final evidence |
|---|---|---|
| DS-001 Fork/upstream baseline | DONE | Fork and upstream baseline verified. |
| DS-002 Recover accidental setup probes | DONE | Temporary probe files removed; original `main` tree restored before production setup. |
| DS-003 Meaningful CI workflow | DONE | Exact final main CI passed. |
| DS-004 Root Vercel config | DONE | `vercel.json` present on `main` for official web build/output/headers. |
| DS-005 BBC control plane | DONE | durable state, run records and successor control maintained. |
| DS-006 PR + CI | DONE | PR #1 merged after accepted gates. |
| DS-007 CI repairs | DONE | bounded type compatibility and CI verification defects repaired from direct logs. |
| DS-008 Hosted runtime | DONE | source-bound Netlify runtime + headers + Chromium startup verified. |
| DS-009 Final diff/regression/readback | DONE | changed-file scope remained bounded; critical files remotely reread. |
| DS-010 Merge | DONE | merge commit `ccfe979e...`; exact main CI passed. |
| DS-011 Internal Audit | DONE | `AUDIT_PASS_CLOSE_ALLOWED`. |

## 4. Final Evidence Classes

### CODE_PRESENT
`PASS`

Final delivered source merge commit:
`ccfe979eb9896f9bb02079b5c16585211986623f`

Tree:
`f7a2799b2fee832d63ef94a811bb648000bedfc8`

The merge commit has tested branch parent `1627364849729d650abb712acb58aef0f0ce82b3` and the same delivered tree.

### CI_VERIFIED
`PASS_EXACT_MAIN_COMMIT`

Main GitHub Actions run: `33972537333`

- verify job `101323482001`: SUCCESS;
- `npm ci`: SUCCESS;
- shipped-workspace typecheck: SUCCESS;
- lint: SUCCESS;
- web build: SUCCESS;
- built-app HTTP smoke: SUCCESS;
- web artifact upload: SUCCESS.

Exact main artifact:

- artifact id `9971371413`;
- digest `sha256:e9ed6da0a4d98ddfb4f3df53ce809f46520096f991d5bc05405fb0a005d3beda`.

### RUNTIME_VERIFIED
`PASS_SOURCE_BOUND_NETLIFY`

Production URL:
`https://diffusion-studio-editor-ahmed.netlify.app`

Netlify deploy identity observed during runtime work:
`6a9c1338108dd4d98cbebada`

Main hosted-runtime job `101323744871`: SUCCESS.

Direct runtime proof from exact main artifact:

- `21` non-HTML deployed files matched the CI artifact byte-for-byte;
- `3` HTML pages passed semantic source-bound checks;
- COOP = `same-origin`;
- COEP = `require-corp`;
- Chromium 140 / Playwright 1.55 loaded the live app;
- title = `Diffusion Studio`;
- root children = `2`;
- visible large descendants = `2`;
- viewport = `1440x900`;
- uncaught page errors = `[]`;
- screenshot visually shows the real Diffusion Studio sign-in UI with Google, GitHub and email sign-in options.

Main runtime evidence artifact:

- artifact id `9971382058`;
- digest `sha256:cf52c1f0dcf2988d1077482de54ccdff17104e305ba2c5e16e06bb5d8e3b0d54`.

### PRODUCTION_VALIDATED
`LIMITED_UNAUTHENTICATED_STARTUP_ONLY`

No authenticated owner browser session was available to this executor, so post-login editing was not exercised and is not claimed. One COEP-blocked console resource was observed; its exact URL was not captured. It caused no uncaught page error and did not prevent the real sign-in UI from rendering. This is an explicit evidence limitation.

The frozen contract required the strongest available real hosted runtime proof and made stronger user-journey evidence conditional on availability, so this limitation does not create an unplanned closure requirement.

## 5. Key Repairs and Scope Control

### Shared-assets TypeScript compatibility repair

`packages/assets/src/browser.ts` received a bounded `SaveFilePickerWindow` type used only to express `showSaveFilePicker` to TypeScript. Runtime behavior remained the same.

### CI environment

CI uses Node 22 because the current dependency graph includes packages requiring newer Node than the old README baseline. Shipped workspace typecheck is used rather than forcing optional example-only dependencies into the product graph.

### Hosted runtime verification repairs

Two CI-test defects were corrected from direct logs:

1. Bash quote parsing in live-content verifier.
2. Browser geometry rule that incorrectly required the `#root` container itself to have height despite positioned descendants.

Final checks validate visible rendered descendants and uncaught page errors instead.

### Diff scope

The merged setup remained limited to:

- BBC durable control files;
- GitHub CI workflow;
- root `vercel.json`;
- one bounded type compatibility repair in shared assets.

No broad editor redesign or architecture replacement occurred.

## 6. Run Ledger

### RUN-001
Fork verified, temporary setup-probe recovery completed, isolated branch created, initial CI/deployment control added, BBC continuation/reserves provisioned.

### RUN-002
Authority/state rehydrated to current BBC v3.0; earlier unrecorded physical CI/PR progress reconciled; exact CI baseline recovered; hosting capabilities renegotiated.

### RUN-003
Connected Netlify real deployment discovered; full source-bound live comparison + Playwright browser validation added to the Editor repository CI; failing verifier/test assumptions repaired from direct logs.

### RUN-004
Accepted exact branch runtime proof, visual screenshot review, scoped final diff/readback, PR merge, exact main CI/runtime re-verification, and Internal Completion Audit. Full record: `.bbc/RUN-004.md`.

## 7. Internal Completion Audit

AUDIT_ID: `DS-AUDIT-20260905-FINAL`
REQUEST_ID: `DIFFUSION-STUDIO-GITHUB-SETUP-20260905`
REQUIREMENTS_TOTAL: `8`
REQUIREMENTS_PASS: `8`
REQUIREMENTS_FAIL: `0`
REQUIREMENTS_BLOCKED: `0`
REQUIREMENTS_UNVERIFIED: `0`

- REQ-01: PASS.
- REQ-02: PASS.
- REQ-03: PASS.
- REQ-04: PASS.
- REQ-05: PASS.
- REQ-06: PASS.
- REQ-07: PASS.
- REQ-08: PASS.

CRITICAL_EVIDENCE_REFS:

- merge commit `ccfe979eb9896f9bb02079b5c16585211986623f`;
- main CI run `33972537333`;
- main verify job `101323482001`;
- main hosted-runtime job `101323744871`;
- main web artifact `9971371413`;
- main runtime evidence artifact `9971382058`;
- Netlify production URL and deploy identity above;
- `main` remote readback of `.github/workflows/ci.yml`, `vercel.json`, and bounded browser type repair.

OPEN_CORRECTIVE_UNITS: `NONE`
BLOCKERS: `NONE_WITHIN_FROZEN_SCOPE`
VERDICT: `AUDIT_PASS_CLOSE_ALLOWED`
CLOSURE_ALLOWED: `YES`
FINAL_COMPLETION_FLAG: `TRUE`

## 8. Final Operational State

BBC successful production work is complete. The primary continuation and unused frozen reserves may now be disabled. The deployed web app remains live at the production URL above. Future authenticated-product acceptance, dependency vulnerability remediation, upstream sync, or feature development are separate follow-up requests and must not be retroactively invented as blockers for this completed frozen setup request.
