/**
 * A compact physical control sheet that lives on the page, not in browser
 * chrome. The icon supplies the palette; uneven corners and a weighted lower
 * right edge carry the resize metaphor without turning the UI into a drawing.
 */
export const TOOLBAR_CSS = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  display: block;
  pointer-events: none;
  z-index: 2147483647;
  contain: layout style;

  --sky: #548cc9;
  --sky-hover: #679bd3;
  --paper: #f8f7f3;
  --paper-quiet: #edf0ee;
  --paper-hover: #e7f0f8;
  --ink: #141413;
  --sky-ink: var(--paper);
  --texture-paper-top: #ffffff;
  --texture-paper-bottom: var(--paper-quiet);
  --texture-paper-hover-bottom: var(--paper-hover);
  --texture-rim-top: rgb(255 255 255 / 78%);
  --texture-rim-bottom: rgb(20 20 19 / 20%);
  --texture-dark-top: #2d2d2c;
  --texture-blue-top: #6b9dd2;
  --texture-blue-bottom: #548cc9;
  --texture-blue-hover-top: #7aa8d4;
  --texture-blue-hover-bottom: var(--sky-hover);
  --muted: #4e4a44;
  --faint: #5f5a53;
  --disabled: #77716a;
  --line: rgba(20, 20, 19, 0.18);
  --shadow: rgba(20, 20, 19, 0.16);
  --ease-out: cubic-bezier(0.2, 0, 0, 1);

  color: var(--ink);
  font: 520 13px/1.35 ui-rounded, "SF Pro Rounded", ui-sans-serif, -apple-system,
    BlinkMacSystemFont, "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
[hidden] { display: none !important; }

button {
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

button:disabled {
  color: var(--disabled);
  cursor: not-allowed;
}

button:focus-visible {
  position: relative;
  z-index: 3;
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}

.shell {
  position: fixed;
  /* The action lives in browser chrome, so mirror its physical top-right
     anchor in the page viewport instead of centering the controls. */
  top: max(10px, env(safe-area-inset-top));
  right: max(16px, env(safe-area-inset-right));
  left: auto;
  width: min(520px, calc(100vw - 32px));
  max-height: calc(100vh - 32px);
  pointer-events: none;
  transform: none;
  transform-origin: top right;
}

.bar {
  display: grid;
  width: 100%;
  grid-template-columns: minmax(144px, 180px) auto auto auto auto;
  min-height: 54px;
  padding: 0 2px;
  border: 3px solid var(--sky);
  border-radius: 22px 20px 24px 19px;
  outline: 2px solid var(--ink);
  outline-offset: -2px;
  background: var(--paper);
  box-shadow:
    0 3px 0 rgb(20 20 19 / 16%),
    0 12px 26px var(--shadow);
  pointer-events: auto;
}

.segment {
  min-width: 0;
  min-height: 42px;
  margin-block: 1px;
  padding-inline: 10px;
  border-radius: 12px 11px 13px 10px;
  white-space: nowrap;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-inline-start: 7px;
  text-align: start;
}

.brand-icon {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  border-radius: 11px 9px 12px 10px;
  outline: 1px solid rgb(0 0 0 / 12%);
  outline-offset: -1px;
  box-shadow: 0 2px 0 rgb(20 20 19 / 12%);
}

.brand-copy {
  display: flex;
  min-width: 0;
  max-width: 132px;
  flex-direction: column;
  gap: 1px;
}

.brand-title {
  overflow: hidden;
  font-size: 13.5px;
  font-weight: 720;
  letter-spacing: -0.015em;
  text-overflow: ellipsis;
}

.brand-meta {
  overflow: hidden;
  color: var(--muted);
  font-size: 11px;
  font-weight: 520;
  text-overflow: ellipsis;
}

.site,
.size-segment,
.pick,
.close {
  align-self: center;
  min-height: 36px;
  margin-inline: 2px;
  padding-inline: 10px;
  font-size: 12px;
  font-weight: 680;
}

.site,
.size-segment,
.close {
  border: 1px solid transparent;
  background:
    linear-gradient(180deg, var(--texture-paper-top), var(--texture-paper-bottom)) padding-box,
    linear-gradient(180deg, var(--texture-rim-top), var(--texture-rim-bottom)) border-box;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 70%),
    0 1px 0 rgb(20 20 19 / 8%);
}

