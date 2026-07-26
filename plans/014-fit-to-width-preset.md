# Plan 014: Expose "fit to width" as a preset, not just as a drag snap target

> **Executor instructions**: Follow this plan step by step. Run every
> verification command. If anything in "STOP conditions" occurs, stop and report.
> When done, update the status row in `plans/README.md`.
>
> **Drift check (run first)**: work lives in the *uncommitted working tree* on
> commit `0f7b549`. Confirm `snapSize` in `utils/resize.ts` still includes
> `window.innerWidth` and `window.innerWidth - 32` among its targets. On a
> mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (land after `plans/005-content-script-tests.md` for coverage)
- **Category**: direction
- **Planned at**: working tree on commit `0f7b549`, 2026-07-26

## Why this matters

"Make the video as wide as my window" is the single most common thing anyone
wants from a video resizer, and the drag path already knows it: `snapSize`
snaps to `window.innerWidth` and `window.innerWidth - 32` so that dragging near
the viewport edge lands exactly on them. But the popup only offers
scale-relative presets (75%, 100%, …), so the concept exists in one half of the
product and not the other. A user who wants full width has to drag and hope they
hit the snap.

This closes an asymmetry rather than inventing a feature — the sizing behaviour
already exists and is already tuned.

## Current state

The snap targets, in `snapSize` (`utils/resize.ts`) — note the last two:

```ts
    const targets = [
      player.naturalWidth * 0.5,
      player.naturalWidth * 0.75,
      player.naturalWidth,
      player.naturalWidth * 1.25,
      player.naturalWidth * 1.5,
      player.naturalWidth * 2,
      window.innerWidth,
      window.innerWidth - 32,
    ];
```

The popup's presets are purely multiplicative — `utils/constants.ts`:

```ts
export const SIZE_PRESETS: { label: string; scale: number }[] = [
  { label: '75%', scale: 0.75 },
  { label: '100%', scale: 1 },
  { label: '125%', scale: 1.25 },
  { label: '150%', scale: 1.5 },
  { label: '200%', scale: 2 },
];
```

The preset handler in `entrypoints/content.ts` multiplies natural dimensions:

```ts
        case 'applyPreset': {
          const player = overlay?.getPlayer();
          if (player && overlay) {
            const width = Math.round(player.naturalWidth * message.scale);
            const height = Math.round(player.naturalHeight * message.scale);
            overlay.setSize(width, height);
```

Crucially, `overlay.setSize` clamps with `lock: false`, so it does **not**
preserve aspect ratio on its own — the preset path only stays proportional
because it scales both axes by the same factor. A width-driven preset must
compute its own height from `player.aspectRatio`.

`DetectedPlayer.aspectRatio` is `videoWidth / videoHeight` when known, otherwise
the measured box ratio (`utils/videoDetector.ts`).

The popup renders presets in a five-column grid — `entrypoints/popup/App.css`:

```css
.presets {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
```

**Repo conventions**: buttons get `active:scale(0.96)`; preset labels use
`font-variant-numeric: tabular-nums`; message types are a discriminated union.

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run compile`   | exit 0              |
| Tests     | `npx vitest run`    | all pass            |
| Build     | `npx wxt build`     | exit 0              |
| Manual    | `bun run dev`       | launches a browser with the extension loaded |

## Scope

**In scope**:

- `utils/messages.ts`
- `entrypoints/content.ts`
- `entrypoints/popup/App.tsx`
- `entrypoints/popup/App.css`
- `tests/content.test.ts` (only if plan 005 has landed)

**Out of scope**:

- `snapSize` in `utils/resize.ts` — the drag snap targets are already correct;
  this plan adds a second entry point to the same idea, it does not change the
  first.
- `SIZE_PRESETS` in `utils/constants.ts` — do **not** try to express fit-to-width
  as an entry in that array. Its members are `{ label, scale }` and a
  viewport-relative size is not a scale of the natural size; forcing it in would
  require a sentinel value and a branch at every use site.
- Fit-to-*height* — a vertical fit competes with page scrolling and needs its own
  design thinking.

## Git workflow

- Branch: `advisor/014-fit-to-width-preset`
- Imperative subject, e.g. `Add a fit-to-width preset to the popup`.
- Do NOT push or open a PR.

## Steps

### Step 1: Add the message

In `utils/messages.ts`, add to `ContentRequest`, directly after `applyPreset`:

```ts
  | { type: 'fitToWidth' }
```

**Verify**: `npm run compile` → exit 0 (the content script's switch has a
`default` branch, so this alone will not fail the build — step 2 is mandatory).

### Step 2: Handle it in the content script

In `entrypoints/content.ts`, add a case directly after `applyPreset`:

```ts
        case 'fitToWidth': {
          const player = overlay?.getPlayer();
          if (player && overlay) {
            // Matches the drag path's snap target: full viewport width less a
            // small margin, so the player does not sit flush against the edge or
            // provoke a horizontal scrollbar.
            const width = Math.max(0, window.innerWidth - 32);
            // setSize clamps with the ratio unlocked, so height has to be derived
            // here or the player would keep its old height and distort.
            const height = Math.round(width / (player.aspectRatio || 16 / 9));
            overlay.setSize(width, height);
            if (settings.rememberSize) {
              persisted = { width, height };
              await persistDimensions(hostname, persisted);
            }
          }
          break;
        }
