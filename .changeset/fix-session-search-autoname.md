---
"@herdctl/web": patch
---

Fix session search to include autoName field and deduplicate search logic. Sessions with only autoName (no customName) are now searchable. Extracted sessionMatchesQuery to shared utility to prevent duplication.
