---
name: delegate-issues
description: Delegate multiple GitHub issues in parallel, each to its own autonomous worker via /delegate-issue
allowed-tools:
  - Bash
  - Read
  - Task
  - Skill
---

<objective>
Delegate multiple GitHub issues to autonomous workers in parallel.

For each issue number provided, spin up a Task sub-agent that runs `/delegate-issue <N>`. Each sub-agent independently clones the repo, launches a worker, monitors it, and reports the result. This skill orchestrates them all and provides a unified summary.
</objective>

<context>
**Invocation:**
```
/delegate-issues 165 170 175
```

Pass two or more GitHub issue numbers as space-separated arguments.

**For a single issue:** Use `/delegate-issue <N>` directly instead.

**How it works:**
This skill is a thin orchestrator. It validates the issue numbers, then launches one Task sub-agent per issue. Each sub-agent calls `/delegate-issue <N>` which handles the full lifecycle: fetch, clone, launch worker, monitor, report. This skill just waits for all of them to finish and presents a unified summary.
</context>

<process>

<step name="parse_arguments">
Extract issue numbers from the command arguments.

**Validation:**
- Each argument must be a positive integer
- At least two issue numbers are required (for a single issue, suggest `/delegate-issue` instead)
- If validation fails, report the error and stop
</step>

<step name="launch_sub_agents">
Launch one Task sub-agent per issue, all in a **single message** with multiple Task tool calls so they run in parallel.

For each issue number, use the Task tool with:
- `subagent_type`: `"general-purpose"`
- `run_in_background`: `true`
- `description`: `"Delegate issue #<N>"`
- `prompt`:

```
Run the /delegate-issue skill with argument <N>.

Use the Skill tool to invoke it:
- skill: "delegate-issue"
- args: "<N>"

Follow all instructions from the skill. When the skill completes, return the final result including whether a PR was created and its URL.
```

**IMPORTANT:** All Task tool calls MUST be in a single message to launch them in parallel.

Record the task IDs returned for each sub-agent.

Report to the user:
```
## Issues Delegated

| Issue | Task ID | Status |
|-------|---------|--------|
| #165  | abc123  | Running |
| #170  | def456  | Running |
| #175  | ghi789  | Running |

Monitoring progress... (checking every 60 seconds)
```
</step>

<step name="monitor_sub_agents">
Poll sub-agent status once per minute until all have finished.

**Loop:**
1. Wait 60 seconds using `sleep 60` in a Bash call
2. For each sub-agent still running, check in parallel:
   a. `TaskOutput` with `block: false` — is it still running or completed?
   b. `gh pr list --repo edspencer/herdctl --head fix/issue-<N> --json number,url` — has a PR appeared?

**After each check, report a compact status update:**
```
## Status Check (<X> min elapsed)

| Issue | Status | PR |
|-------|--------|-----|
| #165  | Running (5 min) | - |
| #170  | Complete | #174 |
| #175  | Running (5 min) | - |
```

**When a sub-agent completes:**
- Read its full output via `TaskOutput` with `block: true`
- Check if a PR was created
- Mark it as done

**Continue the loop** until all sub-agents are done.
</step>

<step name="final_summary">
Once all sub-agents have finished, report a final unified summary:

```
## All Issues Complete

| Issue | Result | PR |
|-------|--------|-----|
| #165  | Success | #174 https://github.com/edspencer/herdctl/pull/174 |
| #170  | Success | #175 https://github.com/edspencer/herdctl/pull/175 |
| #175  | Failed  | - (check session log) |

### Cleanup (after PRs are merged)
  rm -rf ~/Code/herdctl-issues/issue-165
  rm -rf ~/Code/herdctl-issues/issue-170
  rm -rf ~/Code/herdctl-issues/issue-175
```

For any failures, include the session log path so the user can investigate.
</step>

</process>

<success_criteria>
- [ ] All issue numbers parsed and validated
- [ ] One Task sub-agent launched per issue, all in parallel
- [ ] Sub-agents monitored every 60 seconds with status updates
- [ ] Final summary with PR links for successes and diagnostics for failures
</success_criteria>
