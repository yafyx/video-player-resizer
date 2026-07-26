# Plan 005: Put the content script's orchestration under test

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise. When
> done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: this repo's work lives in the *uncommitted working
> tree* on top of commit `0f7b549`. Confirm `vitest.config.ts` still matches the
> excerpt below and that `entrypoints/content.ts` still default-exports a
> `defineContentScript({ ..., main(ctx) { ... } })`. On a mismatch, treat it as a
> STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — step 1 changes the shared test environment for every existing test
- **Depends on**: none
- **Category**: tests
- **Planned at**: working tree on commit `0f7b549`, 2026-07-26

## Why this matters

`entrypoints/content.ts` is 306 lines and owns everything that makes the
extension a product rather than a pile of modules: whether it activates on this
site, mounting and tearing down the overlay, SPA navigation, storage watchers,
and the entire popup message protocol. It has **zero tests**. The other 85 tests
all cover leaf modules (geometry, colour maths, CSS sizing) — the parts least
likely to break.

This is also the blocker for two other planned changes. Plans 006 and 007 both
refactor hot paths that the content script drives; doing that without a
regression net around the orchestrator is how a "performance improvement" quietly
stops the extension activating on half the web.

## Current state

- `entrypoints/content.ts` — the orchestrator. Default-exports
  `defineContentScript({ matches, runAt, allFrames, main(ctx) { … } })`.
  `main` is synchronous and kicks off async work with
  `void refresh().then(applyActivation)`.
- `vitest.config.ts` — currently minimal, with no WXT integration:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
  },
});
```

- `tests/` — five spec files, 85 tests, all pure-module. `tests/helpers.ts`
  exports `stubRect` and `stubLiveRect` for faking geometry (jsdom has no
  layout engine).

**The `browser` global**: WXT auto-imports `browser` at build time. Under plain
Vitest it is undefined, which is why no test has been able to import
`entrypoints/content.ts` or the storage functions that use it.

**WXT already ships the fix — no new dependency is required.** Verified in this
repo's `node_modules`:

- `wxt/testing` exports `{ WxtVitest, fakeBrowser, FakeBrowser }`.
- `@webext-core/fake-browser` is already installed as a direct dependency of
  `wxt`, so it resolves without touching `package.json`.

`WxtVitest()` is a Vite plugin that configures Vitest with WXT's auto-imports and
polyfills, documented in `node_modules/wxt/dist/testing/wxt-vitest-plugin.d.mts`:

```ts
 * // vitest.config.ts
 * import { defineConfig } from 'vitest/config';
 * import { WxtVitest } from 'wxt/testing/vitest-plugin';
 *
 * export default defineConfig({
 *   plugins: [WxtVitest()],
 * });
