---
name: dispatch-issues
description: Clone repo per GitHub issue and launch parallel Claude Code workers to fix each one
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
---

<objective>
Dispatch parallel Claude Code workers to fix GitHub issues autonomously.

For each issue number provided as arguments:
1. Fetch the issue details from GitHub
2. Clone the repo into `~/Code/herdctl-issues/issue-<N>/`
3. Create a fix branch and install dependencies
4. Launch a Claude Code worker process to fix the issue and open a PR

Each worker runs as an independent `claude -p` process with full autonomy.
</objective>

<context>
**Invocation:**
```
/dispatch-issues 101 102 103
```

Pass one or more GitHub issue numbers as space-separated arguments. Each issue gets its own repo clone and its own Claude Code worker process.

**Prerequisites:**
- `gh` CLI authenticated with access to edspencer/herdctl
- `git` configured with SSH access to push branches
- `claude` CLI installed and authenticated
- `pnpm` available globally

**Output directory:** `~/Code/herdctl-issues/`
Each clone lives at `~/Code/herdctl-issues/issue-<N>/` with a worker log at `claude-worker.log` inside it.

**Cleanup:** After PRs are merged, delete clones manually:
```bash
rm -rf ~/Code/herdctl-issues/issue-<N>
```
</context>

<process>

<step name="parse_arguments">
Extract issue numbers from the command arguments.

The arguments string contains space-separated issue numbers (e.g., `101 102 103`).

**Validation:**
- Each argument must be a positive integer
- At least one issue number is required
- If no arguments are provided, report an error and stop

Store the list of issue numbers for subsequent steps.
</step>

<step name="fetch_issues">
Fetch details for all issues in parallel using Bash tool.

For each issue number, run in parallel:
```bash
gh issue view <N> --repo edspencer/herdctl --json number,title,body,labels,state
```

**Validation:**
- Each issue must exist (gh returns 0)
- Each issue must be in "OPEN" state
- If any issue is not found or not open, report which ones failed and stop

Store the issue details (number, title, body) for each valid issue.
</step>

<step name="clone_and_setup">
Create clones and install dependencies in parallel.

First, ensure the parent directory exists:
```bash
mkdir -p ~/Code/herdctl-issues
```

Then for each issue, run in parallel using Bash tool with `run_in_background: true`:
```bash
git clone git@github.com:edspencer/herdctl.git ~/Code/herdctl-issues/issue-<N> && \
cd ~/Code/herdctl-issues/issue-<N> && \
git checkout -b fix/issue-<N> && \
pnpm install
```

Wait for ALL clones to complete before proceeding. Check each background task for success.

**If a clone fails:**
- Report which issue clone failed and why
- Continue with the remaining issues that succeeded
</step>

<step name="launch_workers">
Launch a Claude Code worker in each clone directory using Bash tool with `run_in_background: true`.

For each issue, construct the worker prompt by filling in the template below with the issue's number, title, and body. Then launch:

```bash
cd ~/Code/herdctl-issues/issue-<N> && claude -p "<filled worker prompt>" \
  --dangerously-skip-permissions \
  --model opus \
  2>&1 | tee ~/Code/herdctl-issues/issue-<N>/claude-worker.log
```

**IMPORTANT:** The worker prompt must be properly escaped for shell usage. Single quotes in the issue body must be escaped. Prefer using a heredoc or writing the prompt to a temp file and passing it via stdin if the issue body contains special characters:

```bash
cd ~/Code/herdctl-issues/issue-<N> && \
cat <<'WORKER_PROMPT' | claude -p - \
  --dangerously-skip-permissions \
  --model opus \
  2>&1 | tee ~/Code/herdctl-issues/issue-<N>/claude-worker.log
<filled worker prompt here>
WORKER_PROMPT
```

Launch ALL workers in parallel (all Bash calls in a single message with `run_in_background: true`).

**Record the background task ID** returned for each worker. You will need these IDs in the monitoring step.
</step>

<step name="report_launch">
After all workers are launched, report a summary table:

```
## Workers Dispatched

| Issue | Title | Clone | Task ID |
|-------|-------|-------|---------|
| #101  | Fix the thing | ~/Code/herdctl-issues/issue-101/ | abc1234 |
| #102  | Add the other | ~/Code/herdctl-issues/issue-102/ | def5678 |

Monitoring progress... (checking every 60 seconds)
```
</step>

<step name="monitor_workers">
Poll worker status once per minute until all workers have finished.

**Loop:**
1. Wait 60 seconds using `sleep 60` in a Bash call
2. For each worker that is still running, check status using **all three methods in parallel**:
   a. `TaskOutput` with `block: false` — check if the background task is still running or completed
   b. Parse the worker's JSONL session file for progress
   c. Check if a PR exists via `gh pr list`

**Finding the JSONL session file:**
The worker's Claude Code session is stored at:
```
~/.claude/projects/-Users-ed-Code-herdctl-issues-issue-<N>/
```
Find the `.jsonl` file in that directory (there will be exactly one). Parse it with this command to extract a status summary:

