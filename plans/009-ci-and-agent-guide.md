# Plan 009: Run the quality gates automatically and document the repo for agents

> **Executor instructions**: Follow this plan step by step. Run every
> verification command. If anything in "STOP conditions" occurs, stop and report.
> When done, update the status row in `plans/README.md`.
>
> **Drift check (run first)**: work lives in the *uncommitted working tree* on
> commit `0f7b549`. Confirm `ls .github` reports no such directory and that
> `package.json` has no `format` script. On a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (best landed after `plans/005-content-script-tests.md`, so
  CI protects the orchestration tests too)
- **Category**: dx
- **Planned at**: working tree on commit `0f7b549`, 2026-07-26

## Why this matters

The repo has three working verification commands — `npm run compile`,
`npx vitest run`, `npx wxt build` — and nothing runs them except a human who
remembers to. There is no CI, no formatter, and no `CLAUDE.md`/`AGENTS.md`. For a
codebase whose remaining plans are written to be executed by agents, the agent
guide is the highest-leverage file in this plan: every executor otherwise
rediscovers the commands, the layout, and the conventions from scratch, and some
of them guess wrong.

Formatting is included because it is nearly free here (one dev dependency, one
config, one script) and it removes an entire category of review noise. Linting is
deliberately **not** included — see Maintenance notes for the reasoning.

## Current state

- No `.github/` directory: `ls -a .github` → no such file or directory.
- No `CLAUDE.md`, no `AGENTS.md`, no `CONTRIBUTING.md`. `README.md` exists and
  documents architecture and usage, but not conventions or commands-for-agents.
- `package.json` scripts today:

```json
  "scripts": {
    "dev": "wxt",
    "dev:firefox": "wxt -b firefox",
    "build": "wxt build",
    "build:firefox": "wxt build -b firefox",
    "zip": "wxt zip",
    "zip:firefox": "wxt zip -b firefox",
    "compile": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "postinstall": "wxt prepare"
  },
```

- Package manager: **bun** (`bun.lock` is present; there is no
  `package-lock.json`, which is why `npm audit` cannot run here).
- Runtime deps: `react`, `react-dom`. Dev deps include `wxt`, `vitest`, `jsdom`,
  `typescript`, `@wxt-dev/module-react`.
- Repo layout: `entrypoints/` (background, content, popup), `utils/` (all logic),
  `tests/` (vitest + jsdom), `public/` (icons).

## Commands you will need

| Purpose   | Command                | Expected on success |
|-----------|------------------------|---------------------|
| Install   | `bun install`          | exit 0              |
| Typecheck | `npm run compile`      | exit 0              |
| Tests     | `npx vitest run`       | all pass            |
| Build     | `npx wxt build`        | exit 0              |
| Format    | `npm run format:check` | exit 0 (after step 2) |

## Scope

**In scope**:

- `.github/workflows/ci.yml` (create)
- `CLAUDE.md` (create)
- `.prettierrc.json` (create)
- `.prettierignore` (create)
- `package.json` (scripts + one devDependency)

**Out of scope**:

- Any source file under `utils/`, `entrypoints/`, or `tests/`. If Prettier wants
  to reformat them, that is step 3's decision to record — **do not** commit a
  repo-wide reformat as part of this plan; it would bury every other diff.
- ESLint and any lint configuration. Deliberately deferred, see Maintenance notes.
- Pre-commit hooks / husky. CI is the gate; local hooks are a preference.

## Git workflow

- Branch: `advisor/009-ci-and-agent-guide`
- Imperative subject, e.g. `Add CI, Prettier config and an agent guide`.
- Do NOT push or open a PR. (Note: a workflow file only takes effect once pushed;
  this plan adds it, it does not activate it.)

## Steps

### Step 1: Add the CI workflow

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main, master]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      # `postinstall` runs `wxt prepare`, which generates .wxt/tsconfig.json --
      # the typecheck below fails without it.
      - run: bun install --frozen-lockfile

      - name: Typecheck
        run: bun run compile

      - name: Test
        run: bun run test

      - name: Build
        run: bun run build