```

Note `WxtVitest()` returns a **Promise** of plugins; `defineConfig` accepts it.

**Repo conventions to match**:

- Tests are `describe`/`it` with `vitest`, jsdom environment, no testing-library.
- Geometry is always stubbed via `tests/helpers.ts` — never assume layout.
- Test names are full sentences describing behaviour, e.g.
  `it('treats a resize as the same player, not a new one', …)`.
- Overlay-touching tests stub `requestAnimationFrame` into a manual queue in
  `beforeEach` and call `vi.unstubAllGlobals()` in `afterEach` — see the
  `describe('createResizeOverlay', …)` block in `tests/resize.test.ts`, which is
  the closest structural exemplar for what you are about to write.

## Commands you will need

| Purpose        | Command                              | Expected on success    |
|----------------|--------------------------------------|------------------------|
| Typecheck      | `npm run compile`                    | exit 0, no output      |
| Tests          | `npx vitest run`                     | all pass (85 baseline) |
| Single file    | `npx vitest run tests/content.test.ts` | all pass             |
| Verbose names  | `npx vitest run --reporter=verbose`  | lists every test name  |
| Build          | `npx wxt build`                      | exit 0                 |

## Scope

**In scope**:

- `vitest.config.ts`
- `tests/content.test.ts` (create)
- `tests/content-default-off.test.ts` (create)

**Out of scope**:

- `entrypoints/content.ts` — **do not change the source to make it testable.**
  If a test is impossible without a production change, that is a STOP condition,
  not licence to refactor. The point of this plan is a net around the code *as it
  is*, so plans 006 and 007 can refactor against it.
- `package.json` — no new dependencies are needed; `wxt/testing` and
  `@webext-core/fake-browser` already resolve.
- All existing test files — they must pass unchanged.

## Git workflow

- Branch: `advisor/005-content-script-tests`
- Imperative subject, e.g. `Add orchestration tests for the content script`.
- Commit step 1 separately from steps 2–4, so an environment regression is easy
  to bisect.
- Do NOT push or open a PR.

## Steps

### Step 1: Wire the WXT Vitest plugin and prove the existing suite is unaffected

Replace `vitest.config.ts` with:

```ts
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  // Provides WXT's auto-imports (`browser`, `defineContentScript`, …) so the
  // entrypoints can be imported directly by tests.
  plugins: [WxtVitest()],
  test: {
    environment: 'jsdom',
  },
});
```

**Verify**: `npx vitest run` → **all 85 existing tests still pass**, with no new
failures and no change in count.

This is the risky step. If the count changes or any previously-passing test now
fails, revert `vitest.config.ts` and STOP — report exactly which tests changed
behaviour. Do not "fix" existing tests to accommodate the plugin.

### Step 2: Build the shared harness inside the first test file

Create `tests/content.test.ts`. The docblock at the top sets the page's hostname
— `resolveSiteActivation` keys off `window.location.hostname`, and jsdom's
default (`localhost`) is not a useful subject:

```ts
/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://vlr.gg/720033/some-article" }
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import contentScript from '../entrypoints/content';
import { OVERLAY_HOST_ID } from '../utils/constants';
import { stubLiveRect } from './helpers';
import type { PlayerState } from '../utils/messages';

/**
 * Stand-in for WXT's ContentScriptContext. Only the two members the content
 * script actually uses are implemented, plus an `invalidate()` so each test can
 * tear its instance down the way an extension reload would.
 */
function createFakeCtx() {
  const invalidations: Array<() => void> = [];
  const bound: Array<{ target: EventTarget; type: string; handler: EventListener; options?: unknown }> = [];

  return {
    addEventListener(target: EventTarget, type: string, handler: EventListener, options?: unknown) {
      bound.push({ target, type, handler, options });
      target.addEventListener(type, handler, options as AddEventListenerOptions);
    },
    onInvalidated(cb: () => void) {
      invalidations.push(cb);
    },
    invalidate() {
      for (const cb of invalidations) cb();
      for (const b of bound) {
        b.target.removeEventListener(b.type, b.handler, b.options as EventListenerOptions);
      }
    },
  };
}

let ctx: ReturnType<typeof createFakeCtx>;
let frames: FrameRequestCallback[] = [];
let messageHandler:
  | ((msg: unknown, sender: unknown, sendResponse: (r: PlayerState) => void) => boolean)
  | null = null;

/** Invoke the content script's own message listener, captured at registration. */
function send(message: unknown): Promise<PlayerState> {
  if (!messageHandler) throw new Error('content script registered no message listener');
  return new Promise((resolve) => {
    messageHandler!(message, {}, resolve);
  });
}

