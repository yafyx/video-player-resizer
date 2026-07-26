import type { ExtensionSettings } from './storage';

/** Popup -> content script. */
export type ContentRequest =
  | { type: 'getState' }
  | { type: 'setEnabled'; value: boolean }
  | { type: 'setSetting'; key: keyof ExtensionSettings; value: boolean }
  | { type: 'applyPreset'; scale: number }
  | { type: 'setSize'; width: number; height: number }
  | { type: 'resetSize' }
  | { type: 'cyclePlayer' };

/** Content script -> popup. Every request resolves to this shape. */
export interface PlayerState {
  type: 'state';
  playerDetected: boolean;
  playerCount: number;
  playerKind: 'video' | 'iframe' | null;
  isResized: boolean;
  currentWidth: number;
  currentHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  settings: ExtensionSettings;
  /** Whether the overlay is running on this site. */
  activeHere: boolean;
  hostname: string;
}
