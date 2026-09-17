import Cancel01Icon from '@hugeicons/core-free-icons/Cancel01Icon';
import ChevronDownIcon from '@hugeicons/core-free-icons/ChevronDownIcon';
import { SIZE_PRESETS, TOOLBAR_HOST_ID } from './constants';
import type { ContentRequest, PlayerState } from './messages';
import type { ExtensionSettings } from './storage';
import { TOOLBAR_CSS } from './toolbarStyles';

export interface ControlToolbar {
  toggle: (state: PlayerState) => void;
  show: (state: PlayerState) => void;
  hide: (options?: { restoreFocus?: boolean }) => void;
  update: (state: PlayerState) => void;
  isOpen: () => boolean;
  destroy: () => void;
}

interface ToolbarOptions {
  iconUrl: string;
  dispatch: (message: ContentRequest) => Promise<PlayerState>;
}

interface SettingControl {
  key: keyof ExtensionSettings;
  button: HTMLButtonElement;
  label: string;
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
type IconSvgObject = readonly (readonly [
  string,
  Readonly<Record<string, string | number>>,
])[];

function makeHugeIcon(icon: IconSvgObject, className: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.classList.add(className);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  for (const [tagName, attributes] of icon) {
    const child = document.createElementNS(SVG_NAMESPACE, tagName);
    for (const [name, value] of Object.entries(attributes)) {
      if (name === 'key') continue;
      const attributeName = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      child.setAttribute(attributeName, String(value));
    }
    svg.appendChild(child);
  }

  return svg;
}

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function addResponsiveLabel(
  button: HTMLButtonElement,
  wideText: string,
  compactText: string,
): { wide: HTMLSpanElement; compact: HTMLSpanElement } {
  const wide = make('span', 'wide-label', wideText);
  const compact = make('span', 'compact-label', compactText);
  button.append(wide, compact);
  return { wide, compact };
}

function appendShortcut(
  container: HTMLElement,
  key: string,
  description: string,
  separator = ' · ',
): void {
  if (container.childNodes.length > 0) container.append(separator);
  const keyboard = make('kbd', undefined, key);
  container.append(keyboard, ` ${description}`);
}

/**
 * Mount the page-owned control surface. The host covers the viewport but never
 * catches page input; only the visible bar and panel opt back into pointer events.
 */
export function createControlToolbar(options: ToolbarOptions): ControlToolbar {
  const host = make('div');
  host.id = TOOLBAR_HOST_ID;
  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('inset', '0', 'important');
  host.style.setProperty('display', 'block', 'important');
  host.style.setProperty('pointer-events', 'none', 'important');
  // Same top layer as the resize overlay. This host is appended later, while
  // the modal picker is appended after both when it needs to take precedence.
  host.style.setProperty('z-index', '2147483647', 'important');

  const shadow = host.attachShadow({ mode: 'open' });
  const style = make('style');
  style.textContent = TOOLBAR_CSS;
  shadow.appendChild(style);

  const shell = make('section', 'shell');
  shell.hidden = true;
  shell.setAttribute('role', 'region');
  shell.setAttribute('aria-label', 'Video Resizer controls');

  const bar = make('div', 'bar');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Quick controls');

  const brand = make('div', 'segment brand');

  const icon = make('img', 'brand-icon');
  icon.src = options.iconUrl;
  icon.alt = '';
  icon.draggable = false;

  const brandCopy = make('span', 'brand-copy');
  const brandTitle = make('span', 'brand-title');
  const brandTitleWide = make('span', 'brand-title-wide', 'Video Resizer');
  const brandShort = make('span', 'brand-short', 'Resizer');
  brandTitle.append(brandTitleWide, brandShort);
  const brandMeta = make('span', 'brand-meta');
  brandCopy.append(brandTitle, brandMeta);
  brand.append(icon, brandCopy);

  const site = make('button', 'segment site');
  site.type = 'button';
  const siteLabels = addResponsiveLabel(site, 'Enable here', 'Off');

  const sizeSegment = make('button', 'segment size-segment');
  sizeSegment.type = 'button';
  sizeSegment.title = 'Open resize controls';
  sizeSegment.setAttribute('aria-controls', 'video-resizer-control-panel');
  sizeSegment.setAttribute('aria-expanded', 'false');
  sizeSegment.textContent = 'No player';

  const pick = make('button', 'segment pick');
  pick.type = 'button';
  const pickLabels = addResponsiveLabel(pick, 'Select element', 'Target');

  const close = make('button', 'segment close');
  close.type = 'button';
  close.title = 'Close Video Resizer controls';
  close.setAttribute('aria-label', 'Close Video Resizer controls');
  close.append(makeHugeIcon(Cancel01Icon, 'close-icon'));

  bar.append(brand, site, sizeSegment, pick, close);

  // A small attached button keeps the hidden deck discoverable without adding a
  // backdrop over the page. The brand is informational; this cue is the
  // explicit disclosure control and remains useful after the panel opens.
  const deckCue = make('button', 'deck-cue');
  deckCue.type = 'button';
  deckCue.setAttribute('aria-controls', 'video-resizer-control-panel');
  deckCue.setAttribute('aria-expanded', 'false');
  deckCue.setAttribute('aria-label', 'Open resize controls. More controls below.');
  const deckCueLabel = make('span', 'deck-cue-label', 'More below');
  const deckCueIcon = makeHugeIcon(ChevronDownIcon, 'deck-cue-icon');
  deckCue.append(deckCueLabel, deckCueIcon);

  const panel = make('div', 'panel');
  panel.id = 'video-resizer-control-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Resize controls');