```bash
JSONL_FILE=$(ls -t ~/.claude/projects/-Users-ed-Code-herdctl-issues-issue-<N>/*.jsonl 2>/dev/null | head -1)
if [ -n "$JSONL_FILE" ]; then
  cat "$JSONL_FILE" | python3 -c "
import sys, json
tool_calls = []
last_message = ''
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        obj = json.loads(line)
        if obj.get('type') == 'assistant':
            for block in obj.get('message', {}).get('content', []):
                if block.get('type') == 'text' and block['text'].strip():
                    last_message = block['text'].strip()[:150]
                elif block.get('type') == 'tool_use':
                    name = block.get('name', '')
                    inp = block.get('input', {})
                    if name == 'Bash':
                        tool_calls.append(f'Bash: {inp.get(\"description\", inp.get(\"command\", \"\")[:60])}')
                    elif name in ('Read', 'Edit', 'Write'):
                        tool_calls.append(f'{name}: {inp.get(\"file_path\", \"\").split(\"/\")[-1]}')
                    elif name == 'Grep':
                        tool_calls.append(f'Grep: \"{inp.get(\"pattern\", \"\")}\"')
                    else:
                        tool_calls.append(name)
    except: pass
print(f'Tool calls: {len(tool_calls)}')
if tool_calls:
    print(f'Last tool: {tool_calls[-1]}')
if last_message:
    print(f'Status: {last_message}')
"
fi
```

**Checking for PR:**
```bash
gh pr list --repo edspencer/herdctl --head fix/issue-<N> --json number,url 2>/dev/null
```

**After each check cycle, report a compact status update:**

```
## Status Check (2 min elapsed)

| Issue | Tool Calls | Last Activity | PR |
|-------|-----------|---------------|-----|
| #101  | 23 | "Running pnpm build..." | - |
| #102  | 15 | "Exploring useWebSocket.ts..." | - |
```

**When a worker completes:**
- Check `TaskOutput` exit code (0 = success)
- Check if PR was created
- Mark that worker as done and stop monitoring it

**Continue the loop** until all workers are done.
</step>

<step name="final_summary">
Once all workers have finished, report a final summary:

```
## All Workers Complete

| Issue | Title | Result | PR |
|-------|-------|--------|-----|
| #101  | Fix the thing | Success | #172 https://github.com/edspencer/herdctl/pull/172 |
| #102  | Add the other | Success | #173 https://github.com/edspencer/herdctl/pull/173 |

### Cleanup (after PRs are merged)
  rm -rf ~/Code/herdctl-issues/issue-101
  rm -rf ~/Code/herdctl-issues/issue-102
```

If any worker failed (non-zero exit code or no PR created), note it in the Result column and suggest checking the JSONL session file for details.
</step>

</process>

<worker_prompt_template>
You are fixing GitHub issue #{{NUMBER}} for the herdctl project.

**Issue:** {{TITLE}}

**Description:**
{{BODY}}

You are in a fresh clone of the repository on branch `fix/issue-{{NUMBER}}`. Dependencies are already installed.

## Instructions

Follow these steps in order:

### 1. Understand the project
Read the project's CLAUDE.md at the repo root to understand conventions, architecture, and quality gates.

### 2. Explore the relevant code
Search the codebase to understand the code paths related to this issue. Use Glob and Grep to find relevant files, then Read them to understand the implementation.

### 3. Implement the fix
Make the necessary code changes. Keep changes focused and minimal — fix the issue without unnecessary refactoring.

### 4. Run quality gates
Run all three quality checks and fix any failures before proceeding:
```bash
pnpm typecheck
pnpm test
pnpm build
```
If any check fails, fix the issue and re-run until all three pass.

### 5. Create a changeset
If you modified code in any package under `packages/`, you MUST create a changeset file. Determine the correct package name(s) and bump type:
- `patch` for bug fixes
- `minor` for new features
- `major` for breaking changes

Create the changeset file directly:
```bash
cat > .changeset/issue-{{NUMBER}}.md << 'CHANGESET_EOF'
---
"@herdctl/PACKAGE_NAME": patch
---

Brief description of what was fixed
CHANGESET_EOF
```
Replace PACKAGE_NAME with the actual package (core, cli, web, chat, discord, slack) and adjust the bump type.

### 6. Commit
Stage ONLY the files you changed — never use `git add -A` or `git add .`:
```bash
git add <specific files>
```

Commit with a conventional commit message:
```bash
git commit -m "fix: <concise description of the fix>

Fixes #{{NUMBER}}

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### 7. Push and create PR
Push the branch and create a pull request:
```bash
git push -u origin fix/issue-{{NUMBER}}
```

Then create the PR:
```bash
gh pr create --title "fix: <description> (#{{NUMBER}})" --body "$(cat <<'PR_EOF'
## Summary
<1-3 bullet points describing what was changed and why>

Fixes #{{NUMBER}}

## Test plan
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm build` succeeds

🤖 Generated with [Claude Code](https://claude.com/claude-code)
PR_EOF
)"
```

## Important rules
- NEVER use `git add -A` or `git add .` — stage specific files only
- NEVER skip quality gates — all three must pass before committing
- ALWAYS create a changeset if package code was modified
- Keep changes minimal and focused on the issue
</worker_prompt_template>

<success_criteria>
- [ ] All issue numbers parsed and validated
- [ ] All issues fetched from GitHub and confirmed open
- [ ] Repo cloned to ~/Code/herdctl-issues/issue-<N>/ for each issue
- [ ] Fix branch created and dependencies installed in each clone
- [ ] Claude Code worker launched in each clone with correct prompt
- [ ] Workers monitored every 60 seconds with progress updates shown
- [ ] Final summary reported with PR links for each issue
</success_criteria>