.site[data-on="true"] {
  border-color: transparent;
  background:
    linear-gradient(180deg, var(--texture-blue-top), var(--texture-blue-bottom)) padding-box,
    linear-gradient(180deg, rgb(255 255 255 / 42%), rgb(20 20 19 / 28%)) border-box;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 36%),
    0 1px 0 rgb(20 20 19 / 16%);
  color: var(--sky-ink);
}

.size-segment {
  font-variant-numeric: tabular-nums;
}

.size-segment[aria-expanded="true"] {
  background:
    linear-gradient(180deg, var(--texture-paper-top), var(--texture-paper-bottom)) padding-box,
    linear-gradient(180deg, var(--texture-rim-top), var(--texture-rim-bottom)) border-box;
  color: var(--ink);
}

.pick {
  padding-inline: 14px;
  border: 1px solid transparent;
  background:
    linear-gradient(180deg, var(--texture-dark-top), var(--ink)) padding-box,
    linear-gradient(180deg, rgb(0 0 0 / 22%), var(--ink)) border-box;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 12%),
    0 1px 0 rgb(20 20 19 / 20%);
  color: var(--paper);
}

.close {
  display: inline-flex;
  width: 36px;
  align-items: center;
  justify-content: center;
  padding-inline: 0;
  color: var(--muted);
}

.close-icon {
  display: block;
  width: 18px;
  height: 18px;
}

.compact-label,
.brand-short { display: none; }

.deck-cue {
  display: flex;
  position: relative;
  z-index: 1;
  width: max-content;
  min-height: 24px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  margin: -1px auto 0;
  padding: 0 7px 2px;
  border: 1px solid transparent;
  border-top: 0;
  border-radius: 0 0 12px 12px;
  background:
    linear-gradient(180deg, var(--texture-paper-top), var(--texture-paper-bottom)) padding-box,
    linear-gradient(180deg, var(--texture-rim-top), var(--texture-rim-bottom)) border-box;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 70%),
    0 2px 0 var(--sky);
  color: var(--muted);
  cursor: pointer;
  font-size: 9px;
  font-weight: 760;
  letter-spacing: 0.08em;
  line-height: 1;
  pointer-events: auto;
  text-transform: uppercase;
  user-select: none;
}

.deck-cue-label {
  padding: 3px 0 4px;
}

.deck-cue-icon {
  display: block;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  color: var(--ink);
}

.shell[data-expanded='true'] .deck-cue-icon {
  transform: rotate(180deg);
}

.shell[data-expanded='true'] .deck-cue {
  background:
    linear-gradient(180deg, var(--texture-blue-top), var(--texture-blue-bottom)) padding-box,
    linear-gradient(180deg, rgb(255 255 255 / 42%), rgb(20 20 19 / 28%)) border-box;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 36%),
    0 2px 0 var(--sky);
  color: var(--sky-ink);
}

.shell[data-expanded='true'] .deck-cue-icon {
  color: var(--sky-ink);
}

.panel {
  display: flex;
  position: relative;
  width: 100%;
  min-width: 0;
  max-height: calc(100vh - 92px);
  flex-direction: column;
  gap: 3px;
  margin-top: 7px;
  padding: 10px 12px 12px;
  overflow: auto;
  border: 2px solid var(--ink);
  border-inline-end-width: 2px;
  border-bottom-width: 2px;
  border-radius: 22px 20px 24px 18px;
  background: var(--paper);
  box-shadow:
    0 4px 0 var(--sky),
    0 14px 30px var(--shadow);
  pointer-events: auto;
  overscroll-behavior: contain;
}

