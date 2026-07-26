# Plan 010: Migrate `perSiteDisabled` to `perSiteOverrides` for anyone on a previously-shipped build

> **Executor instructions**: **Read the "Precondition" section first — this plan
> may not need doing at all.** If the precondition fails, do not write any code;
> mark the plan REJECTED in `plans/README.md` with the reason and report back.
> Otherwise follow the steps, running every verification command.
>
> **Drift check (run first)**: work lives in the *uncommitted working tree* on
> commit `0f7b549`. Confirm `utils/constants.ts` contains
> `PER_SITE_OVERRIDES: 'perSiteOverrides'` and no `PER_SITE_DISABLED`. On a
> mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: working tree on commit `0f7b549`, 2026-07-26

## Precondition — check this before doing anything else

This plan is only worth executing if **version 1.0.0 of this extension was
actually distributed to real users** (published to a store, side-loaded by
testers, or otherwise installed anywhere outside this working copy).

The repository has a single commit and the working tree is entirely uncommitted,
which is weak evidence that nothing was ever shipped — but it is not proof, and
the advisor could not confirm it.

**How to decide:**

1. Ask the operator: "was v1.0.0 ever installed by anyone other than you on this
   machine?"
2. If you cannot ask, check for distribution evidence:
   `git tag` (any release tags?), `ls .output/*.zip` (a packaged artifact?), and
   whether `wxt.config.ts` ever contained a store listing ID.

- **If v1.0.0 was never distributed** → **STOP**. Mark this plan REJECTED in
  `plans/README.md` with the reason "v1.0.0 never shipped; no installed base has
  the old key". Delete nothing else. This is the expected outcome.
- **If v1.0.0 was distributed** → proceed with the steps below.

Writing a migration nobody needs is not free: it is permanent code that every
future reader has to evaluate and nobody can safely delete without the same
investigation.

## Why this matters

The per-site on/off state changed shape between builds. The old build stored:

```
storage.local["perSiteDisabled"] = { "example.com": true }   // present = disabled
```

The current build stores:

```
storage.local["perSiteOverrides"] = { "example.com": false } // explicit false = off
                                     // explicit true = on; absent = use the default
```

Two things changed at once: the key name, and the semantics — from a
*disabled-list* to a *tri-state override*. There is no migration, so on upgrade
every user's per-site choices silently disappear and every site reverts to its
default. The failure is invisible: nothing errors, sites just quietly start
behaving differently from how the user configured them.

## Current state

`utils/constants.ts`:

```ts
export const STORAGE_KEYS = {
  SETTINGS: 'settings',
  SITE_DIMENSIONS: 'siteDimensions',
  /**
   * Tri-state per site: `true` the user turned it on, `false` the user turned it
   * off, absent means fall back to `DEFAULT_OFF_HOSTS`.
   */
  PER_SITE_OVERRIDES: 'perSiteOverrides',
} as const;
```

`utils/storage.ts` reads the new key only:

```ts
export async function getSiteOverrides(): Promise<SiteOverrides> {
  const result = await browser.storage.local.get(PER_SITE_OVERRIDES_KEY);
  return (result[PER_SITE_OVERRIDES_KEY] as SiteOverrides) ?? {};
}
```

`entrypoints/background.ts` is the natural migration site — it already has an
`onInstalled` handler that distinguishes install from update:

```ts
export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason !== 'install' && details.reason !== 'update') return;
    // `getSettings` merges over the defaults, so writing the result back is what
    // fills in any field added since the previous version.
    await setSettings(await getSettings());
  });
});
```

**Semantic mapping**: old `{ host: true }` meant "user disabled this host". In
the new model that is `{ host: false }` — an explicit user "off". Old entries
with any other value, or a missing key, mean nothing was ever chosen and should
produce no override at all.

## Commands you will need

| Purpose   | Command                                | Expected on success |
|-----------|----------------------------------------|---------------------|
| Typecheck | `npm run compile`                      | exit 0              |
| Tests     | `npx vitest run`                        | all pass            |
| One file  | `npx vitest run tests/storage.test.ts` | all pass            |
| Build     | `npx wxt build`                        | exit 0              |

## Scope

**In scope**:

- `utils/storage.ts` (add one exported migration function)
- `entrypoints/background.ts` (call it on update)
- `tests/storage.test.ts` (tests for the mapping)

**Out of scope**:

- `utils/constants.ts` — do not reintroduce `PER_SITE_DISABLED` into
  `STORAGE_KEYS`. The legacy key is a one-off literal inside the migration
  function; promoting it to a named constant implies it is part of the current
  schema.
- `siteDimensions` and `settings` — neither key changed name or shape.
- The `DEFAULT_OFF_HOSTS` behaviour itself.

## Git workflow

- Branch: `advisor/010-storage-key-migration`
- Imperative subject, e.g. `Migrate legacy per-site disable list on update`.
- Do NOT push or open a PR.

## Steps

### Step 1: Add the migration function

In `utils/storage.ts`, add:

