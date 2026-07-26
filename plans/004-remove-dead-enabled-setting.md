# Plan 004: Remove the `settings.enabled` flag that can never be changed

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise. When
> done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: this repo's work lives in the *uncommitted working
> tree* on top of commit `0f7b549`. Confirm each "Current state" excerpt below
> against the live files before proceeding. On a mismatch, treat it as a STOP
> condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: working tree on commit `0f7b549`, 2026-07-26

## Why this matters

`ExtensionSettings.enabled` looks like a global on/off switch. It is read in two
places and gates the entire content script, but **nothing ever writes it**. The
popup's on/off toggle sends a `setEnabled` message, which the content script
routes to `setSiteEnabled()` — a per-site override stored under a different key
in a different storage area. `settings.enabled` is therefore permanently `true`.

The cost is a phantom state axis. Every reader of `active()` has to reason about
a boolean that has exactly one possible value, and the next person to read
`ExtensionSettings` will reasonably assume a global kill switch exists and build
on it. Browsers already provide a global disable for extensions, so the honest
fix is to delete the field rather than wire it up.

## Current state

The declaration, `utils/storage.ts:3-8`:

```ts
export interface ExtensionSettings {
  enabled: boolean;
  lockAspectRatio: boolean;
  allowOverflow: boolean;
  rememberSize: boolean;
}
```

The default, `utils/constants.ts:185-195` (approximately — confirm the exact
lines):

```ts
export const DEFAULT_SETTINGS = {
  /** Master switch. Per-site disable is stored separately. */
  enabled: true,
  /** Constrain drags to the player's intrinsic ratio. Shift inverts this per-drag. */
  lockAspectRatio: true,
  ...
```

Reader 1, `entrypoints/content.ts:43-44`:

```ts
    /** The global switch and the per-site decision both have to be on. */
    const active = () => settings.enabled && activation.active;
```

Reader 2, `entrypoints/popup/App.tsx:134`:

```ts
  const live = state.activeHere && settings.enabled;
```

The only writer of any `enabled` concept, `utils/storage.ts:124` — note it writes
`perSiteOverrides` in `storage.local`, never `settings` in `storage.sync`:

```ts
export async function setSiteEnabled(hostname: string, enabled: boolean): Promise<void> {
```

Proof there is no other writer: `setSettings()` is called from exactly two places
— `entrypoints/background.ts` (which re-writes the merged defaults on install)
and the `case 'setSetting'` branch of `entrypoints/content.ts`, which is only
ever reached with `key` values of `lockAspectRatio`, `allowOverflow`, or
`rememberSize` (see the three `SettingRow`s in `entrypoints/popup/App.tsx`).

**Repo conventions**: settings are merged over `DEFAULT_SETTINGS` on read
(`getSettings()` in `utils/storage.ts`), so removing a field is backward-safe —
a stored object containing a stale `enabled` key is simply ignored by the
spread.

## Commands you will need

| Purpose   | Command             | Expected on success    |
|-----------|---------------------|------------------------|
| Typecheck | `npm run compile`   | exit 0, no output      |
| Tests     | `npx vitest run`    | all pass (85 baseline) |
| Build     | `npx wxt build`     | exit 0                 |

## Scope

**In scope**:

- `utils/storage.ts`
- `utils/constants.ts`
- `entrypoints/content.ts`
- `entrypoints/popup/App.tsx`

**Out of scope**:

- `utils/messages.ts` — the `setEnabled` **message** stays. It is the per-site
  toggle and is correctly wired; only the `settings.enabled` **field** is dead.
  Do not remove or rename the message.
- `setSiteEnabled` / `resolveSiteActivation` / `perSiteOverrides` in
  `utils/storage.ts` — this is the real, working switch. Leave it entirely alone.
- `tests/storage.test.ts` — it covers `resolveSiteActivation` and friends, none
  of which touch `settings.enabled`.

## Git workflow

- Branch: `advisor/004-remove-dead-enabled-setting`
- Imperative subject, e.g. `Remove the unreachable global enabled setting`.
- Do NOT push or open a PR.

## Steps

### Step 1: Drop the field from the type and the defaults

In `utils/storage.ts`, remove `enabled: boolean;` from `ExtensionSettings`.

In `utils/constants.ts`, remove the `enabled: true,` entry and its `/** Master
switch… */` doc comment from `DEFAULT_SETTINGS`.

