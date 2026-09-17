import { ACCENT } from './constants';

/**
 * Styles for the element picker's shadow tree.
 *
 * Where the resize overlay is deliberately quiet -- a hairline and four small
 * squares over a moving picture -- the picker is the opposite: it is a modal
 * state the user entered on purpose, so it fills the candidate, states what it
 * is, and says how to leave. The tinted fill is what makes a big wrapper
 * distinguishable from the video inside it at a glance.
 *
 * Colour arrives through the same custom properties `theme.ts` fills for the
 * overlay, so both surfaces read as one product on any given site.
 *
 * Motion budget: the box tracks a moving cursor, so its transition is 90ms and
 * covers only transform and size. Anything longer reads as lag rather than as
 * polish.
 */
export const PICKER_CSS = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  display: block;
  /* Auto, not none: swallowing clicks is what stops the page reacting to a pick. */
  pointer-events: auto;
  cursor: crosshair;
  z-index: 2147483647;
  contain: layout style;

  --accent: ${ACCENT};
  --accent-soft: rgba(61, 139, 255, 0.26);
  --on-accent: #ffffff;
  --halo: rgba(0, 0, 0, 0.28);

  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);

  font: 500 11px/1.2 "Inter", ui-sans-serif, -apple-system, BlinkMacSystemFont,
    "Segoe UI", Roboto, sans-serif;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

.probe { display: none; }

.box {
  position: absolute;
  top: 0;
  left: 0;
  border-radius: 2px;
  background: var(--accent-soft);
  box-shadow:
    inset 0 0 0 2px var(--accent),
    0 0 0 1px var(--halo);
  opacity: 0;
}

.box[data-live="true"] { opacity: 1; }

/* The tag hangs above the box, and flips inside near the top of the viewport. */
.tag {
  position: absolute;
  top: -23px;
  left: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
  max-width: 100%;
  padding: 3px 6px;
  border-radius: 3px;
  background: var(--accent);
  color: var(--on-accent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.24);
}

.box[data-tag="inside"] .tag {
  top: 4px;
  left: 4px;
  max-width: calc(100% - 8px);
}

.tag .size { opacity: 0.72; }
.tag .depth { opacity: 0.72; }

/*
 * Fixed to the viewport rather than to the box: the instructions have to stay
 * findable while the highlight jumps around the page.
 */
.hint {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-radius: 999px;
  background: rgba(20, 20, 22, 0.92);
  color: rgba(255, 255, 255, 0.72);
  white-space: nowrap;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
}

.hint strong {
  color: #ffffff;
  font-weight: 600;
}

.hint kbd {
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.14);
  color: #ffffff;
  font-family: inherit;
  font-size: 10.5px;
  font-weight: 500;
}

.hint .sep { opacity: 0.34; }

@media (prefers-reduced-motion: no-preference) {
  .box {
    transition:
      transform 90ms var(--ease-out),
      width 90ms var(--ease-out),
      height 90ms var(--ease-out),
      opacity 90ms var(--ease-out);
  }

  .hint { animation: rise 200ms var(--ease-out) both; }

  @keyframes rise {
    from { opacity: 0; transform: translateX(-50%) translateY(6px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
}
`;
