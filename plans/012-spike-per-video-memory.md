# Plan 012 (spike): Decide whether remembered sizes should be per video rather than per site

> **Executor instructions**: This is a **design spike**, not a build plan. Its
> deliverable is a written recommendation in `plans/012-findings.md`, backed by
> real-page evidence. Do not ship a feature from this plan. When done, update the
> status row in `plans/README.md`.
>
> **Drift check (run first)**: work lives in the *uncommitted working tree* on
> commit `0f7b549`. Confirm `utils/storage.ts` still keys `persistDimensions` on
> hostname alone. On a mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: M (spike only)
- **Risk**: LOW — nothing ships from this plan
- **Depends on**: none
- **Category**: direction
- **Planned at**: working tree on commit `0f7b549`, 2026-07-26

## Why this matters

There is an asymmetry sitting in the middle of the codebase. The overlay tracks
state **per media element** — separate sizing sessions and separate cached
natural dimensions, keyed by the element itself. Storage tracks it **per
hostname**. So the runtime knows the difference between two players on a page and
the persistence layer does not.

The user-visible consequence: resize one video on a site to 150%, visit a
different page on that site with a differently-shaped player, and it gets the
first one's absolute pixel dimensions. On a site with a mix of 16:9 and vertical
video, or a wide hero player and small inline clips, the remembered size is
actively wrong more often than right.

This is a spike rather than a build plan because the right answer depends on
facts nobody has gathered: whether people watch multiple differently-sized
players per site, and whether the natural key is the video source, the page URL,
or something else. Each candidate key has a different failure mode, and picking
wrong is worse than the current behaviour.

## Current state

Storage is keyed on hostname only — `utils/storage.ts`:

```ts
export async function persistDimensions(
  hostname: string,
  dimensions: StoredDimensions,
): Promise<void> {
  const siteKey = getSiteKey(hostname);
  const all = await getSiteDimensions();
  all[siteKey] = dimensions;
  await browser.storage.local.set({ [SITE_DIMENSIONS_KEY]: all });
}
```

`getSiteKey` strips `www.` and lowercases, so `www.example.com` and
`example.com` share one entry.

The runtime already distinguishes players — `utils/resize.ts`:

```ts
  const sessions = new Map<HTMLElement, SizingSession>();
  const naturals = new Map<HTMLElement, { width: number; height: number }>();
```

The re-apply path is in `entrypoints/content.ts`:

```ts
      // Only re-apply a remembered size to a player we have not touched yet.
      if (settings.rememberSize && persisted && !view.isResized()) {
        view.setSize(persisted.width, persisted.height);
      }
```

Note that a **stored absolute pixel size** is applied to whatever player is
found. There is no ratio-awareness: a 1280×720 memory applied to a 9:16 vertical
player produces a badly wrong box, and the aspect lock does not save it because
`setSize` clamps with `lock: false`.