/** The content script boots asynchronously; give its promise chain a chance to settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function addVideo(width = 640, height = 360): HTMLVideoElement {
  const el = document.createElement('video');
  stubLiveRect(el, { width, height });
  document.body.appendChild(el);
  return el;
}

async function boot(): Promise<void> {
  ctx = createFakeCtx();
  await contentScript.main(ctx as never);
  await settle();
}

beforeEach(() => {
  fakeBrowser.reset();
  document.body.innerHTML = '';
  document.getElementById(OVERLAY_HOST_ID)?.remove();
  frames = [];
  messageHandler = null;

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(fakeBrowser.runtime.onMessage, 'addListener').mockImplementation(((fn: never) => {
    messageHandler = fn;
  }) as never);
});

afterEach(() => {
  ctx?.invalidate();
  document.getElementById(OVERLAY_HOST_ID)?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
```

**Verify**: add a single placeholder test
(`it('boots', async () => { await boot(); expect(true).toBe(true); })`) and run
`npx vitest run tests/content.test.ts` → passes. This proves the harness itself
works before you write assertions against it. Delete the placeholder afterwards.

### Step 3: Cover activation, mounting and the message protocol

Add to `tests/content.test.ts`:

```ts
describe('content script on an ordinary site', () => {
  it('mounts the overlay when a player is present', async () => {
    addVideo();
    await boot();

    expect(document.getElementById(OVERLAY_HOST_ID)).not.toBeNull();
  });

  it('mounts nothing on a page with no media', async () => {
    await boot();

    expect(document.getElementById(OVERLAY_HOST_ID)).toBeNull();
  });

  it('reports its state to the popup', async () => {
    addVideo();
    await boot();

    const state = await send({ type: 'getState' });

    expect(state.type).toBe('state');
    expect(state.playerDetected).toBe(true);
    expect(state.activeHere).toBe(true);
    expect(state.offByDefault).toBe(false);
    expect(state.hostname).toBe('vlr.gg');
    expect(state.naturalWidth).toBe(640);
    expect(state.naturalHeight).toBe(360);
  });

  it('applies a preset relative to the original size', async () => {
    const video = addVideo();
    await boot();

    const state = await send({ type: 'applyPreset', scale: 1.5 });

    expect(state.currentWidth).toBe(960);
    expect(state.currentHeight).toBe(540);
    expect(video.style.getPropertyValue('width')).toBe('960px');
  });

  it('puts the player back and forgets the size on reset', async () => {
    const video = addVideo();
    await boot();

    await send({ type: 'applyPreset', scale: 2 });
    const state = await send({ type: 'resetSize' });

    expect(state.isResized).toBe(false);
    expect(video.style.getPropertyValue('width')).toBe('');
  });

  it('tears the overlay down when the user switches the site off', async () => {
    addVideo();
    await boot();
    expect(document.getElementById(OVERLAY_HOST_ID)).not.toBeNull();

    const state = await send({ type: 'setEnabled', value: false });
    await settle();

    expect(state.activeHere).toBe(false);
    expect(document.getElementById(OVERLAY_HOST_ID)).toBeNull();
  });

  it('restores every player it touched when the context is invalidated', async () => {
    const video = addVideo();
    await boot();
    await send({ type: 'applyPreset', scale: 2 });
    expect(video.style.getPropertyValue('width')).toBe('1280px');

    ctx.invalidate();

    expect(video.style.getPropertyValue('width')).toBe('');
    expect(document.getElementById(OVERLAY_HOST_ID)).toBeNull();
  });
});
```

**Verify**: `npx vitest run tests/content.test.ts` → all 7 pass.

### Step 4: Cover the default-off path on its own hostname

Create `tests/content-default-off.test.ts`. It needs a different page URL, which
is why it is a separate file — the environment docblock is per-file:

```ts
/**
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://www.youtube.com/watch?v=abc" }
 */
