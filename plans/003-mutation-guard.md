# Plan 003: Make the detector's self-mutation guard actually match our own DOM writes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise. When
> done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: this repo's work lives in the *uncommitted working
> tree* on top of commit `0f7b549`. Open `utils/videoDetector.ts` and confirm
> lines 367–382 match the "Current state" excerpt below. On a mismatch, treat it
> as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: working tree on commit `0f7b549`, 2026-07-26

## Why this matters

The player detector runs a `MutationObserver` over the whole document and has a
guard intended to ignore mutations caused by the extension's own overlay. The
guard tests `record.target.id`, but for a `childList` mutation record the
`target` is the **parent** of the changed nodes — `document.documentElement` in
our case — never the overlay host itself. So the guard never matches and mounting
the overlay schedules a redundant full-document detection sweep.

Today the consequence is small: a deep DOM walk that finds the same player and is
discarded by an identity check. The reason to fix it is that it is a guard which
*reads* as protective and is not, sitting directly in front of the most expensive
operation in the extension. The next person to add `attributes: true` to that
observer — which is a plausible thing to want — turns a dead guard into an
infinite loop, because the overlay writes inline styles on the page constantly
while dragging.

## Current state

File: `utils/videoDetector.ts` — the detector and its observer.

`utils/videoDetector.ts:367-382`:

```ts
  const observer = new MutationObserver((records) => {
    // Ignore anything our own overlay did.
    for (const record of records) {
      const node = record.target as HTMLElement;
      if (node?.nodeType === 1 && (node.id === OVERLAY_HOST_ID || node.closest?.(`#${OVERLAY_HOST_ID}`))) {
        continue;
      }
      schedule();
      return;
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
```

Facts that make the fix correct:

- The overlay host is appended to `document.documentElement` — see
  `utils/resize.ts` in `attach()`:
  `document.documentElement.appendChild(host);`
- All of the overlay's own content lives inside a **shadow root**
  (`host.attachShadow({ mode: 'open' })` in `utils/resize.ts`), and mutations
  inside a shadow tree are not reported to an observer watching the light DOM.
  So the *only* self-mutations this observer can ever see are the host being
  added or removed.
- `OVERLAY_HOST_ID` is exported from `utils/constants.ts` as
  `'video-resizer-overlay-root'` and is already imported at the top of
  `utils/videoDetector.ts`.

**Repo conventions**: comments explain *why* in full sentences; small named
predicate functions are used freely (see `isKnownEmbed`, `matchesSiteHint` in the
same file).

## Commands you will need

| Purpose   | Command                                    | Expected on success |
|-----------|--------------------------------------------|---------------------|
| Typecheck | `npm run compile`                          | exit 0, no output   |
| Tests     | `npx vitest run`                           | all pass (85 baseline) |
| One file  | `npx vitest run tests/videoDetector.test.ts` | all pass          |
| Build     | `npx wxt build`                            | exit 0              |

## Scope

**In scope**:

- `utils/videoDetector.ts`
- `tests/videoDetector.test.ts`

**Out of scope**:

- Do **not** add `attributes: true` to the observer options. The overlay writes
  inline styles on page elements on every drag frame; observing attributes would
  feed those writes straight back into detection. If you believe attribute
  observation is needed, that is a STOP condition, not a change to make here.
- `utils/resize.ts` — the overlay's DOM placement is correct as-is.
- The 250ms debounce in `schedule()` — unrelated, and plan 007 covers sweep cost.

## Git workflow

- Branch: `advisor/003-mutation-guard`
- Imperative subject, e.g. `Match overlay mutations by added/removed node`.
- Do NOT push or open a PR.

## Steps

### Step 1: Replace the guard with one that inspects the changed nodes

In `utils/videoDetector.ts`, directly above the `const observer = new MutationObserver(...)`
line, add a named predicate:

```ts
  /**
   * True when a record describes nothing but our own overlay host being added or
   * removed. For a childList record the `target` is the *parent* of the change --
   * `document.documentElement` in our case -- so matching on the target's id can
   * never work. Everything else the overlay does happens inside its shadow root,
   * which this observer cannot see at all.
   */
  const isOwnMutation = (record: MutationRecord): boolean => {
    const touched = [...record.addedNodes, ...record.removedNodes];
    if (touched.length === 0) return false;
    return touched.every(
      (node) => node instanceof Element && node.id === OVERLAY_HOST_ID,
    );
  };
```

Then replace the observer callback body:

```ts
  const observer = new MutationObserver((records) => {
    if (records.every(isOwnMutation)) return;
    schedule();
  });
