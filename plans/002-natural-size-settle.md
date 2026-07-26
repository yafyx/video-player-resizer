# Plan 002: Make the late-layout re-measure actually update the player's original size

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in the "STOP conditions" section occurs, stop and report — do
> not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: this repo's work lives in the *uncommitted working
> tree* on top of commit `0f7b549`, so diffing against a SHA proves nothing.
> Open `utils/resize.ts` and confirm lines 633–670 match the "Current state"
> excerpt below. On a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: working tree on commit `0f7b549`, 2026-07-26

## Why this matters

The content script deliberately re-measures the player 1.2 seconds after mount,
because web fonts, lazy images and late CSS routinely change a player's box after
first paint. That re-measure is currently a no-op: the overlay caches each
player's "natural" size on first attach and unconditionally prefers the cached
value, so the fresh measurement is computed and thrown away.

The cost is user-visible and quiet. `naturalWidth`/`naturalHeight` are the base
that every size preset multiplies (`100%`, `150%`, …) and the exact box that
"Reset to original size" restores. If the first measurement happened before
layout settled, every preset is scaled from a wrong number and reset restores the
player to a size it never had. Nothing errors — it just silently does the wrong
arithmetic.

## Current state

Files involved:

- `utils/resize.ts` — owns the overlay; `attach()` and the `naturals` cache.
- `entrypoints/content.ts` — schedules the settle re-measure at line 298.

The cache declaration, `utils/resize.ts:80-86`:

```ts
  /**
   * Sizes are per media element and survive switching between players on the
   * same page -- hovering a second video must not silently undo the first one.
   * `naturals` caches each player's pre-resize box, because re-measuring after a
   * resize would treat our own value as the original.
   */
  const sessions = new Map<HTMLElement, SizingSession>();
  const naturals = new Map<HTMLElement, { width: number; height: number }>();
```

The bug, `utils/resize.ts:633-670` — note that `natural` is only ever written
when the map has no entry, so a re-attach can never correct it:

```ts
  function attach(next: DetectedPlayer): void {
    if (destroyed) return;
    if (drag) endDrag(false);

    // Drop players that a SPA navigation removed, so the maps don't grow forever.
    for (const core of sessions.keys()) {
      if (!core.isConnected) {
        sessions.delete(core);
        naturals.delete(core);
      }
    }

    let natural = naturals.get(next.core);
    if (!natural) {
      natural = { width: next.naturalWidth, height: next.naturalHeight };
      naturals.set(next.core, natural);
    }

    let session = sessions.get(next.core);
    if (!session) {
      session = createSizingSession(
        { target: next.target, descendants: next.descendants },
        { allowOverflow: settings.allowOverflow },
      );
      sessions.set(next.core, session);
    }

    player = { ...next, naturalWidth: natural.width, naturalHeight: natural.height };
    sizing = session;

    const rect = player.target.getBoundingClientRect();
    size = session.isApplied
      ? { width: Math.round(rect.width), height: Math.round(rect.height) }
      : { ...natural };
```

The caller whose whole purpose this defeats, `entrypoints/content.ts:296-304`:

```ts
    // Re-describe the active player after late layout shifts (fonts, lazy images)
    // so the natural size we remember is the settled one.
    const settleTimer = setTimeout(() => {
      const current = watcher?.current();
      if (current && active() && !overlay?.isResized()) {
        mount(describePlayer(current.core));
      }
    }, 1200);
```

**The insight the fix rests on**: the cache exists to stop a *resized* player
being re-measured as its own original. That hazard only exists once a size has
been applied. While `session.isApplied` is `false`, whatever the player measures
right now **is** its natural size, so refreshing the cache is not only safe, it
is the correct behaviour.

`SizingSession.isApplied` is defined in `utils/sizing.ts`:

```ts
  /** True once `apply` has written anything. */
  readonly isApplied: boolean;
```

**Repo conventions to match**:

- Comments explain *why*, in full sentences. The block comment at
  `utils/resize.ts:74-79` is the house style.
