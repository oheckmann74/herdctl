---
"@herdctl/web": patch
---

Fix sidebar session lists not refreshing after chat:complete for existing or externally-created sessions

- Always refresh sidebar sessions (Fleet tab) on any chat:complete event, not just new chats
- Also refresh recent sessions (Chats tab) on any chat:complete event
- Add 2-second debounce to prevent rapid refreshes during multi-turn conversations
- Sessions created from CLI, Discord, Slack, or other browser tabs now appear without requiring a page reload