  const sizeRow = make('section', 'panel-row');
  const sizeTitle = make('h2', 'row-title', 'Size');
  const sizeControls = make('div', 'row-controls');
  sizeControls.setAttribute('role', 'group');
  sizeControls.setAttribute('aria-label', 'Size presets');

  const presetButtons = SIZE_PRESETS.map((preset) => {
    const button = make('button', 'choice', preset.label);
    button.type = 'button';
    button.dataset.scale = String(preset.scale);
    button.setAttribute('aria-label', `Resize to ${preset.label}`);
    sizeControls.appendChild(button);
    return { preset, button };
  });

  const restore = make('button', 'text-action restore', 'Restore');
  restore.type = 'button';
  restore.disabled = true;
  sizeControls.appendChild(restore);
  sizeRow.append(sizeTitle, sizeControls);

  const targetRow = make('section', 'panel-row');
  targetRow.classList.add('target-row');
  const targetTitle = make('h2', 'row-title', 'Target');
  const targetControls = make('div', 'row-controls');
  const targetSummary = make('span', 'target-summary', 'Automatic detection');
  const automatic = make('button', 'text-action', 'Use automatic');
  automatic.type = 'button';
  automatic.hidden = true;
  const players = make('div', 'players');
  players.setAttribute('role', 'group');
  players.setAttribute('aria-label', 'Detected players');
  targetControls.append(targetSummary, automatic, players);
  targetRow.append(targetTitle, targetControls);

  const behaviorRow = make('section', 'panel-row');
  const behaviorTitle = make('h2', 'row-title', 'Behavior');
  const behaviorControls = make('div', 'row-controls');
  behaviorControls.setAttribute('role', 'group');
  behaviorControls.setAttribute('aria-label', 'Resize behavior');

  const settingControls: SettingControl[] = [
    { key: 'lockAspectRatio', button: make('button', 'choice setting'), label: 'Lock ratio' },
    { key: 'allowOverflow', button: make('button', 'choice setting'), label: 'Allow overflow' },
    { key: 'rememberSize', button: make('button', 'choice setting'), label: 'Remember size' },
  ];

  for (const control of settingControls) {
    control.button.type = 'button';
    control.button.textContent = control.label;
    behaviorControls.appendChild(control.button);
  }
  behaviorRow.append(behaviorTitle, behaviorControls);