- Tests are `vitest` + `jsdom` in `tests/`; overlay tests use `stubLiveRect` from
  `tests/helpers.ts`, which makes `getBoundingClientRect()` follow the element's
  inline pixel width/height.

## Commands you will need

| Purpose   | Command                          | Expected on success                      |
|-----------|----------------------------------|------------------------------------------|
| Typecheck | `npm run compile`                | exit 0, no output                        |
| Tests     | `npx vitest run`                 | all pass (85 before this plan's changes) |
| One file  | `npx vitest run tests/resize.test.ts` | all pass                            |
| Build     | `npx wxt build`                  | exit 0, prints "Finished in …"           |

## Scope

**In scope**:

- `utils/resize.ts`
- `tests/resize.test.ts`

**Out of scope**:

- `entrypoints/content.ts` — the settle timer there is already correct; it is the
  callee that is broken. Do not change the 1200ms delay, and do not "fix" this by
  adding a second timer.
- `utils/sizing.ts` — `isApplied` already exposes exactly what is needed.
- `utils/videoDetector.ts` — `describePlayer` already returns a fresh
  measurement; the loss happens after it returns.

## Git workflow

- Branch: `advisor/002-natural-size-settle`
- Single-commit repo, no established convention. Imperative subject, e.g.
  `Refresh cached natural size until the player is first resized`.
- Do NOT push or open a PR.

## Steps

### Step 1: Let an un-resized player's natural size be corrected

In `utils/resize.ts`, in `attach()`, replace this block (currently lines
645–649):

```ts
    let natural = naturals.get(next.core);
    if (!natural) {
      natural = { width: next.naturalWidth, height: next.naturalHeight };
      naturals.set(next.core, natural);
    }

    let session = sessions.get(next.core);
    if (!session) {
```

with:

```ts
    let session = sessions.get(next.core);

    // The cache exists to stop a player we already resized being re-measured as
    // its own original. That hazard only starts once a size has been applied --
    // until then, whatever the player measures now IS its natural size, so a
    // re-attach after late layout (fonts, lazy images) is allowed to correct an
    // earlier pre-layout measurement. A zero measurement means the player is
    // momentarily unrendered and is never worth recording.
    let natural = naturals.get(next.core);
    const measurable = next.naturalWidth > 0 && next.naturalHeight > 0;
    if (measurable && (!natural || !session?.isApplied)) {
      natural = { width: next.naturalWidth, height: next.naturalHeight };
      naturals.set(next.core, natural);
    } else if (!natural) {
      natural = { width: next.naturalWidth, height: next.naturalHeight };
      naturals.set(next.core, natural);
    }

    if (!session) {
```

Everything below (`session = createSizingSession(...)`, the `player = {...}`
assignment, the `size = session.isApplied ? … : …` line) stays exactly as it is.

Note the `let session` declaration moved *above* the natural-size block, because
the new condition reads `session?.isApplied`. Make sure you did not leave a
duplicate `let session = sessions.get(next.core);` behind — the typecheck will
catch it as a redeclaration.

**Verify**: `npm run compile` → exit 0, no output.

### Step 2: Confirm the existing "presets scale from the original" guarantee still holds

The suite already contains a test that pins the behaviour the cache was
protecting — `it('applies presets against the original size, not the current one', …)`
in `tests/resize.test.ts`. It resizes to 1280×720 and then re-attaches, expecting
`naturalWidth` to still be 640. Your change must not break it.

**Verify**: `npx vitest run tests/resize.test.ts` → all pass, no regressions.

### Step 3: Add the regression test for the bug this plan fixes

In `tests/resize.test.ts`, inside `describe('createResizeOverlay', ...)`, add:

```ts
  it('corrects the original size when layout settles after the first attach', () => {
    const media = document.createElement('video');
    // Pre-layout: the player briefly measures small (webfont/lazy-image reflow
    // has not happened yet).
    stubRect(media, { width: 320, height: 180 });
    document.body.appendChild(media);

    overlay = createResizeOverlay(
      { lockAspectRatio: false, allowOverflow: false },
      { onCommit: vi.fn() },
    );
    overlay.attach(describePlayer(media));
    expect(overlay.getPlayer()?.naturalWidth).toBe(320);

    // Layout settles; the content script re-attaches via its 1200ms settle timer.
    stubRect(media, { width: 960, height: 540 });
    overlay.attach(describePlayer(media));

    expect(overlay.getPlayer()?.naturalWidth).toBe(960);
    expect(overlay.getPlayer()?.naturalHeight).toBe(540);
  });

  it('ignores a zero measurement rather than recording it as the original', () => {
    const media = document.createElement('video');
    stubRect(media, { width: 640, height: 360 });
    document.body.appendChild(media);

    overlay = createResizeOverlay(
      { lockAspectRatio: false, allowOverflow: false },
      { onCommit: vi.fn() },
    );
    overlay.attach(describePlayer(media));

    // The player is momentarily unrendered (tab switch, display:none ancestor).
    stubRect(media, { width: 0, height: 0 });
    overlay.attach(describePlayer(media));

    expect(overlay.getPlayer()?.naturalWidth).toBe(640);
  });
```

`stubRect` is already imported at the top of `tests/resize.test.ts` alongside
`stubLiveRect`. Confirm the import line reads
`import { stubLiveRect, stubRect } from './helpers';` and add `stubRect` if it is
missing.

**Verify**: `npx vitest run tests/resize.test.ts` → all pass, including the 2 new
tests.

## Test plan

- New tests in `tests/resize.test.ts`, inside the existing
  `describe('createResizeOverlay', ...)` block:
  - **the regression**: attach at 320×180, re-attach after the rect grows to
    960×540 with no resize in between → `naturalWidth` becomes 960;
  - **the guard**: a 0×0 re-measure does not overwrite a good cached value.
- The existing `it('applies presets against the original size, not the current one', …)`
  is the counter-test that must keep passing — it covers the case where a size
  *has* been applied and the cache must win.
- Structural pattern: the existing
  `it('keeps a player sized after switching to another one on the page', …)` in
  the same file.
- Verification: `npx vitest run` → all pass, 87 total.

## Done criteria

- [ ] `npm run compile` exits 0
- [ ] `npx vitest run` exits 0 and reports 87 passing tests
- [ ] `npx wxt build` exits 0
- [ ] `it('applies presets against the original size, not the current one', …)`
      still passes (verify by name in the vitest output with
      `npx vitest run tests/resize.test.ts --reporter=verbose`)
- [ ] `git status --short` lists only `utils/resize.ts` and `tests/resize.test.ts`
      as modified relative to the state you started from
- [ ] `plans/README.md` status row for 002 updated to DONE

## STOP conditions

Stop and report back (do not improvise) if:

- `utils/resize.ts:633-670` does not match the "Current state" excerpt.
- `SizingSession` no longer exposes `isApplied` — the whole fix keys off it.
- The existing preset test fails after your change. That means the cache is now
  being refreshed for an *applied* session, which is the original hazard; report
  it rather than deleting or relaxing that test.
- You find yourself needing to change `entrypoints/content.ts` to make this work.
  The settle timer is already correct; needing to touch it means the diagnosis in
  this plan is wrong and you should report that.

## Maintenance notes

- The two branches of the new conditional collapse to the same body and could be
  merged; they are written separately because the second one (`!natural`) is the
  first-attach case and the first is the settle case, and a future reader
  changing one should not silently change the other. If you merge them, keep the
  comment.
- A reviewer should confirm `let session` was hoisted rather than duplicated, and
  that `size = session.isApplied ? … : …` further down still reads the *same*
  `session` binding.
- Interacts with plan 007 (detection sweep bounding): if the settle timer is ever
  removed or its trigger changes, this fix stops having a caller and the cache
  refresh becomes dead — the two should be reviewed together.
- Deferred: nothing here reacts to layout changes *after* the 1.2s mark. A
  `ResizeObserver`-driven refresh would be strictly better and is a natural
  follow-on to plan 006, which introduces one.
