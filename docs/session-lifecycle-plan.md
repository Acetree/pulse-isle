# Session Lifecycle Plan

## Goal

Fix the stale session problem where a closed terminal can still leave a session card stuck in `Thinking...`.

The target design should make session state reflect CLI reality first, terminal liveness second, and UI timing last.

## Current Problem Summary

Today the project mostly works like this:

1. Claude/Codex hook events create and advance a session.
2. If no new hook arrives for 30 seconds, `processing` falls back to `thinking` for Claude.
3. A background sweep only marks a session as dead when `ps -t <tty>` shows no process on that TTY.

This causes a bad edge case:

- the terminal window is closed
- the PTY or some residual process still exists
- no `Stop` hook arrives
- the session remains in `thinking`
- the island card never converges

Another important edge case:

- Claude CLI exits internally without emitting `Stop`
- the terminal window remains open
- the shell remains attached to the same TTY
- session cleanup incorrectly treats the shell as proof that Claude is still alive

## Design Principles

1. Hook events are the primary source of truth.
2. Terminal liveness is a fallback signal, not the primary truth source.
3. `ended` means explicitly finished.
4. `interrupted` means inferred dead without an explicit finish.
5. `thinking` is a temporary inferred state and must never live forever.
6. UI should consume session state, not invent session state.

## Target State Model

### Definitive states

- `ready`
  Session exists but no active turn is underway.
- `processing`
  A prompt was submitted and the CLI is actively working between tool events.
- `runningTool`
  A tool is currently executing.
- `waitingForApproval`
  The CLI is blocked on a permission decision.
- `question`
  The CLI is blocked on an answer.
- `waitingForInput`
  The CLI is waiting for manual terminal input.
- `turnDone`
  A turn appears complete but the session is still reusable.
- `ended`
  The CLI explicitly finished through a stop event.
- `interrupted`
  The CLI did not explicitly finish, but enough evidence says the session is gone.

### Derived transitional state

- `thinking`
  No recent hook activity, but the session may still be alive.

`thinking` is not a terminal state and must always have an upper bound.

## What Should Change

### 1. Separate explicit finish from inferred finish

Keep:

- `Stop`
- `SubagentStop`

as the only direct path to `ended`.

All other cleanup paths should lead to `interrupted`, never `ended`.

### 2. Track time explicitly

Each session should record:

- `lastHookAt`
- `lastStateChangeAt`
- `lastLivenessEvidenceAt`

Optional but recommended:

- `hookCount`
- `lastSweepAt`
- `thinkingSince`

This lets the app reason about how stale a session is instead of only checking the current status.

### 3. Replace single-signal liveness with multi-signal liveness

Current logic uses only:

- `ps -t <tty>`

Target logic should combine:

- whether the tracked TTY still has processes
- whether the tracked TTY still has meaningful non-shell processes
- whether tracked PIDs still exist
- whether the hosting terminal app still exists
- whether any hook has arrived recently

The result should be a liveness assessment, not just a boolean.

Suggested shape:

```ts
interface LivenessAssessment {
  hasRecentHook: boolean
  hasTtyProcess: boolean
  hasMeaningfulTtyProcess: boolean
  hasTrackedPid: boolean
  hasTerminalApp: boolean
  confidence: 'high' | 'medium' | 'low'
  reason: string
}
```

### 4. Put an upper bound on `thinking`

Current behavior lets Claude sessions re-enter `thinking` repeatedly.

Target behavior:

- after 30s without hook activity:
  `processing -> thinking`
- after 90s without hook activity and weak liveness evidence:
  `thinking -> interrupted`
- after 180s without hook activity:
  `thinking -> interrupted` even if TTY evidence is ambiguous

This prevents a session from surviving forever just because a shell or residual PTY still exists.

If Claude exits but only the shell remains on the same TTY, that should count as weak evidence, not medium evidence.

### 5. Treat terminal window closure as weak evidence, not final truth

Closing a terminal window should not directly mark a session `ended`.

Instead it should:

- reduce liveness confidence
- accelerate interruption if no hook resumes

This protects real background work while still cleaning up stale UI.

## Proposed Lifecycle Rules

### Hook-driven transitions

