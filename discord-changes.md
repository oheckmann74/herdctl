# Discord Connector Improvements — oheckmann74/herdctl Fork

This document covers Discord-related changes in the `oheckmann74/herdctl` fork compared to upstream. All changes are production-tested across three agents running on CLI runtime with Max plan pricing.

Changes are grouped by area: input handling, output control, UX polish, and core runtime fixes that unblock Discord features.

---

## Input: What agents can receive

### 1. File Attachments (User → Agent)

**Files:** `packages/discord/src/manager.ts`, `packages/discord/src/types.ts`, `packages/core/src/config/schema.ts`

**Problem:** Users couldn't send images, PDFs, or text files to agents via Discord. Attachments were silently ignored.

**Change:** Added full attachment processing pipeline:
- **Text files** (`.txt`, `.json`, `.csv`, etc.) are inlined directly into the prompt — up to 50,000 characters
- **Images and PDFs** are downloaded to a UUID-isolated directory so agents can access them via their Read tool
- **Automatic cleanup** after processing (configurable)
- Collision-safe: each message gets a UUID-based download directory, so concurrent messages with the same filenames don't conflict

```yaml
chat:
  discord:
    attachments:
      enabled: true
      max_files_per_message: 10
      max_file_size_mb: 10
      allowed_types: ["image/*", "application/pdf", "text/*", "application/json"]
      cleanup_after_processing: true
```

### 2. Voice Message Transcription

**Files:** New file `packages/discord/src/voice-transcriber.ts`, `packages/discord/src/manager.ts`, `packages/discord/src/discord-connector.ts`, `packages/core/src/config/schema.ts`

**Problem:** Discord voice messages (audio recordings sent inline in text channels) were silently ignored. Only an empty message came through to the agent.

**Change:** Added voice message detection and transcription:
- Detects Discord voice messages via `MessageFlags.IsVoiceMessage`
- Downloads the audio attachment
- Transcribes via OpenAI Whisper API using native `fetch` + `FormData` (Node 18+, no extra dependencies)
- Inserts the transcription as the message content, prefixed with `[Voice message transcription]:`

```yaml
chat:
  discord:
    voice:
      enabled: true
      api_key_env: OPENAI_API_KEY
      language: en  # optional ISO 639-1 code
```

### 3. Embed Content in Conversation Context

**File:** `packages/discord/src/mention-handler.ts`

**Problem:** The conversation context builder only read `message.content` — the plain text body of a Discord message. Discord embeds (structured content with titles, fields, descriptions) live in `message.embeds`, which was completely ignored. This meant embed-only messages (from herdctl hooks, link previews, other bots) were filtered out as "empty" and invisible to the agent.

The practical impact: scheduled jobs (cron, interval) run in isolated CLI sessions with no Discord channel context. The `after_run` hook posts their output to Discord as an embed. Without this fix, replying to a hook notification was a dead end — the agent couldn't see what it had reported.

**Change:** `processMessage()` now extracts text from embed titles, descriptions, and fields and appends it to the message content. Any embed in the channel history becomes part of the conversation context the agent sees.

---

## Output: What users see

### 4. Output Control: `assistant_messages` Enum

**Files:** `packages/discord/src/manager.ts`, `packages/core/src/config/schema.ts`

**Problem:** The original Discord output was extremely verbose — every assistant turn (including internal reasoning and tool-use planning) was posted to the channel. Two earlier attempts to fix this (`final_answer_only` + `concise_mode`) introduced complexity: message buffering, system prompt injection that degraded answer quality, and a "no additional output to share" fallback that confused users.

**Change:** Replaced both boolean flags with a single enum (`z.enum(["answers", "all"])`):

```yaml
chat:
  discord:
    output:
      assistant_messages: "answers"  # or "all"
```

- `"answers"` (default): Only send turns that contain NO `tool_use` blocks — pure text responses. This is the agent's actual answer.
- `"all"`: Send every turn that has text content, including reasoning during tool use.

**Why this is better:**
- No message buffering — answer turns are sent immediately
- No system prompt injection — the agent's normal behavior is preserved
- No fallback messages — if a turn has text and no tool use, it's an answer
- Simple mental model: you either want just answers or everything

### 5. Message Deduplication

**Files:** `packages/discord/src/manager.ts`, `packages/slack/src/manager.ts`

**Problem:** The CLI runtime streams output by appending to a JSONL session file. The session watcher picks up intermediate snapshots that have `stop_reason: null` and incomplete text. Neither the CLI runtime nor the SDK runtime deduplicates messages before passing them to the `onMessage` callback — chat managers receive every snapshot raw. Without filtering, these intermediates were sent to Discord as partial messages, causing duplicated or garbled output.

**Change:** Two-layer dedup in the chat manager's `onMessage` handler:
1. Skip intermediate JSONL snapshots where `stop_reason === null` (text may be incomplete)
2. Track finalized `message.id` values and skip duplicates (same turn delivered twice)

Applied to both Discord and Slack connectors.

### 6. File Upload (Agent → Discord)

**Files:** `packages/discord/src/discord-connector.ts`, `packages/discord/src/manager.ts`, `packages/core/src/runner/file-sender-mcp.ts`

**Problem:** Agents could receive files but not send them back. An agent that generates an image, PDF, or CSV had no way to deliver it to the Discord channel.

**Change:** Added `uploadFile()` method to `DiscordConnector` using Discord.js `AttachmentBuilder`. Wired through `FileSenderContext` and `createFileSenderDef` in the manager so agents can send files back to the originating channel via an injected MCP server (`herdctl-file-sender`). Files are buffered during tool execution and attached to the next answer message, so they appear below the text rather than as standalone messages above it. Mirrors existing Slack file upload support.

