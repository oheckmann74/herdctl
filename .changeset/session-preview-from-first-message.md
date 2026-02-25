---
"@herdctl/core": patch
"@herdctl/web": patch
---

Populate session preview from first user message instead of showing "New conversation"

Sessions without a custom name or auto-generated summary now display the first user message text (truncated to 100 chars) in the sidebar and All Chats page. Previews are cached in the session metadata store with mtime-based invalidation.
