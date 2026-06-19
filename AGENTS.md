# AGENTS.md

## Project Positioning

This project is an internal small project. Prioritize efficiency, stability, and delivery speed. 

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 5. Development Workflow

### Local verification

- Use Node.js 22 or later and install the locked dependencies with `npm ci`.
- Run `npm run check` before submitting changes. For focused development, run the narrowest relevant script first, then run the full check.
- Start the local Worker with `npm run dev`; verify the HTTP boundary with `curl http://127.0.0.1:8787/healthz`.
- Never commit or log `DEEPSEEK_API_KEY`, `ADAPTER_BEARER_TOKEN`, `RESPONSE_ID_SECRET`, prompts, tool outputs, or reasoning content.

### Issue workflow

1. Check the MVP-C Epic and `docs/开发路线图.md` for duplicates and dependencies before starting work. Do not implement placeholder work while a `Blocked by #...` dependency remains open.
2. Define the goal, deliverables, acceptance criteria, dependencies, phase label, milestone, and owner in the issue. Use `phase:discovery`, `phase:foundation`, `phase:mvp-a`, `phase:mvp-b`, `phase:mvp-c`, or `phase:release`; add all MVP-C work to the `MVP-C` milestone.
3. Create `codex/issue-<number>-<short-name>` from the latest `main`, then post the implementation plan to the issue.
4. Record blockers, external-contract conclusions, scope changes, and acceptance evidence in the issue. Add new work to both the Epic checklist and roadmap index.

### Pull request workflow

1. Keep one issue per pull request unless the issue is an Epic. Use `Closes #<number>` in the PR body.
2. Open a Draft PR after the first reviewable commit and complete `.github/pull_request_template.md`.
3. Include the actual typecheck, test, fixture, and Codex E2E commands and results. Update protocol fixtures when behavior changes; call out Durable Object schema, secret, or compatibility-date changes.
4. Mark the PR ready only after its dependencies are closed, acceptance criteria have evidence, and CI passes. Resolve review feedback on the same PR.
5. Merge only a currently reviewed head with passing CI. After merge, verify issue closure and synchronize the Epic, roadmap, and active design documents. If implementation differs from the technical design, record the decision and update the design in the same PR.

### Active documentation

- Keep only documents that guide the current implementation at the root of `docs/`.
- Move superseded proposals, challenge reports, and reviews to `docs/archive/`, and repair references from active documents.
- Treat archived documents as history, not implementation guidance.
