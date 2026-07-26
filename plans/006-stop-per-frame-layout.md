# Plan 006: Stop forcing a layout on every animation frame while the pointer is over a player

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise. When
> done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: this repo's work lives in the *uncommitted working
> tree* on top of commit `0f7b549`. Open `utils/resize.ts` and confirm lines
> 222–256 and 720–731 match the "Current state" excerpts below. On a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — touches the code that keeps the frame visually glued to the player
- **Depends on**: `plans/005-content-script-tests.md`
- **Category**: perf
- **Planned at**: working tree on commit `0f7b549`, 2026-07-26

## Why this matters

While the frame is visible — which is the entire time a user's pointer rests over
a video — the overlay runs a self-perpetuating `requestAnimationFrame` loop. Each
iteration calls `getBoundingClientRect()`, a **forced synchronous layout**, then
writes four properties, whether or not anything moved. That is roughly 60 forced
layouts per second imposed on someone else's page, indefinitely, to keep a
selection rectangle in a position that changes on maybe three occasions.

The extension injects into every site. A cost like this is not paid on a demo
page you control; it is paid on the user's heaviest tab, competing with that
page's own rendering work. The fix drops the steady-state cost by roughly 15× and
keeps the 60fps loop for the one case that genuinely needs it — an in-progress
drag.

## Current state

File: `utils/resize.ts`.

The tracking core, `utils/resize.ts:222-256`:

```ts
  // ---- Rect tracking -----------------------------------------------------

  /** Height of the dimension badge plus its gap below the frame. */
  const BADGE_CLEARANCE = 26;

  function syncRect(): void {
    if (!player || !player.target.isConnected) return;
    const rect = player.target.getBoundingClientRect();
    frame.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
    frame.style.width = `${rect.width}px`;
    frame.style.height = `${rect.height}px`;

    // Figma hangs the size tag below the selection; near the bottom of the
    // viewport that would put it off screen, so it moves inside instead.
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    frame.dataset.badge =
      rect.bottom + BADGE_CLEARANCE > viewportHeight && rect.height > 48 ? 'inside' : 'below';
  }

  function tick(): void {
    rafId = null;
    syncRect();
    if (visible || drag) startLoop();
  }

  function startLoop(): void {
    if (rafId === null && !destroyed) rafId = requestAnimationFrame(tick);
  }

  function stopLoop(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }
```

`tick()` re-arms itself whenever `visible || drag` — `visible` is the problem
term.

The listeners already registered, `utils/resize.ts:722-731` — note that scroll
and resize already call `syncRect` directly, so two of the three real triggers
are covered:

```ts
  document.addEventListener('pointerover', onPointerOver, true);
  document.addEventListener('pointerout', onPointerOut, true);
  document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  document.addEventListener('fullscreenchange', onFullscreenChange);
  window.addEventListener('pointermove', onWindowPointerMove, true);
  window.addEventListener('pointerup', onWindowPointerUp, true);
  window.addEventListener('pointercancel', onWindowPointerUp, true);
  window.addEventListener('keydown', onWindowKeyDown, true);
  window.addEventListener('scroll', syncRect, { capture: true, passive: true });
  window.addEventListener('resize', syncRect);
```

`startLoop()` is called from `show()` (line ~271), `tick()` itself, and
`onHandlePointerDown` (line ~405). `stopLoop()` is called from `hideNow()` and
`detach()`.

**What the rect actually depends on**: the player's own size (covered by a
`ResizeObserver`), page scroll (covered), viewport resize (covered), and
position drift from unrelated layout changes above it on the page (covered by
nothing today except the 60fps loop). The last case is real but rare and not
worth 60fps; a low-frequency poll handles it.

**Repo conventions**: comments explain *why* in full sentences; observers and
listeners are always torn down in `destroy()`.

## Commands you will need

| Purpose   | Command                               | Expected on success           |
|-----------|---------------------------------------|-------------------------------|
| Typecheck | `npm run compile`                     | exit 0, no output             |
| Tests     | `npx vitest run`                      | all pass (94 after plan 005)  |
| One file  | `npx vitest run tests/resize.test.ts` | all pass                      |
| Build     | `npx wxt build`                       | exit 0                        |

## Scope

**In scope**:

- `utils/resize.ts`
- `tests/resize.test.ts`

**Out of scope**:

- `utils/overlayStyles.ts` — no CSS change is needed or wanted.
- `entrypoints/content.ts` — the overlay owns its own tracking.
- The drag path's per-frame *sizing* (`applyDragFrame`) — that is a different rAF
  and must keep running at full rate.

## Git workflow

