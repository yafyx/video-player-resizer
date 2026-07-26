# Plan 011 (spike): Show why detection found nothing, instead of just saying it found nothing

> **Executor instructions**: This is a **design spike**, not a build plan. Its
> deliverable is a short written proposal plus a throwaway prototype — not
> production code. Do not ship a feature from this plan. When done, update the
> status row in `plans/README.md` and leave your findings in
> `plans/011-findings.md`.
>
> **Drift check (run first)**: work lives in the *uncommitted working tree* on
> commit `0f7b549`. Confirm `utils/videoDetector.ts` exports both `findPlayers`
> and `scoreCandidate`. On a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M (spike only; the build that follows is separately estimated)
- **Risk**: LOW — nothing ships from this plan
- **Depends on**: none
- **Category**: direction
- **Planned at**: working tree on commit `0f7b549`, 2026-07-26

## Why this matters

The hardest question this extension raises is "why didn't it find my player?" —
and it is asked from a position of zero information. Today the popup's empty
state says:

> **No video on this page** — Start a video, or scroll it into view, and reopen
> this popup.

That is a guess presented as advice. The user cannot tell whether the page has no
`<video>` at all, whether a candidate was found and rejected for being too small,
whether an iframe was skipped because its `src` did not match a known provider,
or whether the site simply ships disabled.

The extension already computes exactly this information and throws it away.
`scoreCandidate()` returns `0` for every rejection, having just evaluated the
specific reason. Surfacing the ranked list turns the single most likely support
question into something the user answers themselves — and turns bug reports from
"doesn't work on site X" into "site X, candidate iframe 640×360, score 0".

Grounding: this is not a hypothetical. The extension's own README and this
session's history both record an unresolved "does it work on vlr.gg?" question
that this feature would have answered immediately.

## Current state

`utils/videoDetector.ts` already exports the raw material:

```ts
/** Every viable player on the page, best first. */
export function findPlayers(): DetectedPlayer[]

/** Is this element one we would consider resizing? Used for hover-to-switch. */
export function isPlayerCandidate(el: HTMLElement): boolean

export function scoreCandidate(el: HTMLElement): number
```

`scoreCandidate` is where every rejection decision is made. It returns `0` at
four distinct points, each for a different reason:

- below `MIN_CANDIDATE_WIDTH` (160) or `MIN_CANDIDATE_HEIGHT` (90)
- `isElementVisible()` false (zero box, `display:none`, `visibility:hidden`,
  `opacity:0`)
- an anonymous iframe narrower than `GENERIC_EMBED_MIN_WIDTH` (300)
- an anonymous iframe whose aspect ratio falls outside
  `GENERIC_EMBED_MIN_RATIO`…`GENERIC_EMBED_MAX_RATIO` (1.3–2.6)

`collectMediaElements()` returns every `<video>` and `<iframe>` it can reach —
including through open shadow roots and same-origin frames — *before* scoring, so
the "found N elements, rejected all of them" number is already available.

The popup's message protocol is in `utils/messages.ts`; `PlayerState` is what
crosses the boundary. The empty state lives in `entrypoints/popup/App.tsx`.

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Typecheck | `npm run compile`   | exit 0              |
| Tests     | `npx vitest run`    | all pass            |
| Dev       | `bun run dev`       | launches a browser with the extension loaded |

## Scope

**In scope** — the spike may create:

- `plans/011-findings.md` (the deliverable)
- Throwaway prototype edits, **committed to a scratch branch only** and not
  merged.

**Out of scope**:

- Any production change on a branch intended for merge.
- Adding a diagnostics UI without first answering the questions below.

## Questions the spike must answer

1. **What does a rejection reason look like as data?** `scoreCandidate` currently
   returns `number`. Options: return a discriminated result
   (`{ score: 0, reason: 'too-small' } | { score: number }`), or add a parallel
   `explainCandidate()` used only by diagnostics. Which keeps the hot path — this
   function runs on every `pointerover` — free of extra allocation? Measure, do
   not assume.
2. **Where does the boundary sit?** Diagnostics have to cross the content-script
   → popup message boundary. Does `PlayerState` gain an optional
   `diagnostics?: CandidateReport[]`, or is there a separate
   `{ type: 'getDiagnostics' }` request that is only sent when the popup is about
   to render the empty state? The second keeps the common path's payload small.
3. **How much is useful without being noise?** A ranked list of every `<iframe>`
   on a news site is dozens of rows. Propose a cap and an ordering, and say what
   is dropped.
4. **Does it need to name the element?** A CSS-path or `tagName + dimensions +
   truncated src` is enough to act on. Note that iframe `src` values can contain
   query parameters, including tokens on some sites — decide what is safe to
   display and truncate accordingly. **Never display a full third-party URL with
   its query string.**
5. **Is this a popup feature or a devtools-shaped one?** Ordinary users want "it
   works" or "turn it on here"; the ranked list is for the person filing the
   report. Consider putting it behind a disclosure ("Why no video?") rather than
   in the default empty state.

## Steps

### Step 1: Establish the real-world baseline

On a scratch branch, add a temporary `console.table` of
`collectMediaElements().map(el => ({ tag: el.tagName, w, h, score: scoreCandidate(el) }))`
behind a hardcoded flag in the content script. Load the extension with
`bun run dev` and record the output on at least five pages, chosen to span the
failure modes:

- the vlr.gg article this extension was reported broken on:
  `https://www.vlr.gg/720033/americas-recent-victors-start-strong-in-week-1`
- a page with a plain `<video>` (any MDN video demo)
- a page with a known embed (a YouTube embed on a third-party blog)
- a news site heavy with ad iframes
- a site using web components / shadow DOM

**Verify**: `plans/011-findings.md` contains the five tables. This is the
deliverable that makes the rest of the design decidable — do not skip to
proposing a UI.

### Step 2: Answer the five questions in writing

Write `plans/011-findings.md` with a section per question, each with a
recommendation and the evidence from step 1 behind it. Where you propose a type
change, include the exact proposed signature.

### Step 3: Propose the follow-on build plan

Close `plans/011-findings.md` with a "Recommended build plan" section: the file
list, the message-protocol change, an effort estimate, and — importantly — a
recommendation on whether to build it at all. "Not worth it, here is why" is a
valid and welcome outcome.

## Done criteria

- [ ] `plans/011-findings.md` exists and contains: five real-page candidate
      tables, a written answer to each of the five questions, and a
      recommended-build-plan section ending in a build/don't-build call
- [ ] Any prototype code is on a scratch branch and **not** merged
- [ ] `git status` on the main working branch shows no source modifications
- [ ] `plans/README.md` status row for 011 updated to DONE

## STOP conditions

Stop and report back if:

- `bun run dev` cannot launch a browser in your environment — step 1's real-page
  data is the whole point of the spike, and answering the questions from
  imagination would produce a confidently wrong design.
- The vlr.gg page shows a **detected** player and a mounted overlay. That would
  mean the original bug is already fixed and this spike's strongest grounding
  example is stale; report it, because it changes the priority.
- You find yourself writing production-quality code. That is the next plan, not
  this one.

## Maintenance notes

- If this ships, the diagnostics output becomes a de facto support contract:
  people will paste it into issues, so its wording and stability matter more
  than typical UI copy.
- Whatever shape `scoreCandidate` ends up with must not regress the
  `pointerover` hot path, which calls `isPlayerCandidate` on every pointer entry
  into a video or iframe.
- Related: plan 007 changes when detection runs. Diagnostics that report "nothing
  found" need to be clear about *when* they last looked, or they will be
  misleading on a slow-loading page.
