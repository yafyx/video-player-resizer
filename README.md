# Video Player Resizer

A browser extension that puts drag handles on the video on any page and resizes
the media element itself, so the change actually sticks.

```bash
bun install
bun run dev        # loads an unpacked build into a fresh browser profile
bun run test
bun run compile    # tsc --noEmit
bun run build
```

## How it works

Three layers, each solving a different half of "resize the video".

**`utils/videoDetector.ts` — finding the player.** Walks the document for
`<video>` elements and player `<iframe>`s, descending into open shadow roots and
same-origin subframes, then scores each candidate by area, how much of it is on
screen, and whether it is actually playing. Known embed hosts outrank anonymous
iframes so an ad slot never wins. Once a media element is chosen it resolves a
*sizing chain*: the outermost ancestor that still tightly wraps the player, plus
every element between that ancestor and the media element.

The chain matters because the visible box is often not the `<video>`. A
responsive embed is usually an absolutely-positioned iframe inside a wrapper
whose height is made entirely of percentage padding — set `height` on the iframe
and nothing moves.

**`utils/sizing.ts` — making the size stick.** Writes every property with
`!important` and neutralises the four things real pages use to override an
explicit box: utility classes pinning `width: 100%`, `max-width` clamps,
intrinsic-ratio boxes (`aspect-ratio` and the `padding-bottom: 56.25%` hack), and
clipping ancestors that would cut off a player grown past its column. Every
displaced inline value is recorded so reset puts the page back exactly.

**`utils/resize.ts` — the overlay.** A fixed, shadow-DOM overlay appended to
`<html>` that tracks the player's bounding rect, rather than DOM injected into
the player. That is what makes iframe players work at all: an `<iframe>` can hold
child nodes but never renders them. During a drag a full-viewport shield goes up,
because the pointer crossing into a cross-origin player frame otherwise kills the
gesture — that frame's document swallows the move events.

**`utils/theme.ts` — borrowing the site's palette.** The frame takes its colour
from the page: `<meta name="theme-color">`, then conventional brand custom
properties (`--accent`, `--primary`, `--brand`, …), then the colour most of the
page's links share. Nothing is used raw — a brand colour is picked to sit on that
site's background, not on an arbitrary frame of video. Everything is normalised
in OKLCH so the hue, the part that actually carries the brand, survives untouched
while lightness is pulled into a legible band and chroma is floored so a muted
brand doesn't read as grey. Chroma-only gamut clamping keeps the hue intact on
the way back to sRGB.

## Off until you ask for it

Resize ships switched **off** on every site. Hovering a player does nothing
until you flip the popup's "Resize on this site" toggle on for that host —
after that it stays on there. That also keeps it out of the way on sites with
their own sizing controls (YouTube, Netflix, Twitch, …) and on feeds and
video calls, without needing a special case for any of them.

## Using it

Hover a player to reveal its handles, then drag any edge or corner. The frame
follows Figma's selection model: a hairline outline, four small corner squares,
and invisible edge strips where the cursor does the signalling.

| Input | Effect |
| --- | --- |
| Drag a handle | Resize |
| <kbd>Shift</kbd> while dragging | Invert the aspect-ratio lock |
| <kbd>Alt</kbd> while dragging | Disable snapping |
| <kbd>Esc</kbd> while dragging | Cancel, back to the pre-drag size |
| Double-click a handle | Back to the original size |
| Focus a handle, arrow keys | Resize in 24px steps (<kbd>Shift</kbd> for 4px) |
| Hover a different video | Retarget the overlay to it |

Sizes are remembered per site and re-applied on the next visit. The popup has
per-site on/off, scale presets, and toggles for the aspect lock, overflow, and
size memory.