- Branch: `advisor/006-stop-per-frame-layout`
- Imperative subject, e.g. `Track the player with observers instead of a 60fps loop`.
- Do NOT push or open a PR.

## Steps

### Step 1: Skip the DOM writes when the rect has not moved

In `utils/resize.ts`, add a cached rect above `syncRect` and short-circuit on it:

```ts
  /** Last rect we wrote, so an unchanged frame costs one read and zero writes. */
  let lastRect = { left: NaN, top: NaN, width: NaN, height: NaN };

  function syncRect(): void {
    if (!player || !player.target.isConnected) return;
    const rect = player.target.getBoundingClientRect();

    if (
      rect.left === lastRect.left &&
      rect.top === lastRect.top &&
      rect.width === lastRect.width &&
      rect.height === lastRect.height
    ) {
      return;
    }
    lastRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };

    frame.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
    frame.style.width = `${rect.width}px`;
    frame.style.height = `${rect.height}px`;

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    frame.dataset.badge =
      rect.bottom + BADGE_CLEARANCE > viewportHeight && rect.height > 48 ? 'inside' : 'below';
  }
```

In `attach()`, reset the cache so a newly attached player always gets one write —
add this immediately after `player = { ...next, … };`:

```ts
    lastRect = { left: NaN, top: NaN, width: NaN, height: NaN };
```

(`NaN !== NaN`, so the first comparison after a reset always misses and writes.)

**Verify**: `npm run compile` → exit 0. `npx vitest run tests/resize.test.ts` →
all pass.

### Step 2: Stop the loop from re-arming unless a drag is in progress

Replace `tick()`:

```ts
  function tick(): void {
    rafId = null;
    syncRect();
    // Only a drag needs frame-rate tracking. At rest the frame is driven by the
    // ResizeObserver, scroll, resize and the slow poll below -- re-arming here
    // would force a layout ~60 times a second on someone else's page for as long
    // as the pointer rests over a video.
    if (drag) startLoop();
  }
```

**Verify**: `npm run compile` → exit 0.

### Step 3: Observe the player's own box

Add a `ResizeObserver` next to the other overlay state (near `lastRect`):

```ts
  /**
   * Catches the player being resized by the page (or by us), which is the common
   * reason the frame needs to move. Position-only drift is handled by the scroll
   * and resize listeners plus the slow poll.
   */
  const rectObserver =
    typeof ResizeObserver === 'function' ? new ResizeObserver(() => syncRect()) : null;
```

In `attach()`, after `player` is assigned, start observing the new target:

```ts
    rectObserver?.disconnect();
    rectObserver?.observe(player.target);
```

In `detach()`, stop:

```ts
    rectObserver?.disconnect();
```

**Verify**: `npm run compile` → exit 0. `npx vitest run` → all pass. (jsdom
provides `ResizeObserver` in recent versions; if it does not, the `typeof` guard
makes the tests pass with the observer simply absent.)

### Step 4: Add a slow poll for position drift

Add alongside the other timers:

```ts
  /**
   * Position drift -- a player pushed down the page by an image loading above it
   * -- changes the rect without resizing the target or scrolling the window, so
   * no observer fires. Four checks a second is invisible to the user and ~15x
   * cheaper than the frame loop it replaces.
   */
  const POLL_MS = 250;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function startPoll(): void {
    if (pollTimer === null) pollTimer = setInterval(syncRect, POLL_MS);
  }

  function stopPoll(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }
```

Wire it to visibility — in `show()`, replace the trailing `startLoop();` with
`startPoll();`. In `hideNow()`, add `stopPoll();` next to the existing
`stopLoop();`. In `detach()` and `destroy()`, add `stopPoll();` next to the
existing `stopLoop()` / cleanup.

Leave the `startLoop()` call inside `onHandlePointerDown` — that is the drag
entry point and must keep the frame-rate loop.

**Verify**: `npm run compile` → exit 0. `npx vitest run` → all pass.

### Step 5: Confirm no leaks on teardown