**Verify**: `npm run compile` → **fails** with errors at
`entrypoints/content.ts` and `entrypoints/popup/App.tsx`. This failure is
expected and is how you locate every reader; steps 2 and 3 clear it.

### Step 2: Simplify the content script's activation predicate

In `entrypoints/content.ts`, replace:

```ts
    /** The global switch and the per-site decision both have to be on. */
    const active = () => settings.enabled && activation.active;
```

with:

```ts
    /**
     * Per-site is the only switch. A global one would duplicate the browser's own
     * extension toggle, so `resolveSiteActivation` is the whole decision.
     */
    const active = () => activation.active;
```

Do not remove the `settings` variable itself — it still carries
`lockAspectRatio`, `allowOverflow` and `rememberSize`.

**Verify**: `npm run compile` → errors remaining only in
`entrypoints/popup/App.tsx`.

### Step 3: Simplify the popup

In `entrypoints/popup/App.tsx`, replace:

```ts
  const live = state.activeHere && settings.enabled;
```

with:

```ts
  const live = state.activeHere;
```

Then check whether the `settings` binding immediately above it is still used —
it is, by the three `SettingRow`s near the bottom of the component
(`settings.lockAspectRatio`, `settings.allowOverflow`, `settings.rememberSize`).
Leave it in place.

**Verify**: `npm run compile` → exit 0, no output.

### Step 4: Confirm nothing else referenced the field

**Verify**:
`grep -rn "settings.enabled\|enabled: true\|enabled: boolean" utils entrypoints tests`
→ no matches. (`setSiteEnabled(hostname, enabled: boolean)` is a *parameter*, not
the field — if grep shows only that signature line in `utils/storage.ts:124`,
that is correct and expected.)

### Step 5: Full verification

**Verify**: `npx vitest run` → all 85 pass, unchanged. Then `npx wxt build` →
exit 0.

If any test fails, it is asserting on the removed field; report which one rather
than editing the assertion, because that would mean a reader existed that this
plan did not account for.

## Test plan

No new tests. This plan removes state rather than adding behaviour, and the
existing suite proves the removal is inert:

- `tests/storage.test.ts` covers `resolveSiteActivation` — the switch that
  actually works — and must keep passing untouched.
- The 85-test baseline passing unchanged **is** the verification: nothing
  depended on the field.

If you find yourself wanting to write a test for this change, that is a signal
the change grew beyond its scope — STOP and report.

## Done criteria

- [ ] `npm run compile` exits 0
- [ ] `npx vitest run` exits 0 and reports 85 passing tests (unchanged from
      baseline — no tests added or removed)
- [ ] `npx wxt build` exits 0
- [ ] `grep -rn "settings\.enabled" utils entrypoints tests` returns no matches
- [ ] `grep -n "enabled" utils/constants.ts` returns no matches
- [ ] `grep -n "setSiteEnabled" utils/storage.ts` still returns a match (the real
      switch survived)
- [ ] `git status --short` lists only the four in-scope files as modified
- [ ] `plans/README.md` status row for 004 updated to DONE

## STOP conditions

Stop and report back if:

- Any excerpt in "Current state" does not match the live file.
- `grep` in step 4 finds a reader in a file not listed in Scope — that is a
  reader this plan did not know about, and the removal needs re-planning.
- Any of the 85 existing tests fails after the change.
- You discover a code path that *does* write `settings.enabled`. The entire
  premise of this plan is that none exists; if one does, the correct outcome is
  the opposite change (wire the popup to it), and that needs a new plan.

## Maintenance notes

- **If a global kill switch is genuinely wanted later**, the cheap version is a
  fourth `SettingRow` in `entrypoints/popup/App.tsx` sending
  `{ type: 'setSetting', key: 'enabled', value }` plus re-adding the field —
  roughly ten lines, because `setSetting` already accepts any
  `keyof ExtensionSettings`. It was removed for being unreachable, not for being
  a bad idea.
- Stored settings objects from before this change will still contain
  `enabled: true`. That is harmless: `getSettings()` spreads over
  `DEFAULT_SETTINGS`, so unknown keys survive in storage but are never read. No
  migration is needed.
- A reviewer should confirm the `setEnabled` *message* still exists and still
  maps to `setSiteEnabled` — conflating the two is the most likely way to break
  the per-site toggle while doing this cleanup.
