# Video Player Resizer

A browser extension that puts drag handles on the video on any page and resizes
the media element itself, so the change actually sticks.

```bash
bun install
bun run dev        # loads an unpacked build into a fresh browser profile
bun run test
bun run compile    # tsc --noEmit
bun run build
bun run verify:release
bun run package:chrome  # writes the uploadable ZIP under .output/
```

The release gate checks the generated Manifest V3 package, icon dimensions,
permission surface, store artwork dimensions, and starter-file cleanup before
the Chrome ZIP is produced. See [STORE_LISTING.md](STORE_LISTING.md) for the
listing copy, privacy disclosures, test instructions, and the final dashboard
fields that still need a public support URL and privacy-policy URL.

For manual testing, open any standalone HTML file under `examples/` from a
local HTTP server, then enable the current site in the extension.

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

**`utils/picker.ts` + `utils/elementPath.ts` — overriding all of that.** Detection
is a heuristic, and on a page it reads wrongly there is no argument to be had with
it — you can see the box you want. The picker is a modal hover-and-click mode that
highlights whatever is under the cursor and hands that element straight to the
sizing chain, skipping the climb entirely. `elementPath.ts` turns the choice into
a string — `:nth-child()` segments, anchored on an id where a stable-looking one
exists, split at every shadow boundary — so it can be restored on the next visit.
Restoring is best-effort by design: the moment a path stops resolving, the
extension falls back to automatic detection rather than guessing.

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
until you click the extension icon and choose **Enable here** in the top-right
toolbar — after that it stays on for that host. That also keeps it out of the
way on sites with their own sizing controls (YouTube, Netflix, Twitch, …) and
on feeds and video calls, without needing a special case for any of them.

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

Sizes are remembered per site and re-applied on the next visit. Use the
attached **More below** control to open the control deck with scale
presets, target choices, and toggles for aspect lock, overflow, and size memory.

## Choosing the target yourself

Detection wins most of the time and loses noisily when it doesn't: it grabs the
wrapper instead of the player, picks the wrong video of three, or scores the real
one too low to find at all. The toolbar's **Target** row is the way out of each.

**Select element** enters the picker: the toolbar steps aside, every box you
hover is highlighted and named, and clicking one makes it the thing that gets
resized — including wrappers the automatic climb would never reach. The toolbar
returns after the choice. Any page with more than one detected player lists them
in the Target row, so switching is a click rather than a hover in the right place.

| Input | Effect |
| --- | --- |
| Move the pointer | Highlight the element under it |
| <kbd>[</kbd> / <kbd>]</kbd> | Widen to the parent, narrow back down |
| Click or <kbd>Enter</kbd> | Resize this element from now on |
| <kbd>Esc</kbd> or right-click | Cancel |

A manual choice is remembered per site and pins the overlay: hovering another
video no longer steals it. **Use automatic** puts that element back to its
original size and hands the decision back to detection.