```

Copy the same harness (`createFakeCtx`, `boot`, `settle`, `send`, `addVideo`, the
`beforeEach`/`afterEach`) from `tests/content.test.ts` into this file. Duplication
is acceptable here — extracting a shared harness into `tests/helpers.ts` would
force `helpers.ts` to import `wxt/testing`, which every other spec file would
then pull in for no reason.

Then:

```ts
describe('content script on a site that ships disabled', () => {
  it('does not mount, and says the choice was the default', async () => {
    addVideo();
    await boot();

    expect(document.getElementById(OVERLAY_HOST_ID)).toBeNull();

    const state = await send({ type: 'getState' });
    expect(state.activeHere).toBe(false);
    expect(state.offByDefault).toBe(true);
  });

  it('mounts once the user explicitly turns it on', async () => {
    addVideo();
    await boot();

    const state = await send({ type: 'setEnabled', value: true });
    await settle();

    expect(state.activeHere).toBe(true);
    expect(state.offByDefault).toBe(false);
    expect(document.getElementById(OVERLAY_HOST_ID)).not.toBeNull();
  });
});
```

**Verify**: `npx vitest run tests/content-default-off.test.ts` → both pass.

## Test plan

Nine new tests across two files, covering the orchestration paths that had none:

- **Activation** — mounts on an ordinary site with a player; mounts nothing
  without one; stays down on a `DEFAULT_OFF_HOSTS` site and reports
  `offByDefault: true`; comes up when the user overrides that.
- **Message protocol** — `getState` shape and values; `applyPreset` scales from
  the original and actually writes the element; `resetSize` clears both the
  applied size and the `isResized` flag; `setEnabled` tears down.
- **Lifecycle** — `ctx.invalidate()` restores every touched player and removes
  the overlay from the page (the leak that would otherwise outlive an extension
  reload).

Structural pattern to follow: `describe('createResizeOverlay', …)` in
`tests/resize.test.ts` — same rAF stubbing, same `afterEach` teardown discipline.

Verification: `npx vitest run` → all pass, 94 total (85 existing + 9 new).

## Done criteria

- [ ] `npm run compile` exits 0
- [ ] `npx vitest run` exits 0 and reports 94 passing tests
- [ ] The 85 pre-existing tests all still pass — confirm by name with
      `npx vitest run --reporter=verbose` that no previously-listed test is
      missing or failing
- [ ] `npx wxt build` exits 0
- [ ] `git status --short` lists only `vitest.config.ts`,
      `tests/content.test.ts` and `tests/content-default-off.test.ts`
- [ ] `git diff --stat entrypoints/ utils/` is empty — no production code changed
- [ ] `plans/README.md` status row for 005 updated to DONE

## STOP conditions

Stop and report back if:

- Step 1 changes the result of any existing test. Revert `vitest.config.ts` first,
  then report which tests moved.
- `wxt/testing/vitest-plugin` does not resolve, or `WxtVitest()` throws on
  startup. Report the error; do not fall back to hand-rolling a `browser` mock,
  which would diverge from the real API surface.
- `fakeBrowser.runtime.onMessage.addListener` cannot be spied on, or
  `messageHandler` is still `null` after `boot()`. That means the content script
  registers its listener differently than this plan assumes.
- A test can only be made to pass by editing `entrypoints/content.ts`. Report the
  obstacle — the whole value of this plan is that it characterises the current
  behaviour, including any warts.
- `settle()`'s twelve microtask ticks turn out to be insufficient and you are
  tempted to add real `setTimeout` waits. Report instead: a boot sequence that
  needs wall-clock time to settle is a finding in its own right.

## Maintenance notes

- These are **characterization** tests: they pin what the code does today, not
  what it ideally should. If plan 006 or 007 legitimately changes observable
  behaviour, updating these assertions is correct — but the update should be a
  deliberate, reviewed line in that plan's diff, never a drive-by.
- The 1200ms settle timer in `entrypoints/content.ts` is *not* covered here,
  because these tests deliberately avoid wall-clock waits. Plan 002 covers the
  underlying bug at the `utils/resize.ts` level instead.
- The harness is duplicated across the two spec files on purpose (different page
  URLs, and to keep `wxt/testing` out of `tests/helpers.ts`). If a third
  hostname scenario appears, that is the point to extract a
  `tests/content-harness.ts` — not before.
- A reviewer should check `git diff --stat entrypoints/ utils/` is empty. Any
  production change in this PR means the plan's central constraint was violated.
