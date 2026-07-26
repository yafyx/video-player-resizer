# Plan 007: Only sweep the document when a mutation could plausibly have added a player

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result. If anything in "STOP
> conditions" occurs, stop and report — do not improvise. When done, update the
> status row in `plans/README.md`.
>
> **Drift check (run first)**: work lives in the *uncommitted working tree* on
> commit `0f7b549`. Confirm `utils/videoDetector.ts` lines 340–383 match the
> excerpts below. On a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED — a wrong filter means players stop being detected
- **Depends on**: `plans/005-content-script-tests.md`, and land
  `plans/003-mutation-guard.md` first (adjacent lines)
- **Category**: perf
- **Planned at**: working tree on commit `0f7b549`, 2026-07-26

## Why this matters

The detector observes `document.documentElement` with `subtree: true` and, on any
mutation anywhere on the page, schedules a **full document sweep**:
`collectMediaElements()` walks up to 25,000 elements, descends into every open
shadow root and same-origin frame, then runs `getBoundingClientRect()` and
`getComputedStyle()` on each candidate. On a feed, a chat app, or any React page
re-rendering a list, that fires after every pause in activity, forever, on a page
the extension does not own.

There is a correctness bug hiding inside the same code. The 250ms debounce is
**trailing-only**: each mutation clears the pending timer and starts a new one.
On a page that never stops mutating — a live scoreboard, an autoplaying feed, a
progress bar — the sweep is postponed indefinitely and the player may never be
detected at all. That is very plausibly a real cause of "it doesn't work on this
site" reports.

## Current state

File: `utils/videoDetector.ts`.

The debounce, around lines 355–365:

```ts
  function schedule(): void {
    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      run();
    }, 250);
  }
```

The observer and its subscription, lines 367–383 (this is the **post-plan-003**
shape; if plan 003 has not landed the callback body differs — see STOP
conditions):

```ts
  const observer = new MutationObserver((records) => {
    if (records.every(isOwnMutation)) return;
    schedule();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
```

What `run()` ultimately triggers, via `detectVideoPlayer()` →
`collectMediaElements()` — the budget constant is in `utils/constants.ts`:

```ts
/** Node budget for the shadow-DOM-piercing document walk. */
export const DEEP_QUERY_NODE_BUDGET = 25_000;
```

**Key observation**: the observer is registered with `childList: true` only (no
`attributes`, no `characterData`). Every record therefore carries `addedNodes` /
`removedNodes`, and a player can only *appear* via an added node. So the question
"could this batch have introduced a player?" is answerable by inspecting the
added subtrees alone — which are small — instead of the whole document.

**Repo conventions**: small named predicates (`isKnownEmbed`, `matchesSiteHint`,
`isOwnMutation`); comments explain *why* in full sentences.

## Commands you will need

| Purpose   | Command                                      | Expected on success |
|-----------|----------------------------------------------|---------------------|
| Typecheck | `npm run compile`                            | exit 0              |
| Tests     | `npx vitest run`                             | all pass            |
| One file  | `npx vitest run tests/videoDetector.test.ts` | all pass            |
| Build     | `npx wxt build`                              | exit 0              |

## Scope

**In scope**:

- `utils/videoDetector.ts`
- `tests/videoDetector.test.ts`

**Out of scope**:

- `DEEP_QUERY_NODE_BUDGET` in `utils/constants.ts` — lowering the budget would
  make detection *incorrect* on large pages. The fix is sweeping less often, not
  sweeping less thoroughly.
- `collectMediaElements` itself — the walk is fine; its call frequency is not.
- `entrypoints/content.ts`.

## Git workflow

- Branch: `advisor/007-bound-detection-sweep`
- Imperative subject, e.g. `Sweep only when a mutation adds candidate media`.
- Do NOT push or open a PR.

## Steps

### Step 1: Give the debounce a maximum wait

Replace `schedule()`:

```ts
  /** Longest we will postpone a sweep, however busy the page stays. */
  const MAX_DEBOUNCE_MS = 1000;
  let firstDeferredAt = 0;

  function schedule(): void {
    const now = performance.now();
    if (debounce === null) firstDeferredAt = now;

    // A purely trailing debounce never fires on a page that never goes quiet --
    // a live feed or a running progress bar would postpone detection forever.
    if (now - firstDeferredAt >= MAX_DEBOUNCE_MS) {
      if (debounce !== null) clearTimeout(debounce);
      debounce = null;
      firstDeferredAt = 0;
      run();
      return;
    }

    if (debounce !== null) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      firstDeferredAt = 0;
      run();
    }, 250);
  }
```

**Verify**: `npm run compile` → exit 0. `npx vitest run` → all pass.

### Step 2: Only schedule when an added subtree could contain media

