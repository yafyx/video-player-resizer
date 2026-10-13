[English](README.md) | [中文](README.zh.md)

# Video Player Resizer

Resize any web video player by dragging its edges. The rest of the page stays untouched.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/figures/video-resizer-figure-dark.png">
  <img src="assets/figures/video-resizer-figure-light.png" alt="Isometric illustration: a studio display showing a web page with three videos. The attached video carries the overlay: a corner handle at each corner and a badge reading 1920 × 1080, while the other detected players wait smaller in the page's margin." width="760">
</picture>

## Why this?

The usual workarounds miss the video. Browser zoom scales the text, the chat, and the sidebar, but not the player. Fullscreen hides the page you were reading alongside it. DevTools works for eleven seconds: you set `width` on the `<video>`, the page shrugs, and on reload the change is gone.

The box you see is usually not the `<video>` itself. It's a wrapper: an absolutely-positioned iframe inside a padding-hacked container, a utility class pinning `width: 100%`, a `max-width` clamp, an `aspect-ratio` box. Set `height` on the iframe and nothing moves. The control sits one or two ancestors up, and nothing on the page tells you which one.

This extension resolves the sizing chain (the outermost ancestor that still tightly wraps the player, plus everything between it and the media element) and writes the size where it takes effect.

## What it is

A Manifest V3 browser extension (WXT, MIT licensed) that puts Figma-style drag handles on any web video and resizes the player itself. One permission: `storage`. No host permissions, no popup window, no account, no analytics. Off on every site until you enable it there.

- Drag any edge or corner to resize the player in place
- Works on `<video>` and embedded player `<iframe>`s, including cross-origin ones
- Manual pick when detection guesses wrong, remembered per site
- Remembers sizes per site and restores the page exactly on reset

## Features

- **Resizes the box that controls the rendered size.** Most tools set `width` on the `<video>` and lose to the wrapper. This climbs to the ancestor that owns the rendered box and sizes the whole chain, so even a padding-ratio embed that ignores `height` on the iframe will move.
- **Works with iframe players.** An `<iframe>` can hold child nodes without rendering them, so DOM injected into the player is invisible. The overlay is a shadow-DOM frame on `<html>` that tracks the player's rect, and a full-viewport shield goes up mid-drag so a cross-origin frame can't swallow pointer events.
- **Manual pick when detection is wrong.** Hover and click; `[` / `]` widen to the parent or narrow back down. Your choice becomes an element path (`:nth-child()` segments, id-anchored, split at shadow boundaries), retried on a 250 to 4000ms ladder for late renders, restored per site. If the path stops resolving, the extension falls back to automatic detection.
- **Sizes stick.** Every write uses `!important` and neutralizes the four common overrides: `width: 100%` utilities, `max-width` clamps, `aspect-ratio` / `padding-bottom` ratio boxes, and clipping ancestors. Each displaced inline value is recorded, so reset returns the page exactly.
- **Matches the site's accent color.** The frame borrows the page accent (`theme-color` → brand custom properties → link color), normalized in OKLCH so hue survives while lightness stays legible over letterbox black and sky white. Muted brands get a chroma floor so they don't read as grey.

## With / without

|                         | Without                                    | With                                             |
| ----------------------- | ------------------------------------------ | ------------------------------------------------ |
| Too-small lecture video | Zoom the whole page or go fullscreen       | Drag the corner; the article stays put           |
| Embedded player         | DevTools edit on the iframe, nothing moves | Sizing chain finds the wrapper that owns the box |
| Wrong video of three    | Re-hover and hope                          | Target list + manual pick, pinned per site       |
| Next visit              | Resize again from scratch                  | Per-site size re-applied automatically           |
| Page after reset        | Leftover inline styles                     | Displaced values restored exactly                |
| Privacy cost            | Accounts, sync servers, analytics          | `storage` only; everything stays in the browser  |

## How it works

### Find the box that controls the size

The visible player is usually a wrapper: a padding-hacked container, a `width: 100%` utility, a ratio box. The extension scores candidates by area, on-screen share, and playing state (embeds outrank ads), then climbs to the ancestor that owns the rendered box and sizes the whole chain. Late layout shifts settle before the natural size is remembered; hovering another video retargets unless you've pinned a manual pick.

### Write where the page can't ignore it

Real pages fight back four ways: pinned widths, `max-width` clamps, ratio boxes, and clipping ancestors. Every write is applied with `!important` and those overrides neutralized, and each displaced value is recorded so reset restores the page exactly. Drags, `Shift` / `Alt` modifiers, `Esc` cancel, double-click reset, and arrow-key nudges all funnel through that same write-and-record path.

### Stay out of the page's way

The overlay floats outside the player, so cross-origin iframes work and page scripts can't trip over it. Detection is a heuristic, so a click-to-pick fallback is built in: your choice is remembered per site, retried against late renders, and dropped back to automatic when the page stops matching. Off everywhere until you opt a site in; settings sync, measured sizes stay local.

### Design decisions

| Choice                                    | Why                                                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Overlay outside the player                | Injected DOM never renders inside an iframe; tracking the player's rect from outside works everywhere             |
| Priority writes + displaced-value journal | Plain inline styles lose to utility classes; the journal makes reset exact                                        |
| Off by default, per-site opt-in           | Video sites, calls, and feeds each have their own layout; no blocklist covers them all, a default-off switch does |
| No popup window                           | The controls live in the page; the toolbar icon only toggles them                                                 |
| No host permissions, no analytics         | Detection runs locally; the only permission is `storage`                                                          |

## Quick start

**Use it (4 steps):**

1. Install the unpacked build (`bun run dev`) or the store ZIP, open any page with video.
2. Click the toolbar icon → **Enable here**. The overlay appears on hover from now on for this host.
3. Drag a handle. `Shift` inverts aspect lock, `Alt` disables snapping, double-click resets.
4. Wrong box? Open **More** → **Select element**, click the right box. **Use automatic** hands it back.

**Develop:**

```bash
bun install
bun run dev        # unpacked build in a fresh profile
bun run test       # 8 suites: detector, sizing, overlay, picker, toolbar, theme, storage, paths
bun run compile    # tsc --noEmit
bun run build
bun run verify:release  # tests + compile + build + store-package checks
```

Manual cases live under `examples/`: serve over local HTTP, enable the host, drag. `bun run package:chrome` writes the uploadable ZIP under `.output/`.

That said, it won't fix sites that re-assert layout every frame, and a same-origin subframe pick can't be addressed on revisit (it still works for the session). Detection is a heuristic; the picker covers the cases it misses.

## License

MIT, see [LICENSE](LICENSE). Privacy details: [PRIVACY.md](PRIVACY.md).