  const shortcuts = make('p', 'shortcuts');
  appendShortcut(shortcuts, 'Shift', 'flip ratio lock');
  appendShortcut(shortcuts, 'Alt', 'skip snapping');
  appendShortcut(shortcuts, 'Esc', 'cancel');
  appendShortcut(shortcuts, 'Arrows', 'resize 1 px');

  const liveRegion = make('p', 'sr-only');
  liveRegion.setAttribute('role', 'status');
  liveRegion.setAttribute('aria-live', 'polite');

  panel.append(sizeRow, targetRow, behaviorRow, shortcuts);
  shell.dataset.expanded = 'false';
  shell.append(bar, deckCue, panel, liveRegion);
  shadow.appendChild(shell);
  document.documentElement.appendChild(host);

  let currentState: PlayerState | null = null;
  let expanded = false;
  let busy = false;
  let destroyed = false;
  let previousFocus: HTMLElement | null = null;
  let panelTrigger: HTMLButtonElement = deckCue;

  const live = (state: PlayerState): boolean => state.activeHere && state.settings.enabled;

  function setExpanded(next: boolean): void {
    expanded = next;
    panel.hidden = !next;
    shell.dataset.expanded = String(next);
    deckCueLabel.textContent = next ? 'Hide controls' : 'More below';
    deckCue.setAttribute(
      'aria-label',
      next ? 'Close resize controls.' : 'Open resize controls. More controls below.',
    );
    deckCue.setAttribute('aria-expanded', String(next));
    sizeSegment.setAttribute('aria-expanded', String(next));
  }

  function setBusy(next: boolean): void {
    busy = next;
    shell.setAttribute('aria-busy', String(next));
  }

  async function perform(messages: ContentRequest[], announcement: string): Promise<void> {
    if (busy || messages.length === 0) return;
    setBusy(true);
    try {
      let next = currentState;
      for (const message of messages) next = await options.dispatch(message);
      if (next) render(next);
      liveRegion.textContent = announcement;
    } catch {
      liveRegion.textContent = 'Unable to update Video Resizer controls.';
    } finally {
      setBusy(false);
    }
  }

  function renderPlayers(state: PlayerState, isLive: boolean): void {
    players.replaceChildren();
    players.hidden = state.players.length <= 1;

    for (const player of state.players) {
      const button = make('button', 'player', player.label);
      button.type = 'button';
      button.title = `${player.label} · ${player.width}×${player.height}`;
      button.dataset.current = String(player.active);
      button.setAttribute('aria-pressed', String(player.active));
      button.disabled = !isLive;
      button.addEventListener('click', () => {
        void perform([{ type: 'selectPlayer', id: player.id }], `Selected ${player.label}.`);
      });
      players.appendChild(button);
    }
  }

  function render(state: PlayerState): void {
    currentState = state;
    const isLive = live(state);
    const currentScale = state.naturalWidth > 0 ? state.currentWidth / state.naturalWidth : 1;
    const activePlayer = state.players.find((player) => player.active);

    brandMeta.textContent = state.hostname || 'This page';

    site.dataset.on = String(isLive);
    site.setAttribute('aria-pressed', String(isLive));
    siteLabels.wide.textContent = isLive ? 'On this site' : 'Enable here';
    siteLabels.compact.textContent = isLive ? 'On' : 'Off';

    sizeSegment.textContent =
      isLive && state.playerDetected ? `${state.currentWidth} × ${state.currentHeight}` : 'No player';
    sizeSegment.setAttribute(
      'aria-label',
      state.playerDetected
        ? `Current size ${state.currentWidth} by ${state.currentHeight}. Open resize controls.`
        : 'No player detected. Open resize controls.',
    );

    pickLabels.wide.textContent = state.picking ? 'Cancel selection' : 'Select element';
    pickLabels.compact.textContent = state.picking ? 'Cancel' : 'Target';

    for (const { preset, button } of presetButtons) {
      const selected = Math.abs(currentScale - preset.scale) < 0.02;
      button.dataset.current = String(selected);
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = !isLive || !state.playerDetected;
    }

    restore.disabled = !isLive || !state.isResized;

    targetSummary.textContent =
      state.pickLabel ?? activePlayer?.label ?? (state.playerDetected ? 'Automatic player' : 'No target');
    targetSummary.title = targetSummary.textContent;
    automatic.hidden = !state.pickLabel;
    automatic.disabled = !isLive;
    renderPlayers(state, isLive);
    targetSummary.hidden = state.players.length > 1 && !state.pickLabel;

    for (const control of settingControls) {
      const on = state.settings[control.key];
      control.button.dataset.on = String(on);
      control.button.setAttribute('aria-pressed', String(on));
    }
  }