Add a predicate next to `isOwnMutation`:

```ts
  /**
   * Could this batch have introduced a player? With `childList: true` and no
   * attribute observation, media can only *appear* via an added node, so the
   * added subtrees answer it -- and they are tiny compared with the whole
   * document. Removals are checked too, because losing the active player has to
   * be noticed.
   */
  const mayAffectPlayers = (record: MutationRecord): boolean => {
    if (record.removedNodes.length > 0) return true;

    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      const tag = node.tagName;
      if (tag === 'VIDEO' || tag === 'IFRAME') return true;
      if (node.querySelector('video, iframe')) return true;
      // A shadow host can hide media the selector above cannot reach.
      if (node.shadowRoot) return true;
    }

    return false;
  };
```

Then use it in the observer callback:

```ts
  const observer = new MutationObserver((records) => {
    if (records.every(isOwnMutation)) return;
    if (!records.some(mayAffectPlayers)) return;
    schedule();
  });
```

**Verify**: `npm run compile` → exit 0. `npx vitest run tests/videoDetector.test.ts`
→ all pass, including the plan-003 test
`it('still reacts to a genuine page mutation', …)`, which appends a `<video>` and
must still trigger detection.

### Step 3: Prove the filter does not suppress real detections

The risk of this change is entirely one-directional: over-filtering means the
extension silently stops working. Add both directions as tests (see Test plan),
then run the full suite.

**Verify**: `npx vitest run` → all pass.

## Test plan

New tests in the existing `describe('observeVideoPlayers', …)` block of
`tests/videoDetector.test.ts`. They use real timers and a ~400ms await, matching
the tests plan 003 added to the same block:

- **Filter does not fire on irrelevant DOM churn**: append a `<p>` with text; after
  400ms, `onChange` call count is unchanged from the initial synchronous run.
- **Filter fires for a directly-added video**: append a `<video>` (larger than the
  existing one, so it wins scoring); `onChange` is called again with the new
  element as `core`.
- **Filter fires for a video nested inside an added wrapper**: append a
  `<div><div><video/></div></div>`; detection still happens. This is the case a
  naive `tagName`-only check would miss and is the single most likely way to
  break real sites.
- **Filter fires for an added shadow host**: append a host element with an open
  shadow root containing a video; detection still happens.
- **Removal is noticed**: remove the active player; `onLost` fires.

Structural pattern: `it('ignores the overlay host being added to the page', …)`
from plan 003 in the same block.

Verification: `npx vitest run` → all pass, 102 total (97 after plan 006 + 5).

## Done criteria

- [ ] `npm run compile` exits 0
- [ ] `npx vitest run` exits 0 and reports 102 passing tests
- [ ] `npx wxt build` exits 0
- [ ] `grep -n "MAX_DEBOUNCE_MS" utils/videoDetector.ts` returns a match
- [ ] `grep -n "mayAffectPlayers" utils/videoDetector.ts` returns at least 2 matches
- [ ] `git diff utils/constants.ts` is empty (the node budget was not touched)
- [ ] `git status --short` lists only `utils/videoDetector.ts` and
      `tests/videoDetector.test.ts`
- [ ] `plans/README.md` status row for 007 updated to DONE

## STOP conditions

Stop and report back if:

- Plan 003 has not landed — the observer callback in "Current state" will not
  match, and layering this on top of the old broken guard makes both harder to
  reason about.
- Plan 005 has not landed (`tests/content.test.ts` missing). Detection changes
  need the orchestration net.
- Any nested-media test fails. That means the filter is too narrow and would
  break real sites; report the exact DOM shape that slipped through rather than
  loosening the filter until tests pass.
- You are tempted to add `attributes: true` to catch `src` being set on an
  existing `<iframe>`. That is a real gap (see Maintenance notes) but it needs
  its own plan with its own loop analysis — the overlay writes inline styles
  constantly during a drag.

## Maintenance notes

- **Known remaining gap**: a page that inserts an empty `<iframe>` and later sets
  its `src` produces no qualifying childList record for the second step, so the
  embed is only found on the next unrelated mutation or via the existing
  `loadedmetadata` / `play` / `canplay` capture listeners. Those media events
  cover `<video>` but not iframes. If iframe-embed detection proves flaky in the
  field, that is the thing to investigate — and the fix is a *scoped* attribute
  observer (`attributeFilter: ['src']`), never blanket attribute observation.
- `MAX_DEBOUNCE_MS` and the 250ms quiet period are a pair. Raising the quiet
  period without raising the max just makes the max the only path that ever
  fires.
- A reviewer should scrutinise `mayAffectPlayers` hardest: it is the single point
  where over-filtering turns into a silent product failure with no error anywhere.
