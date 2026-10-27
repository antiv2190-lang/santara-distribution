---
name: create-skill
description: Turn a job we just completed together into a reusable skill. Use when I say "turn what we just did into a skill", "make this a skill", or "save this as a skill".
---

# Create a skill from the job we just did

1. Review the conversation: the goal, the tools/connectors used, the steps that worked, the corrections I made, and the rules I stated or implied.
2. Pick a short kebab-case name for the job.
3. Write `.claude/skills/<name>/SKILL.md` using `.claude/skills/_template/SKILL.md`:
   - Frontmatter `name` and a `description` that says what it does and the phrases that should trigger it.
   - Numbered steps in the order that worked, naming the exact tools used.
   - Every correction I made becomes an explicit rule.
   - Anything that must be approved before it goes out is marked "draft only, wait for approval".
4. Never copy secrets, API keys or personal data into the skill.
5. Show me the file, tell me what you inferred, and ask what's missing.
