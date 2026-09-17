import type { PlayerKind } from './videoDetector';
import type { ExtensionSettings } from './storage';

/** Extension controls -> content script. */
export type ContentRequest =
  | { type: 'getState' }
  /** Show or hide the top-right in-page controls below the browser action. */
  | { type: 'toggleToolbar' }
  | { type: 'setEnabled'; value: boolean }
  | { type: 'setSetting'; key: keyof ExtensionSettings; value: boolean }
  | { type: 'applyPreset'; scale: number }
  | { type: 'setSize'; width: number; height: number }
  | { type: 'resetSize' }
  | { type: 'cyclePlayer' }
  /** Enter the click-to-choose element picker. */
  | { type: 'startPicking' }
  | { type: 'cancelPicking' }
  /** Target one of the detected players by hand, from the control sheet's list. */
  | { type: 'selectPlayer'; id: string }
  /** Drop the manual target and go back to automatic detection. */
  | { type: 'clearPick' };

/** One detected player, as the extension controls show it. */
export interface PlayerSummary {
  /** Stable for as long as the element lives, so the controls can name it back. */
  id: string;
  /** `video`, `div.player-wrap`, `iframe · youtube.com`. */
  label: string;
  kind: PlayerKind;
  width: number;
  height: number;
  /** True for the player the overlay is currently on. */
  active: boolean;
}

/** Content script -> extension controls. Every request resolves to this shape. */
export interface PlayerState {
  type: 'state';
  playerDetected: boolean;
  playerCount: number;
  playerKind: PlayerKind | null;
  isResized: boolean;
  currentWidth: number;
  currentHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  settings: ExtensionSettings;
  /** Whether the overlay is running on this site. */
  activeHere: boolean;
  hostname: string;
  /** Every player on the page, best first. */
  players: PlayerSummary[];
  /** The element picker is open and waiting for a click. */
  picking: boolean;
  /** Label of the manual target, or null while detection is automatic. */
  pickLabel: string | null;
}