`DetectedPlayer` (in `utils/videoDetector.ts`) carries `kind: 'video' | 'iframe'`
and `aspectRatio`, both of which are candidate ingredients for a better key.

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run compile`   | exit 0              |
| Tests     | `npx vitest run`    | all pass            |
| Dev       | `bun run dev`       | launches a browser with the extension loaded |

## Scope

**In scope**:

- `plans/012-findings.md` (the deliverable)
- Throwaway prototype on a scratch branch, not merged.

**Out of scope**:

- Any production change on a mergeable branch.
- Changing `rememberSize` semantics without answering the questions below.

## Questions the spike must answer

1. **What is the right key?** Candidate options, each with a real failure mode:
   - *hostname* (today) — wrong whenever a site has differently-shaped players.
   - *hostname + aspect-ratio bucket* — cheap, stable across pages, and directly
     targets the observed failure. Does not distinguish a hero player from an
     inline clip of the same shape.
   - *hostname + pathname* — precise per page, but explodes in entry count on
     sites with per-video URLs and never matches on a SPA that rewrites paths.
   - *video `src` / iframe `src` origin+id* — most precise, but `src` is often a
     signed or expiring URL, so it is unstable **and** a privacy consideration:
     storing it means storing a browsing record.
2. **Should the stored value be a scale rather than pixels?** Storing `1.5×` and
   re-deriving from each player's own natural size sidesteps most of the
   shape-mismatch problem without any key change at all. What does it get wrong?
   (Consider: a user who wants "always 900px wide regardless of source".)
3. **What is the eviction policy?** Per-site has one entry per site. Anything
   more granular grows without bound in `storage.local`. Propose a cap and an
   eviction rule, and check the actual `storage.local` quota for the target
   browsers.
4. **Is there a privacy line?** Per-site keys already record which sites the user
   resized a video on. Finer keys record more. Say explicitly what the extension
   would be storing and whether it needs disclosing.
5. **Does anyone actually want this?** The honest null result. If the common case
   is one player shape per site, hostname keying is correct and simpler.

## Steps

### Step 1: Gather evidence on player-shape variety

On a scratch branch, add temporary logging of
`{ hostname, pathname, kind, aspectRatio, naturalWidth, naturalHeight }` at the
point `mount()` runs in `entrypoints/content.ts`. Load with `bun run dev` and
browse normally for a while, deliberately including:

- a site with both a hero player and inline clips
- a site with vertical/short-form video alongside 16:9
- a SPA where navigation does not reload the page
- at least one site where you would genuinely want a remembered size

Record, in `plans/012-findings.md`: how many distinct aspect ratios appeared per
hostname, and how often a remembered size would have been applied to a
differently-shaped player.

**Verify**: `plans/012-findings.md` contains the raw table plus the two counts.
Those counts decide question 5, and question 5 decides whether the rest matters.

### Step 2: Prototype the cheapest candidate first

Question 2 (store a scale, keep the hostname key) is a far smaller change than
any re-keying, so prototype it first and see how much of the problem it removes.
Sketch it, run it against the same sites from step 1, and record where it still
gets things wrong.

**Verify**: findings document a concrete "scale-only fixes N of the M observed
mismatches" number.

### Step 3: Write the recommendation

Complete `plans/012-findings.md` with an answer to each of the five questions and
a final call: keep hostname keying, switch to storing a scale, or re-key — with
the follow-on build plan sketched (files, storage shape, migration for existing
`siteDimensions` entries, effort).

## Done criteria

- [ ] `plans/012-findings.md` exists containing: the real-browsing evidence table
      from step 1, the scale-only prototype result from step 2, a written answer
      to each of the five questions, and a final recommendation
- [ ] The recommendation explicitly addresses eviction (question 3) and privacy
      (question 4), even if the answer is "not applicable because we recommend
      keeping hostname keying"
- [ ] Any prototype code is on a scratch branch and **not** merged
- [ ] `git status` on the main working branch shows no source modifications
- [ ] `plans/README.md` status row for 012 updated to DONE

## STOP conditions

Stop and report back if:

- Step 1's evidence shows one aspect ratio per hostname in essentially every
  case. That is a null result and the correct outcome is "keep hostname keying" —
  write it up and stop; do not proceed to step 2 looking for a reason to build.
- `bun run dev` cannot launch a browser. The evidence is the spike.
- You conclude the right key is the media `src`. That has privacy implications
  this plan cannot pre-authorise — write the recommendation, flag the concern
  prominently, and let the operator decide.

## Maintenance notes

- Whatever is decided, existing `siteDimensions` entries need a migration story.
  See `plans/010-storage-key-migration.md` for the shape a migration takes here
  and the liability it creates.
- Interacts with plan 002: the re-apply path depends on `naturalWidth` being
  correct. If sizes are ever stored as a *scale*, that dependency becomes much
  stronger — a wrong natural size silently scales every future visit, not just
  the current session.
- The `!view.isResized()` guard in the re-apply path is load-bearing and easy to
  lose in a re-key: without it, a remembered size overwrites a resize the user
  just made by hand.