.panel-row {
  display: flex;
  min-height: 44px;
  min-width: 0;
  align-items: center;
  gap: 12px;
  padding: 5px 2px;
}

.target-row .row-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 6px;
}

.target-row .target-summary {
  width: 100%;
  flex: none;
  color: var(--muted);
  font-size: 11px;
  font-weight: 680;
}

.target-row .players {
  width: 100%;
  flex: none;
}

.row-title {
  width: 66px;
  flex: 0 0 auto;
  color: var(--muted);
  font-size: 11px;
  font-weight: 720;
  letter-spacing: 0.045em;
  text-transform: uppercase;
}

.row-controls {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 8px;
}

.choice,
.text-action,
.player {
  min-height: 34px;
  padding-inline: 11px;
  border-radius: 11px 10px 12px 10px;
  border: 1px solid transparent;
  background:
    linear-gradient(180deg, var(--texture-paper-top), var(--texture-paper-bottom)) padding-box,
    linear-gradient(180deg, var(--texture-rim-top), var(--texture-rim-bottom)) border-box;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 70%),
    0 1px 0 rgb(20 20 19 / 8%);
  color: var(--muted);
  font-size: 12px;
  font-weight: 650;
}

.choice { min-width: 48px; font-variant-numeric: tabular-nums; }

.choice[data-current="true"],
.setting[data-on="true"],
.player[data-current="true"] {
  background:
    linear-gradient(180deg, var(--texture-blue-top), var(--texture-blue-bottom)) padding-box,
    linear-gradient(180deg, rgb(255 255 255 / 42%), rgb(20 20 19 / 28%)) border-box;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 36%),
    0 1px 0 rgb(20 20 19 / 16%);
  color: var(--sky-ink);
}

.setting[data-on="true"] {
  background:
    linear-gradient(180deg, var(--texture-paper-top), var(--texture-paper-bottom)) padding-box,
    linear-gradient(180deg, var(--sky), var(--sky)) border-box;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 70%),
    inset 0 -3px 0 var(--sky),
    0 1px 0 rgb(20 20 19 / 8%);
  color: var(--ink);
}

.restore { margin-inline-start: auto; }

.target-summary {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--ink);
  font-size: 12px;
  font-weight: 620;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.players {
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  gap: 8px;
  overflow-x: auto;
  scrollbar-width: none;
}

.players::-webkit-scrollbar { display: none; }