**Verify**: `grep -n "stopPoll()" utils/resize.ts` → at least four matches
(`hideNow`, `detach`, `destroy`, and the function's own definition).
`grep -n "rectObserver?.disconnect()" utils/resize.ts` → at least two matches
(`attach`, `detach`).

## Test plan

New tests in `tests/resize.test.ts` inside `describe('createResizeOverlay', …)`.
The existing manual `frames` queue (stubbed `requestAnimationFrame` pushing into
an array) makes the scheduling behaviour directly assertable:

```ts
  it('does not re-arm the frame loop while merely hovering', () => {
    const media = document.createElement('video');
    stubLiveRect(media, { width: 640, height: 360 });
    document.body.appendChild(media);

    overlay = createResizeOverlay(
      { lockAspectRatio: false, allowOverflow: false },
      { onCommit: vi.fn() },
    );
    overlay.attach(describePlayer(media));

    media.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    flushFrame();

    // A visible-but-idle frame must leave the queue empty: re-arming here is the
    // 60fps forced-layout regression this test exists to prevent.
    expect(frames).toHaveLength(0);
  });

  it('keeps the frame loop running for the duration of a drag', () => {
    const media = document.createElement('video');
    stubLiveRect(media, { width: 640, height: 360 });
    document.body.appendChild(media);

    overlay = createResizeOverlay(
      { lockAspectRatio: false, allowOverflow: false },
      { onCommit: vi.fn() },
    );
    overlay.attach(describePlayer(media));

    handleFor('r').dispatchEvent(pointerEvent('pointerdown', 640, 180));
    flushFrame();

    expect(frames.length).toBeGreaterThan(0);

    window.dispatchEvent(pointerEvent('pointerup', 640, 180));
  });

  it('writes nothing when the rect has not changed', () => {
    const media = document.createElement('video');
    stubLiveRect(media, { width: 640, height: 360 });
    document.body.appendChild(media);

    overlay = createResizeOverlay(
      { lockAspectRatio: false, allowOverflow: false },
      { onCommit: vi.fn() },
    );
    overlay.attach(describePlayer(media));

    const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
    const frameEl = shadow.querySelector<HTMLElement>('.frame')!;
    frameEl.style.transform = 'SENTINEL';

    media.dispatchEvent(new MouseEvent('pointerover', { bubbles: true }));
    flushFrame();

    // syncRect short-circuited, so it never overwrote the sentinel.
    expect(frameEl.style.transform).toBe('SENTINEL');
  });
```

`flushFrame`, `handleFor`, `pointerEvent`, `stubLiveRect`, `describePlayer` and
`OVERLAY_HOST_ID` are all already defined or imported in that file.

Note the third test depends on `attach()` having already written once and reset
`lastRect`; if it fails because the sentinel *is* overwritten, check that the
`lastRect` reset in step 1 is inside `attach()` and not inside `syncRect()`.

Verification: `npx vitest run` → all pass, 97 total (94 after plan 005 + 3).

## Done criteria

- [ ] `npm run compile` exits 0
- [ ] `npx vitest run` exits 0 and reports 97 passing tests
- [ ] `npx wxt build` exits 0
- [ ] `grep -n "if (visible || drag) startLoop" utils/resize.ts` returns no matches
- [ ] `grep -c "stopPoll()" utils/resize.ts` returns at least 4
- [ ] All pre-existing overlay tests still pass, in particular
      `it('resizes the media element itself when a handle is dragged', …)`
- [ ] `git status --short` lists only `utils/resize.ts` and `tests/resize.test.ts`
- [ ] `plans/README.md` status row for 006 updated to DONE

## STOP conditions

Stop and report back if:

- `utils/resize.ts:222-256` does not match the "Current state" excerpt.
- Plan 005 has not landed (`tests/content.test.ts` does not exist). This plan
  changes the overlay's tracking behaviour and needs that regression net.
- Any existing drag test fails. The drag path must keep its 60fps loop; a
  failure there means step 2's condition was over-tightened.
- `flushFrame()` in the first new test leaves a non-empty queue *and* you cannot
  find a `startLoop()` call other than the drag entry point. Report it rather
  than deleting calls until the test goes green.

## Maintenance notes

- The deliberate trade-off: a player moved by a CSS transition or animation is
  now tracked at 4Hz rather than 60Hz while hovered, so the frame can lag behind
  such motion by up to 250ms. This was judged worth it because animating a video
  player's position while the user hovers it is rare, and the alternative taxes
  every page. If a real site is found where this looks broken, the fix is a
  targeted rAF loop while a transition is running — not reverting to the
  unconditional loop.
- `POLL_MS` is the knob. Anyone tempted to lower it should measure first: at
  250ms it is ~4 forced layouts/second, at 16ms it is the original bug.
- A reviewer should check that `stopPoll()` is called on every path that calls
  `stopLoop()`. A stranded `setInterval` after `destroy()` outlives the content
  script and is worse than the problem being fixed.
- Interacts with plan 002: once natural size can be refreshed, a `ResizeObserver`
  is the natural trigger for re-measuring after late layout. This plan
  deliberately does not wire that up — do it as a follow-on so the two changes
  stay separately reviewable.
