# Plan 013: Add a keyboard shortcut that toggles the extension on the current site

> **Executor instructions**: Follow this plan step by step. Run every
> verification command. If anything in "STOP conditions" occurs, stop and report.
> When done, update the status row in `plans/README.md`.
>
> **Drift check (run first)**: work lives in the *uncommitted working tree* on
> commit `0f7b549`. Confirm `wxt.config.ts` has no `commands` key and
> `utils/messages.ts` has no `toggleSite` request. On a mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (land after `plans/005-content-script-tests.md` if you want
  the new message covered by the orchestration harness)
- **Category**: direction
- **Planned at**: working tree on commit `0f7b549`, 2026-07-26

## Why this matters

The popup exists almost entirely to flip one switch: whether the extension runs
on this site. Everything else in it — presets, the aspect lock, size memory — is
either rarely changed or already reachable by dragging. Yet turning the extension
off on an annoying site costs a click on the toolbar icon, a wait for the popup,
and a second click.

A keyboard shortcut collapses that to one keystroke and removes the main reason
to open the popup at all. The manifest currently declares no `commands` at all,
so this is additive with no interaction surface to break.

Grounding: `DEFAULT_OFF_HOSTS` already encodes the insight that this extension is
unwanted on some sites. The shortcut is the same insight applied to the sites the
shipped list does not know about.

## Current state

`wxt.config.ts` — no `commands` key today:

```ts
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Video Player Resizer',
    description: 'Resize the video on any page by dragging its edges.',
    version: '1.1.0',
    permissions: ['storage'],
    // Needed both to run the content script everywhere and to let the popup
    // message it back.
    host_permissions: ['<all_urls>'],
  },
});
```

`utils/messages.ts` — the request union the content script understands:

```ts
export type ContentRequest =
  | { type: 'getState' }
  | { type: 'setEnabled'; value: boolean }
  | { type: 'setSetting'; key: keyof ExtensionSettings; value: boolean }
  | { type: 'applyPreset'; scale: number }
  | { type: 'setSize'; width: number; height: number }
  | { type: 'resetSize' }
  | { type: 'cyclePlayer' };
```

`entrypoints/content.ts` handles `setEnabled` by writing the per-site override:

```ts
        case 'setEnabled': {
          await setSiteEnabled(hostname, message.value);
          await refresh();
          applyActivation();
          break;
        }
```

`activation` is the content script's in-memory `SiteActivation`
(`{ active: boolean; byDefault: boolean }`), so the current state needed for a
*toggle* is already local — no extra storage read is required.

`entrypoints/background.ts` is currently a single `onInstalled` listener.

