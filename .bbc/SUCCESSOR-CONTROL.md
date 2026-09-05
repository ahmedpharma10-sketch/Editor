# Diffusion Studio BBC Successor Control

REQUEST_ID: `DIFFUSION-STUDIO-GITHUB-SETUP-20260905`
BBC_VERSION: `v3.0`
PRIMARY_STATUS: `ACTIVE_OWNER`
PRIMARY_AUTOMATION_ID: `6a9bfb417db0819195e0f66a7bec2141`
ROTATION_GENERATION: `1`
ACTIVATE: `NO`
SELECTED_SLOT: `NONE`
HANDOVER_REF: `NONE`
SUCCESSOR_ACK_REF: `NONE`
TRANSFER_PRODUCTION_OWNERSHIP: `NO`
CURRENT_OUTCOME_CONTRACT_REF: `.bbc/BBC-STATE.md#1-outcome-contract--frozen-scope`
CURRENT_EXECUTION_PLAN_REF: `.bbc/BBC-STATE.md#2-adaptive-execution-plan`
LAST_VERIFIED_CHECKPOINT: `EXACT_COMMIT_CI_VERIFIED_45c78cb`

## Reserve registry

| Slot | Task ID | Status | Prompt frozen | Activation ref | Handover ref | ACK ref |
|---|---|---|---|---|---|---|
| DIFFUSION-RESERVE-A | `6a9bfb492ac881919ec798216a6755c8` | RESERVED_UNUSED_DISABLED | YES | this file | NONE | NONE |
| DIFFUSION-RESERVE-B | `6a9bfb5418588191b330110ffcb0754c` | RESERVED_UNUSED_DISABLED | YES | this file | NONE | NONE |

SUCCESSOR_RESERVE_TARGET: `2`
SUCCESSOR_RESERVE_COUNT: `2`
SUCCESSOR_RESERVE_CAPACITY_LIMITATION: `NONE_OBSERVED`
RESERVE_PROMPTS_FROZEN: `YES`

## Rotation gate

No reserve may perform production while `ACTIVATE=NO`.

BBC v3.0 preserves the v2.5-v2.9 successor ownership laws. If the primary reaches `ROTATE_REQUIRED` or `RELIABILITY_UNSAFE`:

1. stop ordinary production and new fan-out;
2. finish/cancel only the current atomic action safely;
3. persist a complete current handover, active capability degradations, deliverable/runtime state and last verified checkpoint;
4. revoke/supersede the old production ownership and any colliding leases before new production begins;
5. increment rotation generation;
6. select exactly one `RESERVED_UNUSED_DISABLED` slot;
7. set `ACTIVATE=YES`, exact `SELECTED_SLOT`, `HANDOVER_REF`, expected checkpoint, exact next safe action and ownership-transfer intent;
8. enable/reschedule that existing reserve without changing its frozen prompt;
9. require durable successor ACK after independent rehydration, Outcome Contract reconciliation and checkpoint reverification;
10. transfer exclusive production ownership only after ACK/no-dual-owner gates pass;
11. mark the predecessor read-only and later disable it as appropriate.

The existence of these Scheduled Task reserves proves only the tested frozen-snapshot successor lane. It does not prove a normal visible New Chat, exact token isolation, or simultaneous execution.
