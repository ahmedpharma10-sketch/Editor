# Diffusion Studio BBC Successor Control

REQUEST_ID: `DIFFUSION-STUDIO-GITHUB-SETUP-20260905`
BBC_VERSION: `v2.9`
PRIMARY_STATUS: `ACTIVE_OWNER`
PRIMARY_AUTOMATION_ID: `6a9bfb417db0819195e0f66a7bec2141`
ROTATION_GENERATION: `1`
ACTIVATE: `NO`
SELECTED_SLOT: `NONE`
HANDOVER_REF: `NONE`
SUCCESSOR_ACK_REF: `NONE`
TRANSFER_PRODUCTION_OWNERSHIP: `NO`

## Reserve registry

| Slot | Task ID | Status | Prompt frozen | Activation ref | Handover ref | ACK ref |
|---|---|---|---|---|---|---|
| DIFFUSION-RESERVE-A | `6a9bfb492ac881919ec798216a6755c8` | RESERVED_UNUSED_DISABLED | YES | this file | NONE | NONE |
| DIFFUSION-RESERVE-B | `6a9bfb5418588191b330110ffcb0754c` | RESERVED_UNUSED_DISABLED | YES | this file | NONE | NONE |

SUCCESSOR_RESERVE_TARGET: `2`
SUCCESSOR_RESERVE_COUNT: `2`
SUCCESSOR_RESERVE_CAPACITY_LIMITATION: `NONE_OBSERVED`

## Rotation gate

No reserve may perform production while `ACTIVATE=NO`.

If the primary reaches `ROTATE_REQUIRED` or `RELIABILITY_UNSAFE`:

1. stop ordinary production;
2. persist a complete current handover and last verified checkpoint;
3. revoke/supersede the old production ownership before new production begins;
4. increment rotation generation;
5. select exactly one `RESERVED_UNUSED_DISABLED` slot;
6. set `ACTIVATE=YES`, exact `SELECTED_SLOT`, `HANDOVER_REF`, expected checkpoint, next safe action and ownership-transfer intent;
7. enable/reschedule that existing reserve without changing its frozen prompt;
8. require durable successor ACK after independent reconciliation;
9. transfer exclusive production ownership only after ACK/no-dual-owner gates pass;
10. mark the predecessor read-only and later disable it as appropriate.

The existence of these Scheduled Task reserves does not prove a normal visible New Chat, exact token isolation, or simultaneous execution.