**Repo conventions**: message types are a discriminated union on `type`; every
handler branch ends by returning `snapshot()`; comments explain *why*.

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run compile`   | exit 0              |
| Tests     | `npx vitest run`    | all pass            |
| Build     | `npx wxt build`     | exit 0              |
| Manual    | `bun run dev`       | launches a browser with the extension loaded |

## Scope

**In scope**:

- `wxt.config.ts`
- `utils/messages.ts`
- `entrypoints/content.ts`
- `entrypoints/background.ts`
- `tests/content.test.ts` (only if plan 005 has landed)

**Out of scope**:

- `entrypoints/popup/**` — the popup toggle already works; do not duplicate the
  toggle logic there.
- Additional shortcuts (reset size, cycle player, presets). One command is the
  scope. Chrome caps *suggested* keys at four commands and every extra shortcut
  is another chance to collide with a page or another extension.
- `permissions` in the manifest — `commands` needs no permission entry.

## Git workflow

- Branch: `advisor/013-keyboard-command`
- Imperative subject, e.g. `Add a shortcut to toggle the extension per site`.
- Do NOT push or open a PR.

## Steps

### Step 1: Declare the command in the manifest

In `wxt.config.ts`, add a `commands` block inside `manifest`:

```ts
    commands: {
      'toggle-site': {
        suggested_key: {
          default: 'Alt+Shift+V',
          mac: 'Alt+Shift+V',
        },
        description: 'Turn the video resizer on or off for this site',
      },
    },
```

`Alt+Shift+V` is chosen because Chrome reserves `Ctrl+Shift+` combinations
heavily and `Alt+Shift` collides less with page-level shortcuts. The user can
rebind it from the browser's extension-shortcuts page regardless.

**Verify**: `npx wxt build` → exit 0, then
`grep -A6 '"commands"' .output/chrome-mv3/manifest.json` → shows the
`toggle-site` entry.

### Step 2: Add the message type

In `utils/messages.ts`, add one member to `ContentRequest`:

```ts
  | { type: 'toggleSite' }
```

Place it directly after `setEnabled`, since they are the same concern.

**Verify**: `npm run compile` → **fails** in `entrypoints/content.ts` if its
switch is exhaustive over the union. If it does not fail, check that the switch
has a `default` branch — it does (`case 'getState': default:`), so a missing
handler would silently fall through to `getState` behaviour. Do not rely on the
compiler here; step 3 is mandatory.

### Step 3: Handle it in the content script

In `entrypoints/content.ts`, add a case directly after `setEnabled`:

```ts
        case 'toggleSite': {
          // `activation` is already resolved in memory, so the toggle needs no
          // extra storage read to know which way to flip.
          await setSiteEnabled(hostname, !activation.active);
          await refresh();
          applyActivation();
          break;
        }
```

**Verify**: `npm run compile` → exit 0.

### Step 4: Relay the command from the background

In `entrypoints/background.ts`, add a `commands` listener alongside the existing
`onInstalled` one:

```ts
  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'toggle-site') return;

    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    try {
      await browser.tabs.sendMessage(tab.id, { type: 'toggleSite' });
    } catch {
      // No content script in this tab -- a browser settings page, the extension
      // gallery, or a tab that predates the last extension reload. Nothing to do.
    }
  });
```

**Verify**: `npm run compile` → exit 0. `npx wxt build` → exit 0.

### Step 5: Verify by hand in a real browser

Automated tests cannot exercise `browser.commands`. Run `bun run dev`, open any
ordinary site with a video, and confirm:

1. The overlay appears on hover.
2. Pressing `Alt+Shift+V` removes it, and the player returns to its original size.
3. Pressing `Alt+Shift+V` again brings it back.
4. Opening the popup shows the toggle in the matching position — proving the
   shortcut and the popup share one source of truth rather than diverging.

**Verify**: all four steps behave as described. Record the result in your report;
this is the only verification that covers the manifest wiring.

## Test plan

- **If `plans/005-content-script-tests.md` has landed**: add one test to
  `tests/content.test.ts` proving the message flips state and tears the overlay
  down, modelled on the existing
  `it('tears the overlay down when the user switches the site off', …)`:
  send `{ type: 'toggleSite' }`, expect `activeHere` to become `false` and the
  overlay host to be gone; send it again, expect `activeHere` back to `true`.
- **If plan 005 has not landed**: no automated test is possible; step 5's manual
  check is the verification. Say so explicitly in your report rather than
  claiming coverage.
- The background relay and the manifest entry are not unit-testable here and are
  covered by step 5 only.

## Done criteria

- [ ] `npm run compile` exits 0
- [ ] `npx vitest run` exits 0 (with one new test if plan 005 has landed)
- [ ] `npx wxt build` exits 0
- [ ] `grep -c "toggle-site" .output/chrome-mv3/manifest.json` returns at least 1
- [ ] Step 5's four manual checks all pass, and the result is recorded in your report
- [ ] `git status --short` lists only the in-scope files
- [ ] `plans/README.md` status row for 013 updated to DONE

## STOP conditions

Stop and report back if:

- `npx wxt build` does not emit the `commands` block into the generated
  manifest — that means WXT handles commands differently than this plan assumes.
- The shortcut does nothing in step 5 **and** the generated manifest is correct.
  The likely cause is a conflict with an existing browser or extension binding;
  report it rather than picking a different key combination unilaterally, since
  key choice is a product decision.
- You find yourself adding a second command "while you are in there". One command
  is the scope; a second needs its own justification.

## Maintenance notes

- `suggested_key` is exactly that: a suggestion. If it conflicts with an existing
  binding, Chrome silently installs the command with **no** shortcut and the user
  must assign one manually. There is no API to detect this, so a support report
  of "the shortcut does nothing" should first check the browser's
  extension-shortcuts page.
- The background listener swallows `sendMessage` errors on purpose: pressing the
  shortcut on a restricted page is a normal thing to do, not an error. Do not add
  logging there — it would fire constantly for people who use the shortcut out of
  habit.
- If more commands are added later, note that Chrome only honours
  `suggested_key` for the first four; beyond that they are unbound by default.
