import { ACCENT } from './constants';

/**
 * Styles for the resize overlay's shadow tree.
 *
 * The frame is modelled on Figma's selection: a hairline outline, four small
 * white corner squares, no visible edge handles at all, and a dimension badge
 * centred underneath. Figma leaves its edges as invisible grab strips and lets
 * the cursor do the signalling, which keeps the video itself unobstructed --
 * eight permanent dots on top of a moving picture is a lot of furniture.
 *
 * Colour comes in through custom properties that `theme.ts` fills from the
 * page's own palette. The values here are only the fallback.
 *
 * Motion budget: the reveal is hover-triggered and therefore fires dozens of
 * times a session, so it is one 120ms fade with a 1.5% settle -- no stagger, no
 * bounce. Every transition names its properties.
 */
export const OVERLAY_CSS = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  display: block;
  pointer-events: none;
  z-index: 2147483647;
  contain: layout style;

  --accent: ${ACCENT};
  --accent-soft: rgba(61, 139, 255, 0.26);
  --on-accent: #ffffff;
  --halo: rgba(0, 0, 0, 0.28);

  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --handle: 8px;
  --grab: 9px;

  font: 500 11px/1.2 "Inter", ui-sans-serif, -apple-system, BlinkMacSystemFont,
    "Segoe UI", Roboto, sans-serif;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

.probe { display: none; }

.frame {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  border-radius: 2px;
}

/*
 * Positioning and appearance are deliberately on separate elements: .frame owns
 * translate3d + width/height, .chrome owns the enter transform. Sharing one
 * element would make every rect sync fight the animation.
 */
.chrome {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  opacity: 0;
  transform: scale(0.985);
  transition: opacity 120ms var(--ease-out), transform 120ms var(--ease-out);
}

.frame[data-visible="true"] .chrome {
  opacity: 1;
  transform: scale(1);
}

.frame[data-dragging="true"] .chrome {
  transition-duration: 0ms;
}

/*
 * One hairline in the site's accent, plus a single dark ring just outside it.
 * Figma can rely on a canvas it controls; we are drawing over arbitrary video,
 * and the outer ring is what keeps the line from vanishing into a bright frame.
 */
.outline {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow:
    inset 0 0 0 1px var(--accent),
    0 0 0 1px var(--halo);
}

.handle {
  position: absolute;
  pointer-events: none;
  transform: translate(-50%, -50%);
}

.frame[data-visible="true"] .handle { pointer-events: auto; }

.handle.corner {
  z-index: 2;
  width: var(--handle);
  height: var(--handle);
  border-radius: 2px;
  background: #ffffff;
  box-shadow:
    0 0 0 1px var(--accent),
    0 1px 2px rgba(0, 0, 0, 0.22);
  transition: background-color 110ms var(--ease-out), box-shadow 110ms var(--ease-out);
}

/* Fitts's law: an 8px square is a 24px target. */
.handle.corner::before {
  content: "";
  position: absolute;
  inset: -8px;
}

/*
 * Edges carry no visible affordance, exactly as in Figma -- the resize cursor is
 * the signal. They stop short of the corners so the corner handles always win.
 */
.handle.edge-h {
  width: calc(100% - 18px);
  height: var(--grab);
}

.handle.edge-v {
  width: var(--grab);
  height: calc(100% - 18px);
}

/* Pressing fills the square with the accent: flat, instant, no scaling. */
.handle.corner[data-grabbed="true"] {
  background: var(--accent);
  box-shadow:
    0 0 0 1px var(--accent),
    0 0 0 4px var(--accent-soft);
}

.handle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.handle.edge-h:focus-visible,
.handle.edge-v:focus-visible {
  outline-offset: -2px;
}

/* Figma puts the dimensions in a small tag centred below the selection. */
.readout {
  position: absolute;
  top: calc(100% + 7px);
  left: 50%;
  display: flex;
  align-items: baseline;
  gap: 5px;
  padding: 3px 6px;
  border-radius: 3px;
  background: var(--accent);
  color: var(--on-accent);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.24);
  opacity: 0;
  transform: translateX(-50%) translateY(3px) scale(0.97);
  transition: opacity 110ms var(--ease-out), transform 110ms var(--ease-out);
}

/* Near the bottom of the viewport the tag moves inside the frame instead. */
.frame[data-badge="inside"] .readout {
  top: auto;
  bottom: 7px;
}

.frame[data-readout="true"] .readout {
  opacity: 1;
  transform: translateX(-50%) translateY(0) scale(1);
}

.readout .times { opacity: 0.55; }
.readout .scale { opacity: 0.62; }

/*
 * Covers the viewport for the duration of a drag. Without it the pointer crosses
 * into a cross-origin player iframe, that document swallows the move events, and
 * the drag dies halfway. It also keeps one consistent resize cursor everywhere.
 */
.shield {
  position: fixed;
  inset: 0;
  pointer-events: none;
}

.shield[data-active="true"] { pointer-events: auto; }

@media (prefers-reduced-motion: reduce) {
  .chrome {
    transform: none;
    transition-property: opacity;
  }
  .frame[data-visible="true"] .chrome { transform: none; }
  .handle.corner { transition-property: background-color; }
  .readout {
    transform: translateX(-50%);
    transition-property: opacity;
  }
  .frame[data-readout="true"] .readout { transform: translateX(-50%); }
}
`;