```

**Verify**: `npm run compile` → exit 0.

### Step 3: Add the button to the popup

In `entrypoints/popup/App.tsx`, inside the `live && detected` block, add a
full-width button directly below the existing `.presets` grid and above the
Reset button:

```tsx
          <button
            type="button"
            className="section fit"
            onClick={() => void send({ type: 'fitToWidth' })}
          >
            Fit to window width
          </button>
```

In `entrypoints/popup/App.css`, add a rule after the `.presets` block. Note the
radius: the preset group is `11px` with `3px` padding, so a sibling that is a
single control rather than a group uses `10px` to sit visually with the other
full-width surfaces (`.readout` is `10px`):

```css
.fit {
  padding: 9px 0;
  border-radius: 10px;
  background: var(--surface);
  box-shadow: var(--shadow-raised);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  transition: background-color 140ms var(--ease-out), color 140ms var(--ease-out),
    transform 140ms var(--ease-out);
}

@media (hover: hover) and (pointer: fine) {
  .fit:hover {
    background: var(--surface-hover);
    color: var(--text);
  }
}

.fit:active {
  transform: scale(0.96);
}
```

The `active:scale(0.96)` and the hover media query are both required by the
repo's existing button conventions — every other button in `App.css` has them.

**Verify**: `npm run compile` → exit 0. `npx wxt build` → exit 0.

### Step 4: Check the entrance stagger still reads correctly

`App.css` staggers `.section` children by `nth-child` up to `:nth-child(6)`. The
new button adds a section, so confirm the ordering still looks right and that no
element lands past the last defined delay — anything beyond `:nth-child(6)`
inherits `animation-delay: 0ms` and pops in ahead of its neighbours.

Count the `.section` elements the popup renders in the `live && detected` state.
If it now exceeds 6, add the missing `nth-child` rules following the existing
pattern (delays step by ~20-25ms at the tail: `0, 40, 80, 110, 135, 155`).

**Verify**: `bun run dev`, open the popup on a page with a video, and confirm the
sections still fade in top-to-bottom with no element jumping ahead.

### Step 5: Verify the behaviour by hand

With `bun run dev`, on a page with a 16:9 video:

1. Click "Fit to window width".
2. The player becomes `window.innerWidth - 32` wide.
3. Its aspect ratio is visually unchanged — no letterboxing or stretching.
4. No horizontal scrollbar appears.
5. "Reset to original size" still restores the original box.

**Verify**: all five hold.

## Test plan

- **If `plans/005-content-script-tests.md` has landed**: add to
  `tests/content.test.ts`, modelled on the existing
  `it('applies a preset relative to the original size', …)`:
  - jsdom's default viewport is 1024×768, so `fitToWidth` on a 640×360 player
    should produce `{ currentWidth: 992, currentHeight: 558 }`
    (`1024 - 32 = 992`; `992 / (16/9) = 558`).
  - a second test with a 9:16 vertical player (`stubLiveRect(el, { width: 360, height: 640 })`)
    confirming height is derived from the player's own ratio, not assumed 16:9 —
    this is the case a naive implementation gets wrong.
- **If plan 005 has not landed**: step 5's manual check is the only verification;
  say so explicitly rather than claiming coverage.

Verification: `npx vitest run` → all pass, 2 more than before.

## Done criteria

- [ ] `npm run compile` exits 0
- [ ] `npx vitest run` exits 0 (with 2 new tests if plan 005 has landed)
- [ ] `npx wxt build` exits 0
- [ ] `grep -n "fitToWidth" utils/messages.ts entrypoints/content.ts entrypoints/popup/App.tsx`
      returns a match in each of the three files
- [ ] `git diff utils/constants.ts utils/resize.ts` is empty — neither
      `SIZE_PRESETS` nor `snapSize` was touched
- [ ] Step 5's five manual checks all pass, recorded in your report
- [ ] `plans/README.md` status row for 014 updated to DONE

## STOP conditions

Stop and report back if:

- `overlay.setSize` turns out to preserve aspect ratio on its own. This plan
  derives height explicitly because it does not; if that changed, the derivation
  is now double-applying and needs rethinking.
- The vertical-video test produces a 16:9 height. That means `player.aspectRatio`
  is not what this plan assumes and the fallback (`|| 16 / 9`) is masking it —
  report the actual value.
- Fitting to width causes the page to gain a horizontal scrollbar even at
  `innerWidth - 32`. That points at `allowOverflow` interacting with the site's
  layout, which is a real finding worth reporting rather than papering over with
  a bigger margin.

## Maintenance notes

- The `- 32` margin is duplicated between `snapSize` in `utils/resize.ts` and the
  new handler. That is deliberate — extracting a shared constant would couple the
  drag path to the popup path for two characters of savings — but if a third use
  appears, promote it to `utils/constants.ts` then.
- `window.innerWidth` is read at click time, so the fit does not follow later
  window resizes. That is consistent with every other preset (they are one-shot
  sizes, not modes). If a *sticky* fit mode is ever wanted, it is a different
  feature with a different storage story, not a change to this button.
- A reviewer should check the height derivation uses `player.aspectRatio` and not
  `naturalWidth / naturalHeight`. They usually agree, but for a `<video>` whose
  CSS box differs from its intrinsic video dimensions they do not, and the
  intrinsic ratio is the correct one.
