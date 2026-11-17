// Ambient Glow for YouTube - popup.
//
// Every change is (1) sent straight to the active tab for an instant preview
// and (2) saved to chrome.storage.sync after a short pause. Saving is
// debounced because storage.sync allows only ~120 writes per minute, far
// fewer than a dragged slider produces.

(() => {
  'use strict';

  const SLIDERS = {
    intensity: '%',
    blur: 'px',
    saturation: '%',
    brightness: '%',
    dim: '%',
    spread: 'px'
  };
  const SAVE_DELAY_MS = 250;

  const $ = (id) => document.getElementById(id);
  const enabledEl = $('enabled');
  const controlsEl = $('controls');
  const modeEls = Array.from(document.querySelectorAll('input[name="mode"]'));
  const modeRows = Array.from(document.querySelectorAll('.row[data-mode]'));

  let state = { ...YAG_DEFAULTS };
  let saveTimer = 0;
  let activeTabId = null;

  function render() {
    enabledEl.checked = state.enabled;
    controlsEl.classList.toggle('off', !state.enabled);
    for (const el of modeEls) el.checked = el.value === state.mode;
    // Dim only exists in Immersive, Spread only in Glow.
    for (const row of modeRows) row.hidden = row.dataset.mode !== state.mode;
    for (const [key, unit] of Object.entries(SLIDERS)) {
      $(key).value = state[key];
      $(key + '-value').textContent = state[key] + unit;
    }
  }

  function preview() {
    if (activeTabId === null) return;
    chrome.tabs.sendMessage(activeTabId, { type: 'yag:settings', settings: state }, () => {
      void chrome.runtime.lastError; // active tab is not a YouTube page: fine
    });
  }

  function saveNow() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = 0;
    chrome.storage.sync.set({ ...state });
  }

  function changed() {
    render();
    preview();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
  }

  for (const key of Object.keys(SLIDERS)) {
    const el = $(key);
    [el.min, el.max] = YAG_LIMITS[key];
    el.addEventListener('input', () => {
      state[key] = Number(el.value);
      changed();
    });
  }

  for (const el of modeEls) {
    el.addEventListener('change', () => {
      if (!el.checked) return;
      state.mode = el.value;
      changed();
    });
  }

  enabledEl.addEventListener('change', () => {
    state.enabled = enabledEl.checked;
    changed();
  });

  // Reset restores the sliders; it keeps the on/off switch and the mode.
  $('reset').addEventListener('click', () => {
    state = { ...YAG_DEFAULTS, enabled: state.enabled, mode: state.mode };
    changed();
  });

  // Do not lose the last change if the popup closes inside the save delay.
  window.addEventListener('pagehide', saveNow);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0] && typeof tabs[0].id === 'number') activeTabId = tabs[0].id;
  });

  chrome.storage.sync.get({ ...YAG_DEFAULTS }, (items) => {
    void chrome.runtime.lastError;
    state = yagSanitize(items);
    render();
  });

  render();
})();
