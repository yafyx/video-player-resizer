# Plan 001: Stop injecting eight invisible tab stops into every page

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the next
> step. If anything in the "STOP conditions" section occurs, stop and report — do
> not improvise. When done, update the status row for this plan in
> `plans/README.md`.
>
> **Drift check (run first)**: this repo has all of its work in the *uncommitted
> working tree* on top of commit `0f7b549`, so a `git diff` against a SHA proves
> nothing. Instead, open `utils/resize.ts` and confirm lines 139–153 match the
> "Current state" excerpt below. On a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: working tree on commit `0f7b549`, 2026-07-26

## Why this matters

The extension builds eight resize handles per detected video and makes every one
of them keyboard-focusable at construction time. The overlay is hidden with
`opacity: 0`, which does **not** remove elements from the tab sequence. The
result: on any page where a video is detected, a keyboard user pressing Tab
walks through eight invisible, unannounced controls before reaching the page's
own content. This is the kind of defect that gets an extension rejected in store
review, and it is invisible to mouse users, so it will not be caught by casual
testing.

There is a second, quieter half to the same bug: because the frame is revealed on
*hover*, and a keyboard user never hovers, the handles are simultaneously
over-exposed to Tab and under-usable. After this plan there is exactly **one**
tab stop per video, focusing it reveals the frame, and the arrow keys resize —
which the code already supports.

## Current state

Files involved:

- `utils/resize.ts` — builds the overlay's shadow DOM; the handle loop is at
  lines 139–176.
- `utils/overlayStyles.ts` — the overlay stylesheet; `.chrome` is hidden with
  `opacity: 0` at line 63.

The handle construction loop, `utils/resize.ts:139-153`:

```ts
  for (const pos of HANDLE_POSITIONS) {
    const el = document.createElement('div');
    const isCorner = CORNER_HANDLES.includes(pos);
    const isHorizontalEdge = pos === 't' || pos === 'b';
    el.className = `handle ${isCorner ? 'corner' : isHorizontalEdge ? 'edge-h' : 'edge-v'}`;
    el.dataset.handle = pos;
    el.dataset.grabbed = 'false';
    el.style.cursor = RESIZE_CURSORS[pos];
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `Resize video from the ${HANDLE_LABELS[pos]}`);

    const { top, left } = getHandleAnchor(pos);
    el.style.top = top;
    el.style.left = left;
```

Immediately after, the same loop already wires focus to reveal the frame
(`utils/resize.ts:162-163`):

```ts
    el.addEventListener('focus', show);
    el.addEventListener('blur', hideSoon);
```

The hiding mechanism, `utils/overlayStyles.ts:59-70` — note it is opacity-only,
which is why focusability survives:

```css
.chrome {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  opacity: 0;
  transform: scale(0.985);
  transition: opacity 120ms var(--ease-out), transform 120ms var(--ease-out);
}

.frame[data-visible="true"] .chrome {
  opacity: 1;
  transform: scale(1);
}
```

**Why the arrow keys make one handle sufficient**: the keyboard handler resizes
by width/height directly and ignores which handle is focused. From
`utils/resize.ts` (`onHandleKeyDown`, around line 530) — the doc comment states
the contract:

```ts
  /**
   * Arrow keys always mean "grow toward the arrow", whichever handle has focus.
   * Mapping each handle's own axis signs onto the keys would be more literal and
   * far harder to predict.
   */
```

So a single focusable handle gives a keyboard user the full resize capability.

**Repo conventions to match**:

- TypeScript strict mode; no `any`. Existing casts use `as` sparingly for DOM
  narrowing only.
- Comments explain *why*, not *what*. See the block comment above `.chrome` in
  `utils/overlayStyles.ts:53-57` for the house style — full sentences,
  explaining a decision.
- Tests live in `tests/`, use `vitest` + `jsdom`, and import geometry helpers
  from `tests/helpers.ts`. Model new overlay tests on the existing
  `describe('createResizeOverlay', ...)` block in `tests/resize.test.ts`, which
  stubs `requestAnimationFrame` in `beforeEach` and calls `overlay.destroy()` in
  `afterEach`.

## Commands you will need