```

Bun is used because `bun.lock` is the only lockfile in the repo; using npm in CI
would resolve a different dependency tree than any developer has locally.

**Verify**: the workflow cannot be executed locally. Instead confirm it is
well-formed and that each command it runs works:
`node -e "require('fs').readFileSync('.github/workflows/ci.yml','utf8')"` → no
error, then run `npm run compile && npm run test && npm run build` → all exit 0.

### Step 2: Add Prettier with a config matching the existing code

Add the dev dependency: `bun add -d prettier`

Create `.prettierrc.json` — these values are read off the existing source, not
chosen fresh, so that formatting existing files is close to a no-op:

```json
{
  "printWidth": 100,
  "singleQuote": true,
  "trailingComma": "all",
  "semi": true,
  "arrowParens": "always"
}
```

Create `.prettierignore`:

```
.output
.wxt
node_modules
bun.lock
plans
```

Add two scripts to `package.json`:

```json
    "format": "prettier --write .",
    "format:check": "prettier --check .",
```

**Verify**: `npm run format:check` → it will list files that differ. Record the
count; do **not** run `npm run format` across the repo yet.

### Step 3: Decide on the formatting baseline, without a repo-wide reformat

Run `npm run format:check` and look at the output:

- **If it reports 0 files needing changes** — the config matches the existing
  style exactly. Add `- name: Format\n        run: bun run format:check` as a
  final step in `.github/workflows/ci.yml`, after Build.
- **If it reports files needing changes** — do **not** reformat them and do
  **not** add the CI step. Instead, record the exact count and the top three
  differing rules in your final report, and leave `format:check` available as a
  script only. A repo-wide reformat is a legitimate change but it must be its own
  commit on its own branch, reviewed on its own, or it will bury plans 001–008 in
  whitespace.

**Verify**: `npm run compile && npx vitest run && npx wxt build` → all exit 0
(proving the tooling additions changed no behaviour).

### Step 4: Write the agent guide

Create `CLAUDE.md` at the repo root:

```markdown
# Working in this repo

A browser extension (WXT + React 19 + TypeScript, Manifest V3) that puts drag
handles on the video on any page and resizes the media element itself.

## Commands

| Purpose   | Command             |
|-----------|---------------------|
| Install   | `bun install`       |
| Dev       | `bun run dev`       |
| Typecheck | `bun run compile`   |
| Tests     | `bun run test`      |
| Build     | `bun run build`     |

Package manager is **bun** (`bun.lock`); there is no npm lockfile. Always run
typecheck, tests and build before declaring work finished — all three are fast
(under 10 seconds combined).

## Layout

- `entrypoints/` — extension entrypoints. `content.ts` is the orchestrator
  (activation, mount/teardown, SPA navigation, popup message protocol);
  `background.ts` seeds settings; `popup/` is the React UI.
- `utils/` — all logic, one concern per file:
  - `videoDetector.ts` finds players and resolves which elements to resize
  - `sizing.ts` makes a size actually stick against hostile page CSS
  - `resize.ts` owns the overlay, drag handling and keyboard resizing
  - `theme.ts` derives the frame colour from the page palette, in OKLCH
  - `overlayStyles.ts` is the overlay's stylesheet, as a template string
  - `storage.ts`, `constants.ts`, `messages.ts` are shared plumbing
- `tests/` — vitest + jsdom. `helpers.ts` provides `stubRect` / `stubLiveRect`,
  because jsdom has no layout engine and `getBoundingClientRect()` always
  returns zeros.
- `plans/` — implementation plans. If you are executing one, follow it exactly
  and honour its STOP conditions.

## Conventions

- TypeScript strict. `as` casts only for DOM narrowing, never to silence a real
  type error.
- Comments explain **why**, in full sentences. Do not narrate what the code
  already says. See the block comment above `.chrome` in `utils/overlayStyles.ts`
  for the house style.