- `SessionStart` -> `ready`
- `UserPromptSubmit` -> `processing`
- `PreToolUse` -> `runningTool` or `waitingForApproval` or `question`
- `PostToolUse` -> `processing`
- `Stop` / `SubagentStop` -> `ended`

Every hook event should also update:

- `lastHookAt`
- `lastStateChangeAt` when status changes
- `lastLivenessEvidenceAt`

### Timeout-driven transitions

- `processing` with no hook for 30s:
  Claude -> `thinking`
  Codex -> `turnDone`

- `thinking` with no hook for 90s and low liveness confidence:
  -> `interrupted`

- `thinking` with no hook for 180s regardless of ambiguity:
  -> `interrupted`

- `waitingForApproval` or `question` with no terminal app and no fresh hook:
  -> `interrupted`

### Cleanup-driven transitions

If sweep logic finds:

- no TTY processes
- no tracked PIDs
- no hosting terminal app

then any live status should move to `interrupted`.

## Recommended Data Model Changes

In `electron/sessionManager.ts`, add:

```ts
lastHookAt?: number
lastStateChangeAt?: number
lastLivenessEvidenceAt?: number
thinkingSince?: number
hookCount?: number
trackedPids?: number[]
terminalApp?: 'terminal' | 'cursor' | 'vscode' | 'warp' | 'windsurf' | 'unknown'
```

The session should preserve enough metadata for sweep decisions without repeatedly reconstructing all context from scratch.

## Recommended Hook Metadata Changes

In `hooks/pulse-isle-hook.py`, keep the current:

- `tty`
- terminal env
- pid chain

and consider also sending:

- current process pid
- parent pid
- probable shell pid
- probable shell process name

This gives the main process stronger signals than just the TTY name.

## Recommended Sweep Refactor

Replace the current `ttyHasProcesses()` boolean with a richer function:

```ts
function assessSessionLiveness(session: CliSession): LivenessAssessment
```

That function should:

1. inspect hook freshness
2. inspect TTY processes
3. inspect tracked PIDs
4. inspect terminal app presence
5. return a confidence level and reason

Then `sweepAbandonedSessions()` should make decisions from the assessment plus elapsed time.

## UI Expectations

The island UI should not need major structural changes.

Expected behavior after backend fixes:

- active sessions still show immediately
- approvals/questions still expand the island
- completed sessions still auto-dismiss
- stale `thinking` sessions stop lingering forever

No frontend state invention should be added to solve backend lifecycle issues.

## Implementation Plan

### Phase 1: Metadata and timestamps

1. Add timestamp fields to `CliSession`.
2. Update hook handling to refresh `lastHookAt`.
3. Record `thinkingSince` when entering `thinking`.

### Phase 2: Liveness assessment

1. Replace `ttyHasProcesses()` with a richer liveness assessment helper.
2. Use existing terminal env and pid chain to infer terminal app type.
3. Add tracked PID checks where possible.

### Phase 3: Sweep and timeout rules

1. Keep the 30s `processing -> thinking` behavior.
2. Add 90s soft interruption for low-confidence `thinking`.
3. Add 180s hard interruption ceiling for all `thinking`.
4. Interrupt approval/question states when the host terminal is clearly gone.

### Phase 4: Verification

Verify these scenarios manually:

1. Claude task completes normally and emits `Stop`.
   Expected: `ended`
2. Terminal window closes but shell still lingers briefly.
   Expected: temporary `thinking`, then `interrupted`
3. Cursor integrated terminal closes without `Stop`.
   Expected: no permanent `thinking`
4. Long-running real Claude work continues without visible tool calls.
   Expected: can remain `thinking`, but only while liveness evidence remains credible

## Non-Goals For This Pass

- redesigning task tracking
- changing island visuals
- changing approval UX
- adding persistence across app restarts

Those can be handled later. This plan is only for fixing session lifecycle correctness.

## Success Criteria

The fix is successful when all of the following are true:

1. A session cannot remain in `thinking` indefinitely.
2. Terminal closure no longer guarantees stale cards.
3. Explicit CLI completion still wins over inferred cleanup.
4. `ended` and `interrupted` are semantically distinct in both backend and UI.
5. The island UI becomes quieter without hiding real active work.