| Purpose   | Command             | Expected on success                      |
|-----------|---------------------|------------------------------------------|
| Install   | `bun install`       | exit 0 (deps are already installed)      |
| Typecheck | `npm run compile`   | exit 0, no output                        |
| Tests     | `npx vitest run`    | all pass (85 before this plan's changes) |
| Build     | `npx wxt build`     | exit 0, prints "Finished in …"           |

## Scope

**In scope** (the only files you should modify):

- `utils/resize.ts`
- `tests/resize.test.ts`

**Out of scope** (do NOT touch, even though they look related):

- `utils/overlayStyles.ts` — do **not** switch `.chrome` from `opacity` to
  `visibility: hidden` to solve this. `visibility` is not animatable the way the
  120ms reveal needs, and changing it would break the enter transition that the
  rest of the design depends on. Fix this in the DOM layer, not CSS.
- `entrypoints/popup/**` — unrelated surface.
- `utils/videoDetector.ts` — unrelated.

## Git workflow

- Branch: `advisor/001-handle-tab-order`
- The repo has a single commit (`0f7b549 Initial commit: resizable video player
  extension`) so there is no established message convention. Use a plain
  imperative subject, e.g. `Make only one resize handle a tab stop`.
- Do NOT push or open a PR.

## Steps

### Step 1: Make only the bottom-right handle focusable

In `utils/resize.ts`, inside the `for (const pos of HANDLE_POSITIONS)` loop,
replace the three accessibility lines (currently lines 147–149):

```ts
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `Resize video from the ${HANDLE_LABELS[pos]}`);
```

with a version that exposes exactly one tab stop and hides the rest from
assistive technology:

```ts
    // One tab stop per video, not eight. The frame is revealed on hover, which a
    // keyboard user never triggers, so the bottom-right handle is the keyboard
    // entry point: focusing it calls show() below. The arrow keys resize by
    // width/height regardless of which handle has focus, so a single focusable
    // handle is the whole capability -- the other seven are pointer affordances.
    const isKeyboardEntry = pos === 'br';
    el.tabIndex = isKeyboardEntry ? 0 : -1;
    if (isKeyboardEntry) {
      el.setAttribute('role', 'button');
      el.setAttribute(
        'aria-label',
        'Resize video. Use the arrow keys to change size, Shift for finer steps, Escape to exit.',
      );
    } else {
      el.setAttribute('aria-hidden', 'true');
    }
```

Leave every other line in the loop untouched, including the `focus`/`blur`
listeners at lines 162–163 — they are what makes the keyboard entry point reveal
the frame.

`HANDLE_LABELS` (imported at the top of the file from `./constants`) becomes
unused by this change. Remove it from the import list in `utils/resize.ts` only.
Do **not** delete the `HANDLE_LABELS` export from `utils/constants.ts` — that is
plan 008's job, and deleting it here would put you out of scope.

**Verify**: `npm run compile` → exit 0, no output. (If it reports
`'HANDLE_LABELS' is declared but its value is never read`, you have not removed
the import.)

### Step 2: Add a regression test for the tab order

In `tests/resize.test.ts`, inside the existing
`describe('createResizeOverlay', ...)` block, add:

```ts
  it('adds exactly one tab stop to the page, not one per handle', () => {
    const media = document.createElement('video');
    stubLiveRect(media, { width: 640, height: 360 });
    document.body.appendChild(media);

    overlay = createResizeOverlay(
      { lockAspectRatio: false, allowOverflow: false },
      { onCommit: vi.fn() },
    );
    overlay.attach(describePlayer(media));

    const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
    const handles = Array.from(shadow.querySelectorAll<HTMLElement>('.handle'));
    const focusable = handles.filter((el) => el.tabIndex >= 0);

    // Hiding is opacity-only, so anything with tabIndex >= 0 is reachable by Tab
    // even while the frame is invisible.
    expect(handles).toHaveLength(8);
    expect(focusable).toHaveLength(1);
    expect(focusable[0].dataset.handle).toBe('br');
  });

  it('hides the decorative handles from assistive technology', () => {
    const media = document.createElement('video');
    stubLiveRect(media, { width: 640, height: 360 });
    document.body.appendChild(media);

    overlay = createResizeOverlay(
      { lockAspectRatio: false, allowOverflow: false },
      { onCommit: vi.fn() },
    );
    overlay.attach(describePlayer(media));

    const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
    const announced = shadow.querySelectorAll('.handle:not([aria-hidden="true"])');

    expect(announced).toHaveLength(1);
    expect(announced[0].getAttribute('aria-label')).toMatch(/arrow keys/i);
  });
```

All imports these tests need (`createResizeOverlay`, `describePlayer`,
`OVERLAY_HOST_ID`, `stubLiveRect`, `vi`) are already at the top of
`tests/resize.test.ts`. Do not add imports unless the typecheck demands it.

**Verify**: `npx vitest run tests/resize.test.ts` → all pass, including the 2 new
tests.

### Step 3: Confirm keyboard resizing still works end to end

The existing suite does not cover keyboard resizing at all. Add one test proving
the single remaining tab stop is functional, so a future refactor cannot
"simplify" it away:

```ts
  it('resizes from the keyboard through the one focusable handle', () => {
    const media = document.createElement('video');
    stubLiveRect(media, { width: 640, height: 360 });
    document.body.appendChild(media);

    overlay = createResizeOverlay(
      { lockAspectRatio: false, allowOverflow: false },
      { onCommit: vi.fn() },
    );
    overlay.attach(describePlayer(media));

    const shadow = document.getElementById(OVERLAY_HOST_ID)!.shadowRoot!;
    const entry = shadow.querySelector<HTMLElement>('[data-handle="br"]')!;

    entry.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }),
    );

    // KEY_STEP is 24px; the handler grows width by one step.
    expect(overlay.getSize()).toEqual({ width: 664, height: 360 });
  });
```

**Verify**: `npx vitest run tests/resize.test.ts` → all pass, including the 3 new
tests.

## Test plan

- New tests, all in `tests/resize.test.ts` inside the existing
  `describe('createResizeOverlay', ...)` block:
  - exactly one handle has `tabIndex >= 0`, and it is `br` (the regression this
    plan fixes);
  - the other seven carry `aria-hidden="true"` and the focusable one has an
    arrow-key-describing label;
  - pressing ArrowRight on the focusable handle widens the player by one 24px
    step (proves the remaining entry point is functional).
- Structural pattern to follow: the existing
  `it('resizes the media element itself when a handle is dragged', ...)` in the
  same file — same setup shape (`stubLiveRect` → `appendChild` →
  `createResizeOverlay` → `attach(describePlayer(media))`).
- Verification: `npx vitest run` → all pass, 88 total.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npm run compile` exits 0
- [ ] `npx vitest run` exits 0 and reports 88 passing tests
- [ ] `npx wxt build` exits 0
- [ ] `grep -n "el.tabIndex = 0" utils/resize.ts` returns no matches
- [ ] `grep -n "HANDLE_LABELS" utils/resize.ts` returns no matches
- [ ] `git status --short` lists only `utils/resize.ts` and `tests/resize.test.ts`
      as modified relative to the state you started from
- [ ] `plans/README.md` status row for 001 updated to DONE

## STOP conditions

Stop and report back (do not improvise) if:

- `utils/resize.ts:139-153` does not match the "Current state" excerpt above.
- The `focus`/`blur` listeners at `utils/resize.ts:162-163` are absent — the
  whole approach depends on focus revealing the frame, and without them a
  keyboard user gets an invisible frame.
- The ArrowRight test in step 3 produces a width other than 664. That means
  `KEY_STEP` changed or the keyboard handler's semantics changed; report the
  actual value rather than adjusting the assertion to match.
- `npx vitest run` had failures *before* you made any change (the baseline is 85
  passing). Report the pre-existing failure instead of building on top of it.

## Maintenance notes

- If the reveal model ever changes from hover to click/always-on, revisit the
  single-tab-stop decision — it exists because a hover-revealed control is
  otherwise unreachable by keyboard, not because one handle is inherently right.
- A reviewer should check that the seven decorative handles did not
  accidentally keep `role="button"`; a `role` on an `aria-hidden` element is
  harmless but noisy, and its presence usually means the conditional was
  restructured incorrectly.
- Explicitly deferred: proper roving-tabindex navigation between handles (arrow
  keys currently resize rather than move focus). Not worth it while arrow keys
  already cover both axes from a single handle — revisit only if per-edge
  keyboard resizing is ever requested.
- Also deferred: `role="button"` is a loose fit for an arrow-key-driven 2D
  resize control. There is no accurate ARIA role for this; the descriptive
  `aria-label` is the honest mitigation. Do not "fix" it by inventing
  `role="slider"` without `aria-valuenow`/`min`/`max`, which would be worse.