.player {
  max-width: 150px;
  flex: 0 0 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.setting {
  flex: 1 1 0;
  min-width: 0;
  white-space: nowrap;
}

.shortcuts {
  margin-top: 5px;
  padding: 10px 2px 0;
  border-top: 1px solid var(--line);
  color: var(--faint);
  font-size: 11px;
  line-height: 1.45;
  text-wrap: pretty;
}

.shortcuts kbd {
  display: inline-flex;
  min-height: 20px;
  align-items: center;
  justify-content: center;
  margin-inline: 1px;
  padding: 3px 6px 2px;
  border: 1px solid transparent;
  border-radius: 5px;
  background:
    linear-gradient(180deg, var(--texture-paper-top), var(--texture-paper-bottom)) padding-box,
    linear-gradient(180deg, rgb(255 255 255 / 88%), rgb(20 20 19 / 18%)) border-box;
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 82%),
    0 1px 0 rgb(20 20 19 / 20%);
  color: var(--ink);
  font: 700 10.5px/1 ui-monospace, "SFMono-Regular", Consolas, monospace;
  letter-spacing: 0.01em;
  vertical-align: 0.08em;
  white-space: nowrap;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (hover: hover) and (pointer: fine) {
  .deck-cue:hover,
  .close:hover,
  .choice:not(:disabled):not([data-current="true"]):hover,
  .text-action:not(:disabled):hover,
  .player:not(:disabled):not([data-current="true"]):hover {
    background:
      linear-gradient(180deg, var(--texture-paper-top), var(--texture-paper-hover-bottom)) padding-box,
      linear-gradient(180deg, var(--texture-rim-top), var(--texture-rim-bottom)) border-box;
    color: var(--ink);
  }

  .site:not([data-on="true"]):hover,
  .size-segment:hover,
  .size-segment[aria-expanded="true"]:hover {
    background:
      linear-gradient(180deg, var(--texture-paper-top), var(--texture-paper-hover-bottom)) padding-box,
      linear-gradient(180deg, var(--texture-rim-top), var(--texture-rim-bottom)) border-box;
  }

  .site[data-on="true"]:hover,
  .shell[data-expanded='true'] .deck-cue:hover {
    background:
      linear-gradient(180deg, var(--texture-blue-hover-top), var(--texture-blue-hover-bottom)) padding-box,
      linear-gradient(180deg, rgb(255 255 255 / 42%), rgb(20 20 19 / 28%)) border-box;
    color: var(--sky-ink);
  }

  .pick:hover {
    background:
      linear-gradient(180deg, #3b3b39, #252626) padding-box,
      linear-gradient(180deg, rgb(0 0 0 / 22%), #141413) border-box;
  }

  .deck-cue:hover {
    background:
      linear-gradient(180deg, var(--texture-paper-top), var(--texture-paper-hover-bottom)) padding-box,
      linear-gradient(180deg, var(--texture-rim-top), var(--texture-rim-bottom)) border-box;
  }
}

@media (prefers-reduced-motion: no-preference) {
  .segment:not(.brand),
  .choice,
  .text-action,
  .player {
    transition-duration: 120ms;
    transition-property: background-color, color, transform;
    transition-timing-function: var(--ease-out);
  }

  .deck-cue {
    transition-duration: 120ms;
    transition-property: background-color, color, transform;
    transition-timing-function: var(--ease-out);
  }

  .deck-cue-icon {
    transition-duration: 120ms;
    transition-property: transform;
    transition-timing-function: var(--ease-out);
  }

  .segment:not(.brand):active,
  .deck-cue:active,
  .choice:not(:disabled):active,
  .text-action:not(:disabled):active,
  .player:not(:disabled):active {
    transform: scale(0.96);
  }
}

@media (max-width: 620px) {
  .shell {
    top: max(8px, env(safe-area-inset-top));
    right: max(10px, env(safe-area-inset-right));
    left: auto;
    width: calc(100vw - 20px);
  }

  .bar {
    width: 100%;
    grid-template-columns: minmax(96px, 1fr) auto auto auto auto;
  }
  .segment { padding-inline: 9px; }
  .brand { gap: 7px; padding-inline-start: 6px; }
  .brand-icon { width: 26px; height: 26px; border-radius: 9px 8px 10px 8px; }
  .brand-title-wide,
  .brand-meta,
  .wide-label { display: none; }
  .brand-short,
  .compact-label { display: inline; }

  .panel { padding-inline: 10px; }
  .panel-row { flex-wrap: wrap; gap: 7px; }
  .row-title { width: 56px; }
  .row-controls { flex-wrap: wrap; }
  .setting { flex-basis: 120px; }
  .shortcuts { padding-inline-start: 2px; }
}

@media (max-width: 390px) {
  .bar { grid-template-columns: minmax(88px, 1fr) auto auto auto; }
  .size-segment { display: none; }
  .deck-cue { padding-inline: 6px; }
  .shortcuts { padding-inline-start: 2px; }
}

@media (forced-colors: active) {
  .bar,
  .panel,
  .deck-cue,
  .site,
  .choice,
  .text-action,
  .player { border-color: CanvasText; }

  .choice[data-current="true"],
  .setting[data-on="true"],
  .player[data-current="true"] {
    outline: 2px solid Highlight;
    outline-offset: -3px;
  }
}
`;