- Prefer small named predicates over inline boolean soup — see `isKnownEmbed`
  and `matchesSiteHint` in `utils/videoDetector.ts`.
- CSS in `overlayStyles.ts`: never `transition: all`; always name the properties.
  Only `opacity`, `transform` and `filter` are animated.
- Test names are full sentences describing behaviour, e.g.
  `it('treats a resize as the same player, not a new one', …)`.
- Never assume layout in tests — stub geometry via `tests/helpers.ts`.

## Things that will bite you

- The content script runs in the **top frame only**. A player inside a
  cross-origin iframe is resized by resizing the `<iframe>` element itself, not
  the video inside it.
- `<iframe>` elements accept child nodes but never render them, which is why the
  overlay is appended to `document.documentElement` and tracks the player's rect
  rather than being injected into it. Do not "simplify" that.
- Page CSS fights back. `utils/sizing.ts` writes every property with
  `!important` and neutralises `max-width` clamps, `aspect-ratio`, and the
  `padding-bottom: 56.25%` ratio hack. Removing any of those breaks real sites.
- Sites in `DEFAULT_OFF_HOSTS` (`utils/constants.ts`) ship with the extension
  disabled. If detection "does not work" on YouTube, that is the intended
  behaviour, not a bug.
- jsdom reports some CSS initial values incorrectly (e.g. `object-fit` computes
  as `contain` rather than `fill`). When a test disagrees with the browser,
  suspect jsdom before suspecting the code, and make the test state its starting
  condition explicitly.
```

**Verify**: `test -f CLAUDE.md && echo ok` → `ok`. Read the file back and confirm
every command in its table actually runs.

## Test plan

No new unit tests — this plan adds tooling and documentation, not behaviour. Its
verification is that the existing suite and build are untouched:

- `npx vitest run` → same test count and results as before this plan.
- `npx wxt build` → exit 0.
- Each command listed in `CLAUDE.md` executed once and confirmed to work. This
  matters more than it sounds: a wrong command in an agent guide is worse than no
  guide, because it will be trusted.

## Done criteria

- [ ] `.github/workflows/ci.yml` exists and every command inside it passes locally
- [ ] `CLAUDE.md` exists and each command in its table has been run successfully
- [ ] `.prettierrc.json` and `.prettierignore` exist
- [ ] `npm run format:check` runs (exit code recorded either way)
- [ ] `npm run compile` exits 0
- [ ] `npx vitest run` exits 0 with an unchanged test count
- [ ] `npx wxt build` exits 0
- [ ] `git status --short` shows no modifications under `utils/`, `entrypoints/`
      or `tests/`
- [ ] `plans/README.md` status row for 009 updated to DONE, recording whether the
      Format step was added to CI

## STOP conditions

Stop and report back if:

- `.github/` already exists with workflows in it — merge rather than overwrite,
  and that needs a look at what is already there.
- `bun` is not available in your environment. Report it; do **not** substitute
  `npm install`, which would generate a `package-lock.json` and give the repo two
  competing lockfiles.
- `bun add -d prettier` modifies `bun.lock` in ways that break `bun install --frozen-lockfile`.
- `npm run format:check` reports more than ~20 files needing changes. That means
  the config guessed wrong about the existing style; report the mismatch rather
  than reformatting the codebase to match a guess.

## Maintenance notes

- **Why no ESLint**: the codebase is strict TypeScript with no existing
  violations to clean up, and `tsc --noEmit` already catches the class of errors
  that matter most here. Adding `typescript-eslint` means a flat config, three or
  four dependencies, and a rule-tuning argument, in exchange for catching very
  little that this repo actually gets wrong. Revisit if a second contributor
  joins or if a real bug class appears that types cannot catch.
- The CI workflow triggers on `main` and `master`. This repo's branch is
  `master`; if it is renamed, update the workflow.
- `CLAUDE.md` is load-bearing for the remaining plans in `plans/`. When a
  convention changes — particularly anything in "Things that will bite you" —
  update it in the same commit, or the next executor will follow stale guidance
  with full confidence.
