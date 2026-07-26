# Plan 008: Remove starter scaffolding and dead exports

> **Executor instructions**: Follow this plan step by step. Run every
> verification command. If anything in "STOP conditions" occurs, stop and report.
> When done, update the status row in `plans/README.md`.
>
> **Drift check (run first)**: work lives in the *uncommitted working tree* on
> commit `0f7b549`. Confirm the `package.json` excerpt below matches. On a
> mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (but see step 4 — one deletion is conditional on
  `plans/001-handle-tab-order.md`)
- **Category**: tech-debt
- **Planned at**: working tree on commit `0f7b549`, 2026-07-26

## Why this matters

The project was scaffolded from `wxt-react-starter` and still carries the
starter's identity and assets. `package.json` names the project after the
template with a placeholder description, and `public/wxt.svg` — the WXT logo —
is copied into `.output/chrome-mv3/` on every build and would ship to users. None
of this breaks anything; it is the difference between a project and a template
someone edited.

Alongside it are three exports nothing imports. Dead exports are worse than dead
locals: the compiler cannot flag them, so they accumulate and each one implies a
caller that does not exist.

## Current state

`package.json`, first lines:

```json
{
  "name": "wxt-react-starter",
  "description": "manifest.json description",
  "private": true,
  "version": "0.0.0",
```

The real product metadata already lives in `wxt.config.ts` and is what reaches
the manifest, so `package.json`'s fields are purely developer-facing:

```ts
  manifest: {
    name: 'Video Player Resizer',
    description: 'Resize the video on any page by dragging its edges.',
    version: '1.1.0',
```

Starter assets, confirmed present:

- `public/wxt.svg` — copied verbatim into every build (visible in `wxt build`
  output at 1.07 kB).
- `assets/react.svg` — unreferenced; `assets/` contains nothing else.

Dead exports, each verified to have zero non-declaration references:

- `EDGE_HANDLES` in `utils/constants.ts`
- `resetAllDimensions` in `utils/storage.ts`
- `HANDLE_LABELS` in `utils/constants.ts` — **only dead once plan 001 has
  landed**; before that, `utils/resize.ts` still imports it.

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run compile`   | exit 0              |
| Tests     | `npx vitest run`    | all pass            |
| Build     | `npx wxt build`     | exit 0              |

## Scope

**In scope**:

- `package.json`
- `public/wxt.svg` (delete)
- `assets/react.svg` (delete)
- `utils/constants.ts`
- `utils/storage.ts`

**Out of scope**:

- `public/icon/*.png` — these are the extension's actual icons, referenced by the
  generated manifest. Deleting them breaks the build.
- `wxt.config.ts` — its manifest block is already correct.
- Any exported symbol not named in this plan. "Looks unused" is not the same as
  verified unused; the three here were each checked.

## Git workflow

- Branch: `advisor/008-repo-hygiene`
- Imperative subject, e.g. `Drop starter scaffolding and unused exports`.
- Do NOT push or open a PR.

## Steps

### Step 1: Correct the package metadata

In `package.json`, change the three fields to match the product (leave every
other field, including `"private": true`, exactly as-is):

```json
  "name": "video-player-resizer",
  "description": "Resize the video on any page by dragging its edges.",
  "version": "1.1.0",
```

The version matches `wxt.config.ts`'s `manifest.version`, which is the number
users actually see.

**Verify**: `npx wxt build` → exit 0, and the build output still reports
`Video Player Resizer` behaviour unchanged. `node -e "console.log(require('./package.json').name)"`
→ `video-player-resizer`.

### Step 2: Delete the starter assets

```
rm public/wxt.svg
rm assets/react.svg
rmdir assets
```

`rmdir` will fail harmlessly if `assets/` is not empty — if it is not, STOP and
report what else is in there.

**Verify**: `npx wxt build` → exit 0, and the printed file list no longer
contains `wxt.svg`. `ls assets 2>/dev/null` → no such directory.

### Step 3: Remove the two unconditionally-dead exports

In `utils/constants.ts`, delete the `EDGE_HANDLES` declaration:

```ts
export const EDGE_HANDLES: HandlePosition[] = ['t', 'r', 'b', 'l'];
```

In `utils/storage.ts`, delete `resetAllDimensions`:

```ts
export async function resetAllDimensions(): Promise<void> {
  await browser.storage.local.set({ [SITE_DIMENSIONS_KEY]: {} });
}
```

**Verify**: `npm run compile` → exit 0. `npx vitest run` → all pass.
`grep -rn "EDGE_HANDLES\|resetAllDimensions" utils entrypoints tests` → no matches.

### Step 4: Remove `HANDLE_LABELS` only if plan 001 has landed

Run: `grep -n "HANDLE_LABELS" utils/resize.ts`

- **No matches** → plan 001 has landed and the symbol is dead. Delete the
  `HANDLE_LABELS` declaration from `utils/constants.ts`.
- **Any match** → plan 001 has not landed. **Skip this step entirely** and note
  it in your report. Do not remove the import from `utils/resize.ts` to make the
  deletion possible; that is plan 001's change and doing it here would duplicate
  work and confuse the diff.

**Verify**: `npm run compile` → exit 0. `npx vitest run` → all pass.

### Step 5: Full verification

**Verify**: `npm run compile` → exit 0; `npx vitest run` → all pass with the same
count as before this plan; `npx wxt build` → exit 0.

## Test plan

No new tests. This plan deletes unreferenced code and files; the existing suite
passing unchanged **is** the verification that nothing referenced them. If any
test fails, a symbol was not as dead as this plan claims — report which, and stop.

## Done criteria

- [ ] `npm run compile` exits 0
- [ ] `npx vitest run` exits 0 with the same test count as before this plan
- [ ] `npx wxt build` exits 0 and its file list does not mention `wxt.svg`
- [ ] `grep -rn "EDGE_HANDLES\|resetAllDimensions" utils entrypoints tests` → no matches
- [ ] `ls public/wxt.svg assets/react.svg 2>&1` → both report "No such file"
- [ ] `grep '"name"' package.json` → `video-player-resizer`
- [ ] `plans/README.md` status row for 008 updated to DONE, noting whether step 4
      ran or was skipped

## STOP conditions

Stop and report back if:

- `package.json` does not match the "Current state" excerpt.
- `assets/` contains files other than `react.svg`.
- Removing any symbol in step 3 produces a typecheck or test failure — that means
  a reference exists that the audit missed; report the reference rather than
  restoring the symbol silently.
- `npx wxt build` fails after deleting `public/wxt.svg`. That would mean
  something references it; report the reference.

## Maintenance notes

- `package.json`'s `version` and `wxt.config.ts`'s `manifest.version` are now the
  same number but are **not** linked — WXT reads the manifest version from its own
  config. Whoever cuts the next release has to bump both, or wire
  `manifest.version` to read from `package.json`. Worth doing at the first real
  release; not worth doing for a project with one commit.
- A reviewer should confirm `public/icon/*.png` survived. They look like starter
  assets (they are the default WXT icon set) but the generated manifest
  references them, so deleting them breaks the extension. Replacing them with a
  real icon is a design task, deliberately not in this plan.