  deckCue.addEventListener('click', () => {
    panelTrigger = deckCue;
    setExpanded(!expanded);
  });
  sizeSegment.addEventListener('click', () => {
    panelTrigger = sizeSegment;
    setExpanded(!expanded);
  });

  site.addEventListener('click', () => {
    if (!currentState) return;
    const messages: ContentRequest[] = [];
    const next = !live(currentState);
    if (next && !currentState.settings.enabled) {
      messages.push({ type: 'setSetting', key: 'enabled', value: true });
    }
    messages.push({ type: 'setEnabled', value: next });
    void perform(messages, next ? 'Resize enabled on this site.' : 'Resize disabled on this site.');
  });

  pick.addEventListener('click', () => {
    if (!currentState) return;
    if (currentState.picking) {
      void perform([{ type: 'cancelPicking' }], 'Element selection cancelled.');
      return;
    }

    const messages: ContentRequest[] = [];
    if (!currentState.settings.enabled) {
      messages.push({ type: 'setSetting', key: 'enabled', value: true });
    }
    if (!currentState.activeHere) messages.push({ type: 'setEnabled', value: true });
    messages.push({ type: 'startPicking' });
    void perform(messages, 'Element selection started.');
  });

  close.addEventListener('click', () => hide());

  for (const { preset, button } of presetButtons) {
    button.addEventListener('click', () => {
      void perform([{ type: 'applyPreset', scale: preset.scale }], `Resized to ${preset.label}.`);
    });
  }

  restore.addEventListener('click', () => {
    void perform([{ type: 'resetSize' }], 'Original size restored.');
  });

  automatic.addEventListener('click', () => {
    void perform([{ type: 'clearPick' }], 'Automatic target detection restored.');
  });

  for (const control of settingControls) {
    control.button.addEventListener('click', () => {
      if (!currentState) return;
      const next = !currentState.settings[control.key];
      void perform(
        [{ type: 'setSetting', key: control.key, value: next }],
        `${control.label} ${next ? 'on' : 'off'}.`,
      );
    });
  }

  shell.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (expanded) {
      setExpanded(false);
      panelTrigger.focus({ preventScroll: true });
    } else hide();
  });

  function show(state: PlayerState): void {
    if (destroyed) return;
    currentState = state;
    render(state);
    if (shell.hidden) {
      if (!previousFocus?.isConnected) {
        previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      shell.hidden = false;
      deckCue.focus({ preventScroll: true });
    }
  }

  function hide({ restoreFocus = true }: { restoreFocus?: boolean } = {}): void {
    if (destroyed || shell.hidden) return;
    setExpanded(false);
    shell.hidden = true;
    if (restoreFocus) {
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      previousFocus = null;
    }
  }

  return {
    toggle(state) {
      if (shell.hidden) show(state);
      else hide();
    },
    show,
    hide,
    update(state) {
      if (destroyed) return;
      render(state);
    },
    isOpen() {
      return !destroyed && !shell.hidden;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      host.remove();
      previousFocus = null;
    },
  };
}
