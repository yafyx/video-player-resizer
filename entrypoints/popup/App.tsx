import { useCallback, useEffect, useState } from 'react';
import { SIZE_PRESETS, DEFAULT_SETTINGS } from '../../utils/constants';
import type { ContentRequest, PlayerState } from '../../utils/messages';
import type { ExtensionSettings } from '../../utils/storage';
import './App.css';

/** `unreachable` covers restricted pages and tabs older than the current build. */
type Connection =
  | { status: 'loading' }
  | { status: 'ready'; state: PlayerState }
  | { status: 'unreachable'; hostname: string };

async function activeTab(): Promise<{ id: number; hostname: string } | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;

  let hostname = '';
  try {
    hostname = tab.url ? new URL(tab.url).hostname : '';
  } catch {
    hostname = '';
  }
  return { id: tab.id, hostname };
}

function Toggle({
  on,
  label,
  onChange,
}: {
  on: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="toggle"
      data-on={on}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    />
  );
}

function SettingRow({
  title,
  description,
  on,
  onChange,
}: {
  title: string;
  description: string;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="row">
      <span className="row-label">
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      <Toggle on={on} label={title} onChange={onChange} />
    </div>
  );
}

function siteRowDescription(state: PlayerState, live: boolean): string {
  if (!live) return 'Turn on to add drag handles to the player';
  if (state.playerCount > 1) {
    return `${state.playerCount} players detected — hover one to target it`;
  }
  return 'Adds drag handles to the player';
}

function App() {
  const [connection, setConnection] = useState<Connection>({ status: 'loading' });

  const send = useCallback(async (message: ContentRequest) => {
    const tab = await activeTab();
    if (!tab) return;

    try {
      const response = (await browser.tabs.sendMessage(tab.id, message)) as PlayerState | undefined;
      if (response?.type === 'state') {
        setConnection({ status: 'ready', state: response });
        return;
      }
      setConnection({ status: 'unreachable', hostname: tab.hostname });
    } catch {
      // No content script in this tab: a restricted page, or the tab predates
      // the extension being installed or reloaded.
      setConnection({ status: 'unreachable', hostname: tab.hostname });
    }
  }, []);

  useEffect(() => {
    void send({ type: 'getState' });
  }, [send]);

  if (connection.status === 'loading') {
    return <div className="popup" />;
  }

  if (connection.status === 'unreachable') {
    return (
      <div className="popup">
        <div className="section header">
          <span>
            <span className="title">Video Resizer</span>
            <span className="host">{connection.hostname || 'this page'}</span>
          </span>
        </div>
        <div className="section empty">
          <strong>Not running here</strong>
          Reload the page to activate it. Browser settings pages and the extension gallery are
          always off limits.
        </div>
      </div>
    );
  }

  const state = connection.state;
  const settings: ExtensionSettings = state.settings ?? { ...DEFAULT_SETTINGS };
  const live = state.activeHere && settings.enabled;
  const detected = state.playerDetected;
  const currentScale =
    state.naturalWidth > 0 ? state.currentWidth / state.naturalWidth : 1;

  const setSetting = (key: keyof ExtensionSettings, value: boolean) =>
    void send({ type: 'setSetting', key, value });

  return (
    <div className="popup">
      <div className="section header">
        <span>
          <span className="title">Video Resizer</span>
          <span className="host">{state.hostname}</span>
        </span>
        <span className="status" data-on={live && detected}>
          <span className="dot" />
          {!live ? 'Off' : detected ? 'Player found' : 'No player'}
        </span>
      </div>

      <div className="section card">
        <SettingRow
          title="Resize on this site"
          description={siteRowDescription(state, live)}
          on={live}
          onChange={(value) => void send({ type: 'setEnabled', value })}
        />
      </div>

      {live && detected && (
        <>
          <div className="section readout">
            <span className="size">
              {state.currentWidth}
              <span className="times">×</span>
              {state.currentHeight}
            </span>
            <span className="natural">
              was {state.naturalWidth} × {state.naturalHeight}
            </span>
          </div>

          <div className="section presets" role="group" aria-label="Size presets">
            {SIZE_PRESETS.map((preset) => (
              <button
                key={preset.scale}
                type="button"
                className="preset"
                data-current={Math.abs(currentScale - preset.scale) < 0.02}
                onClick={() => void send({ type: 'applyPreset', scale: preset.scale })}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="section reset"
            disabled={!state.isResized}
            onClick={() => void send({ type: 'resetSize' })}
          >
            Reset to original size
          </button>
        </>
      )}

      {live && !detected && (
        <div className="section empty">
          <strong>No video on this page</strong>
          Start a video, or scroll it into view, and reopen this popup.
        </div>
      )}

      <div className="section card">
        <SettingRow
          title="Lock aspect ratio"
          description="Hold Shift while dragging to invert this"
          on={settings.lockAspectRatio}
          onChange={(value) => setSetting('lockAspectRatio', value)}
        />
        <SettingRow
          title="Allow overflow"
          description="Let the player grow past a narrow column"
          on={settings.allowOverflow}
          onChange={(value) => setSetting('allowOverflow', value)}
        />
        <SettingRow
          title="Remember size"
          description="Re-apply this size next time you visit"
          on={settings.rememberSize}
          onChange={(value) => setSetting('rememberSize', value)}
        />
      </div>

      <p className="section hint">
        Hover the player to reveal its handles. <kbd>Shift</kbd> inverts the aspect lock,{' '}
        <kbd>Alt</kbd> disables snapping, <kbd>Esc</kbd> cancels a drag. Focus a handle and use the
        arrow keys for pixel-level control.
      </p>
    </div>
  );
}

export default App;