```ts
/**
 * v1.0.0 stored a disabled-list under `perSiteDisabled`, where the presence of a
 * host meant "off". v1.1.0 stores a tri-state under `perSiteOverrides`, where an
 * explicit `false` means "off" and absence means "use the shipped default".
 *
 * Runs on update only, and never overwrites a choice the user has already made in
 * the new model -- so it is safe to run more than once.
 */
export async function migrateLegacyDisabledList(): Promise<void> {
  const LEGACY_KEY = 'perSiteDisabled';
  const stored = await browser.storage.local.get(LEGACY_KEY);
  const legacy = stored[LEGACY_KEY] as Record<string, boolean> | undefined;
  if (!legacy) return;

  const current = await getSiteOverrides();
  for (const [host, wasDisabled] of Object.entries(legacy)) {
    if (wasDisabled !== true) continue;          // only a real "off" carried meaning
    if (host in current) continue;               // the new model already has a choice
    current[host] = false;                       // explicit user "off"
  }

  await browser.storage.local.set({ [PER_SITE_OVERRIDES_KEY]: current });
  await browser.storage.local.remove(LEGACY_KEY);
}
```

**Verify**: `npm run compile` → exit 0.

### Step 2: Call it on update

In `entrypoints/background.ts`:

```ts
import { getSettings, setSettings, migrateLegacyDisabledList } from '../utils/storage';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async (details) => {
    if (details.reason !== 'install' && details.reason !== 'update') return;
    await setSettings(await getSettings());
    if (details.reason === 'update') await migrateLegacyDisabledList();
  });
});
```

**Verify**: `npm run compile` → exit 0. `npx wxt build` → exit 0.

### Step 3: Test the mapping

`tests/storage.test.ts` currently imports only pure functions and has no
`browser` mock. `migrateLegacyDisabledList` touches `browser.storage.local`, so
this test needs `fakeBrowser`.

- **If `plans/005-content-script-tests.md` has landed**, `WxtVitest()` is already
  in `vitest.config.ts` and you can `import { fakeBrowser } from 'wxt/testing'`
  directly. Add the tests described below to `tests/storage.test.ts`, with
  `fakeBrowser.reset()` in a `beforeEach`.
- **If plan 005 has not landed**, STOP and report. Do not add the Vitest plugin
  as a side effect of this plan — that is plan 005's step 1, and it carries a
  risk of perturbing the whole existing suite that this plan is not scoped to
  absorb.

**Verify**: `npx vitest run tests/storage.test.ts` → all pass.

## Test plan

New tests in `tests/storage.test.ts`, in a new
`describe('migrateLegacyDisabledList', …)` block:

- **maps a legacy disable to an explicit off**: seed
  `perSiteDisabled = { 'example.com': true }`, run, expect
  `perSiteOverrides` to be `{ 'example.com': false }`.
- **removes the legacy key afterwards**: same setup, expect
  `perSiteDisabled` to be absent after running.
- **does not clobber a choice made in the new model**: seed both
  `perSiteDisabled = { 'example.com': true }` and
  `perSiteOverrides = { 'example.com': true }`; expect the override to stay
  `true` (the user's newer, explicit "on" wins).
- **is idempotent**: run twice; the second run is a no-op and does not throw.
- **no-ops when there is no legacy key**: run against empty storage; expect
  `perSiteOverrides` to remain empty.

Structural pattern: the existing `describe('resolveSiteActivation', …)` block in
the same file, plus `fakeBrowser.reset()` in `beforeEach`.

Verification: `npx vitest run` → all pass, 5 more than before this plan.

## Done criteria

- [ ] The Precondition was explicitly evaluated and the answer recorded in your
      report
- [ ] `npm run compile` exits 0
- [ ] `npx vitest run` exits 0, with 5 new passing tests
- [ ] `npx wxt build` exits 0
- [ ] `grep -n "PER_SITE_DISABLED" utils/constants.ts` returns no matches (the
      legacy key stayed a local literal)
- [ ] `git status --short` lists only `utils/storage.ts`,
      `entrypoints/background.ts` and `tests/storage.test.ts`
- [ ] `plans/README.md` status row for 010 updated to DONE or REJECTED

## STOP conditions

Stop and report back if:

- The Precondition fails — v1.0.0 was never distributed. Mark REJECTED; this is
  the most likely outcome.
- Plan 005 has not landed and step 3 therefore has no `browser` mock available.
- `utils/constants.ts` still contains `PER_SITE_DISABLED` — that means the rename
  never happened and this plan's premise is wrong.
- You find a *third* historical key shape in the wild. Two migrations chained
  together need their own plan and ordering analysis.

## Maintenance notes

- Migrations are permanent liabilities: this one runs on every update forever,
  and nobody will be able to safely delete it later without knowing the oldest
  version still in the field. If it is written, add a comment recording the
  version it migrates *from* so a future reader can retire it once that version
  is provably gone.
- The migration is deliberately idempotent and non-destructive of newer choices,
  because `onInstalled` with `reason: 'update'` can fire more than once across a
  browser's lifetime.
- A reviewer should check the direction of the boolean flip. Old `true` means
  *disabled*; new `false` means *off*. Getting that backwards silently enables
  the extension on every site the user had turned off — the exact opposite of the
  intent, with no error.