```

Leave `observer.observe(document.documentElement, { childList: true, subtree: true })`
exactly as it is.

**Verify**: `npm run compile` → exit 0, no output.

### Step 2: Add tests for both directions of the guard

`tests/videoDetector.test.ts` already has a
`describe('observeVideoPlayers', ...)` block with `beforeEach`/`afterEach` that
clears the body and stops the watcher. Add two tests to it.

`MutationObserver` callbacks are delivered as microtasks and the detector
debounces by 250ms, so drive them explicitly with real timers rather than
`vi.useFakeTimers()` (jsdom's microtask delivery is not reliably faked):

```ts
  it('ignores the overlay host being added to the page', async () => {
    const el = video({ width: 640, height: 360 });
    document.body.appendChild(el);

    const onChange = vi.fn();
    watcher = observeVideoPlayers({ onChange, onLost: vi.fn() });
    expect(onChange).toHaveBeenCalledTimes(1); // the initial synchronous run

    const host = document.createElement('div');
    host.id = 'video-resizer-overlay-root';
    document.documentElement.appendChild(host);

    await new Promise((resolve) => setTimeout(resolve, 400));

    // No re-detection: our own mount must not schedule a document sweep.
    expect(onChange).toHaveBeenCalledTimes(1);
    host.remove();
  });

  it('still reacts to a genuine page mutation', async () => {
    const first = video({ width: 640, height: 360 });
    document.body.appendChild(first);

    const onChange = vi.fn();
    watcher = observeVideoPlayers({ onChange, onLost: vi.fn() });
    expect(onChange).toHaveBeenCalledTimes(1);

    const second = video({ width: 1280, height: 720 });
    document.body.appendChild(second);

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][0].core).toBe(second);
  });
```

`video(...)` is the existing local helper at the top of
`tests/videoDetector.test.ts`; `observeVideoPlayers`, `vi` and the `watcher`
variable are already in scope in that describe block.

**Verify**: `npx vitest run tests/videoDetector.test.ts` → all pass, including
the 2 new tests. These two tests take ~0.8s combined because of the real
timeouts; that is expected.

## Test plan

- New tests in the existing `describe('observeVideoPlayers', ...)` block of
  `tests/videoDetector.test.ts`:
  - **the regression**: appending an element with `id="video-resizer-overlay-root"`
    to `documentElement` does not trigger a re-detection;
  - **the counter-test**: appending a real, larger video *does* trigger one —
    proving the new guard did not over-match and disable detection entirely.
- Structural pattern: the existing
  `it('switches when a genuinely different element becomes the best candidate', …)`
  in the same block, extended with a real-timer await for the debounce.
- Verification: `npx vitest run` → all pass, 87 total.

## Done criteria

- [ ] `npm run compile` exits 0
- [ ] `npx vitest run` exits 0 and reports 87 passing tests
- [ ] `npx wxt build` exits 0
- [ ] `grep -n "record.target" utils/videoDetector.ts` returns no matches
- [ ] `grep -n "attributes: true" utils/videoDetector.ts` returns no matches
- [ ] `git status --short` lists only `utils/videoDetector.ts` and
      `tests/videoDetector.test.ts` as modified relative to your starting state
- [ ] `plans/README.md` status row for 003 updated to DONE

## STOP conditions

Stop and report back if:

- `utils/videoDetector.ts:367-382` does not match the "Current state" excerpt.
- The overlay host is no longer appended to `document.documentElement` (check
  `attach()` in `utils/resize.ts`) — if it moved inside `body` or inside another
  element, the guard's assumptions need re-deriving.
- The second test ("still reacts to a genuine page mutation") fails. That means
  the new guard suppresses real mutations, which is far worse than the bug being
  fixed. Report it; do not weaken the test.
- Either new test is flaky across three consecutive runs. Real-timer tests that
  race are worse than no tests — report rather than adding retries.

## Maintenance notes

- If anyone later adds `attributes: true` to this observer, `isOwnMutation` must
  be extended: attribute records have empty `addedNodes`/`removedNodes`, so the
  predicate returns `false` and every inline style the overlay writes during a
  drag would schedule a sweep. That is the loop this guard is really protecting
  against.
- A reviewer should check that `records.every(isOwnMutation)` is not accidentally
  written as `.some(...)`, which would suppress all detection whenever a batch
  happened to include our host.
- Interacts with plan 007, which changes what happens *after* `schedule()` fires.
  These are independent but touch adjacent lines; land one before starting the
  other to keep the diffs readable.
