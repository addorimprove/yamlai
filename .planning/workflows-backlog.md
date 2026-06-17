# Workflows — What's Left To Build

As of 2026-06-17. Everything below is planned-for-later, not yet built.

## Still to do

| # | Feature | In plain words | Why it's not done yet |
|---|---|---|---|
| 1 | Branching | Let a workflow pick which step(s) to run based on a yes/no check. | Not designed yet. Heads up: the engine runs *every* branch whose check passes, not just the first one. |
| 2 | Early error checks | Catch mismatched inputs/outputs between steps when you build, instead of when you run. | The builder copies your code files as-is and can't see inside them to check shapes ahead of time. |
| 3 | Richer loop bodies | Allow a loop to run several steps at once (in parallel) or a loop inside a loop. | Today a loop body only runs steps one after another. |
| 4 | Advanced input/output | Support complex data shapes (nested objects, etc.) that the simple YAML format can't describe. | The current format only handles simple fields. |
| 5 | Pause & resume | Let a workflow stop to wait for a human, then continue later. | Needs storage set up; not started. |
| 6 | "Check my file" command | A command that validates a project and reports problems without generating anything. | Future convenience tool; not started. |

## Already done (for reference)

| Feature | Status |
|---|---|
| Run steps in order | Done |
| Run steps at the same time (parallel) | Done |
| Attach workflows to an agent | Done |
| Custom reusable steps | Done |
| Loops (repeat until / while / for-each item) | Done |
| Loops with a max number of tries | Done |
| Loops that run several steps each round | Done |
