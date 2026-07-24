import { useState, useEffect, useCallback } from 'react';
import { SIZE_PRESETS } from '../../utils/constants';
import './App.css';

interface PlayerState {
  playerDetected: boolean;
  currentWidth: number;
  currentHeight: number;
  naturalWidth: number;
  naturalHeight: number;
  enabled: boolean;
  lockAspectRatio: boolean;
}

function App() {
  const [state, setState] = useState<PlayerState | null>(null);

  const queryState = useCallback(() => {
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      const tabId = tabs[0]?.id;
      if (!tabId) return;
      browser.tabs.sendMessage(tabId, { type: 'getState' }).then((resp: any) => {
        if (resp?.type === 'state') {
          setState(resp);
        }
      }).catch(() => {
        // Content script not loaded on this page
        setState(null);
      });
    });
  }, []);

  useEffect(() => {
    queryState();
  }, [queryState]);

  const sendMessage = useCallback(
    (msg: any) => {
      browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        const tabId = tabs[0]?.id;
        if (!tabId) return;
        browser.tabs.sendMessage(tabId, msg).then((resp: any) => {
          if (resp?.type === 'state' || resp?.type === 'toggled' || resp?.type === 'aspectRatioToggled') {
            queryState();
          }
          if (resp?.type === 'presetApplied' || resp?.type === 'sizeReset') {
            queryState();
          }
        }).catch(() => {});
      });
    },
    [queryState],
  );

  const handleToggleEnabled = () => sendMessage({ type: 'toggleEnabled' });
  const handleToggleAspectRatio = () => sendMessage({ type: 'toggleAspectRatio' });
  const handlePreset = (scale: number) => sendMessage({ type: 'applyPreset', scale });
  const handleReset = () => sendMessage({ type: 'resetSize' });

  const detected = state?.playerDetected ?? false;
  const enabled = state?.enabled ?? true;
  const lockRatio = state?.lockAspectRatio ?? false;

  return (
    <div className="popup">
      {/* Header */}
      <div className="header">
        <h1>Video Resizer</h1>
        <span className={detected ? 'detected' : 'not-detected'} style={{ fontSize: 12 }}>
          {detected ? 'Player detected' : 'No player found'}
        </span>
      </div>

      <hr className="divider" />

      {/* Enable toggle */}
      <div className="toggle-row">
        <span className="toggle-label">Enabled on this site</span>
        <button
          className={`toggle ${enabled ? 'active' : ''}`}
          onClick={handleToggleEnabled}
          aria-label="Toggle extension on this site"
        />
      </div>

      {/* Aspect ratio lock */}
      <div className="toggle-row">
        <span className="toggle-label">Lock aspect ratio</span>
        <button
          className={`toggle ${lockRatio ? 'active' : ''}`}
          onClick={handleToggleAspectRatio}
          aria-label="Toggle aspect ratio lock"
        />
      </div>

      {/* Size presets */}
      {detected && enabled && (
        <>
          <hr className="divider" />
          <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Quick sizes:</div>
          <div className="presets">
            {SIZE_PRESETS.map((preset) => (
              <button
                key={preset.scale}
                className="preset-btn"
                onClick={() => handlePreset(preset.scale)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <button className="reset-link" onClick={handleReset}>
            Reset to original size
          </button>
        </>
      )}

      {/* Status info */}
      <hr className="divider" />
      <div className="status">
        {detected && state ? (
          <>
            <span className="detected">Player active</span>
            <div className="status-row">
              <span>
                {state.currentWidth} x {state.currentHeight} px
              </span>
              <span>
                Natural: {state.naturalWidth} x {state.naturalHeight}
              </span>
            </div>
          </>
        ) : (
          <span className="not-detected">
            Open a page with a video player to resize it.
          </span>
        )}
      </div>
    </div>
  );
}

export default App;