// Shared by the content script and the popup. Single source of truth for
// default values and slider ranges.

const YAG_MODES = Object.freeze(['immersive', 'glow']);

const YAG_DEFAULTS = Object.freeze({
  enabled: true,
  mode: 'immersive', // 'immersive' = whole page lit by the video, 'glow' = halo around the player
  intensity: 90,     // % opacity of the glow
  blur: 80,          // px, CSS blur radius
  saturation: 180,   // %, CSS saturate()
  brightness: 120,   // %, CSS brightness()
  dim: 25,           // % opacity of the veil between glow and page (Immersive only)
  spread: 60         // px the glow extends past each edge of the player (Glow only)
});

const YAG_LIMITS = Object.freeze({
  intensity: [0, 100],
  blur: [0, 150],
  saturation: [50, 300],
  brightness: [50, 200],
  dim: [0, 90],
  spread: [0, 200]
});

// Returns a complete, clamped settings object from untrusted input.
function yagSanitize(raw) {
  const out = { ...YAG_DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
  if (YAG_MODES.includes(raw.mode)) out.mode = raw.mode;
  for (const key of Object.keys(YAG_LIMITS)) {
    const n = Number(raw[key]);
    if (Number.isFinite(n)) {
      const [min, max] = YAG_LIMITS[key];
      out[key] = Math.min(max, Math.max(min, Math.round(n)));
    }
  }
  return out;
}