---

## UX Polish

### 7. Acknowledgement Emoji

**Files:** `packages/discord/src/manager.ts`, `packages/core/src/config/schema.ts`

**Problem:** When a user sends a message in Discord, there's no immediate feedback that the bot received it. The agent might take 10–30 seconds before the first response appears, leaving the user wondering if the message was seen.

**Change:** Bot reacts with a configurable emoji (default: eyes) on message receipt. The reaction is removed in the `finally` block when the job completes (whether it succeeds or fails), ensuring cleanup even on errors.

```yaml
chat:
  discord:
    output:
      acknowledge_emoji: "👀"
```

### 8. Progress Indicator

**Files:** `packages/discord/src/manager.ts`

**Problem:** With verbose output suppressed (`assistant_messages: "answers"`), users had no visibility into what the agent was doing. Long-running jobs (30s+) appeared frozen.

**Change:** Added an embed that updates in place as tools run. Tool names appear as they execute, throttled to 2-second intervals to avoid rate limits. The embed is deleted when the job completes.

```yaml
chat:
  discord:
    output:
      progress_indicator: true  # default: true
```

### 9. Visual Polish

**Files:** `packages/discord/src/manager.ts`, `packages/discord/src/commands/help.ts`, `reset.ts`, `status.ts`, `packages/discord/src/types.ts`

**Changes:**
- **Removed titles** from all embeds (progress, tool results, errors, status, summary) — cleaner look
- **Branded footer** on all embeds: `herdctl · agent-name`
- **Refined color palette:** soft violet for progress, emerald for success, cool gray for system, sky blue for commands
- **Compact tool results:** collapsed title + fields into a single description line
- **Horizontal result summary** with centered-dot separators instead of inline fields
- **Syntax highlighting** (`ansi`) for Bash tool output in tool result embeds
- **Styled slash commands** (`/help`, `/status`, `/reset`) as embeds instead of plain text
- Made `DiscordReplyEmbed.title` optional (was required)

### 10. Typing Indicator Control

**Files:** `packages/discord/src/manager.ts`, `packages/core/src/config/schema.ts`

**Problem:** Discord's typing indicator refreshes every 8 seconds via `setInterval` + `sendTyping()`. For long-running agent jobs (minutes to hours), this generates hundreds of unnecessary API calls. While errors from failed `sendTyping()` calls are caught silently, the cumulative API pressure contributes to rate limiting, especially when the bot is already handling other operations concurrently.

**Change:** Added a config option to disable the typing indicator entirely. The default remains enabled, which is fine for short interactions. Agents with long-running jobs benefit from disabling it.

```yaml
chat:
  discord:
    output:
      typing_indicator: false  # default: true
```

---

## Core Runtime Fixes (Discord-adjacent)

These changes live in `@herdctl/core` but were discovered and required by Discord usage.

### 11. `--mcp-config` Wrapper Key Fix

**File:** `packages/core/src/runner/runtime/cli-runtime.ts`

**Problem:** The CLI runtime passed MCP server configuration to `claude --mcp-config` as inline JSON without the required `mcpServers` wrapper key. The CLI expects `{"mcpServers": {...}}` (same shape as `.mcp.json` files). Without the wrapper, the Claude CLI hung indefinitely during startup — no error, no timeout, just a stuck process.

This was a latent bug in upstream. It never manifested because agents typically defined their MCP servers in workspace `.mcp.json` files rather than in the `mcp_servers` field of `agent.yaml`. Any agent that used `mcp_servers` in its herdctl config would have hit this hang.

**Change:** `JSON.stringify(mcpServers)` → `JSON.stringify({ mcpServers })`

### 12. Injected MCP Server Support for CLI Runtime

**File:** `packages/core/src/runner/runtime/cli-runtime.ts`

**Problem:** The file upload feature (#6) worked for SDK and Docker runtimes but silently failed for CLI runtime agents. The `FileSenderContext` MCP server was passed via `injectedMcpServers`, but CLI runtime completely ignored that field — it only supported static MCP servers from agent config.

**Root cause:** The SDK runtime can host MCP servers in-process (same Node.js process). The CLI runtime spawns `claude` as a separate subprocess — in-process handler closures can't cross the process boundary. The container runner already solved this for Docker by starting HTTP bridges (JSON-RPC over HTTP) and passing them as HTTP-type MCP servers. CLI runtime had no equivalent.

**Change:** Reused the existing `mcp-http-bridge.ts` infrastructure. When CLI runtime receives `injectedMcpServers`:

1. Starts an HTTP bridge for each injected server (random localhost port)
2. Merges them into `--mcp-config` as `type: "http"` servers pointing to `http://127.0.0.1:<port>/mcp`
3. Auto-adds `mcp__<name>__*` to `--allowedTools` if the agent has an allowlist
4. Sets `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT=120000` for file uploads (same value used by SDK and container runtimes)
5. Cleans up bridges in `finally` block when the CLI process exits

**Result:** File upload now works across all three runtimes — SDK, Docker, and CLI. The same `InjectedMcpServerDef` pattern works everywhere.

---

## Summary of Config Options Added

```yaml
chat:
  discord:
    output:
      assistant_messages: "answers"  # "answers" | "all"
      result_summary: true           # completion stats embed
      typing_indicator: true         # Discord typing indicator
      progress_indicator: true       # updating progress embed
      acknowledge_emoji: "👀"        # react on message receipt

    attachments:
      enabled: true
      max_files_per_message: 10
      max_file_size_mb: 10
      allowed_types: ["image/*", "application/pdf", "text/*", "application/json"]
      cleanup_after_processing: true

    voice:
      enabled: true
      api_key_env: OPENAI_API_KEY
      language: en
```
