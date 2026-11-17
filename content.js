// Ambient Glow for YouTube - content script.
//
// Draws the current video frame onto a tiny canvas (64x36) and lets CSS
// scale, blur, saturate and brighten it. No pixel data is ever read back.
//
// Two modes share the same canvas and draw loop:
//   immersive - the canvas is fixed behind the whole page, and content.css
//               makes YouTube's own backgrounds transparent (everything
//               scoped to html[data-yag-immersive], which this script sets
//               and removes).
//   glow      - the canvas sits behind the player only (ytd-watch-flexy gets
//               data-yag-host).

(() => {
  'use strict';

  const CANVAS_W = 64;
  const CANVAS_H = 36;
  const MIN_FRAME_MS = 1000 / 30 - 3; // cap drawing at ~30fps
  const FADE_MS = 200;                // time constant of the colour cross-fade
  const BLEED_PER_BLUR = 2.5;         // immersive overscan, in multiples of the blur radius
  const IMMERSIVE_ATTR = 'data-yag-immersive';
  const HAS_VFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  const VIDEO_EVENTS = ['play', 'playing', 'pause', 'ended', 'emptied', 'loadeddata', 'seeked'];

  const root = document.documentElement;

  let settings = { ...YAG_DEFAULTS };
  let settingsLoaded = false;

  const layer = document.createElement('div');
  layer.id = 'yag-layer';
  layer.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  canvas.id = 'yag-canvas';
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const dim = document.createElement('div');
  dim.id = 'yag-dim';
  layer.append(canvas, dim);
  const ctx = canvas.getContext('2d');

  let mounted = null; // 'immersive' | 'glow' | null: where the layer currently is
  let host = null;    // glow mode: ytd-watch-flexy, where the layer is mounted
  let player = null;  // #movie_player
  let video = null;   // the main <video>

  let visible = false;   // the effect may be shown right now
  let hasFrame = false;  // at least one frame has been drawn
  let running = false;
  let loopVideo = null;
  let loopHandle = 0;
  let lastDraw = 0;
  let lastBox = '';
  let syncQueued = false;
  let mutationTimer = 0;

  const resizeObs = new ResizeObserver(queueSync);

  // ---------------------------------------------------------------- targets

  function findTargets() {
    // Only a player that lives inside the visible watch page counts. In the
    // miniplayer #movie_player is moved out of ytd-watch-flexy, so this
    // returns null there.
    const p = document.querySelector(
      'ytd-watch-flexy:not([hidden]) #movie_player, ytd-watch-grid:not([hidden]) #movie_player'
    );
    if (!p) return null;
    const h = p.closest('ytd-watch-flexy, ytd-watch-grid');
    const v = p.querySelector('video.html5-main-video') || p.querySelector('video');
    return h && v ? { host: h, player: p, video: v } : null;
  }

  // Reconciles everything with the current page state. Cheap and idempotent,
  // so every event simply calls it.
  function sync() {
    const t = settingsLoaded && settings.enabled && location.pathname === '/watch'
      ? findTargets()
      : null;
    if (!t) {
      detach();
      return;
    }

    if (t.player !== player) {
      if (player) resizeObs.unobserve(player);
      player = t.player;
      resizeObs.observe(player);
      lastBox = '';
    }
    if (t.video !== video) bindVideo(t.video);

    const blocked =
      !!document.fullscreenElement ||
      t.host.hasAttribute('fullscreen') ||
      player.classList.contains('ytp-player-minimized');

    if (settings.mode === 'immersive') {
      // In fullscreen the page must look untouched: take everything out.
      // The canvas keeps its pixels, so the glow is back instantly afterwards.
      if (blocked) unmount();
      else mountImmersive();
      visible = !blocked;
    } else {
      mountGlow(t.host);
      visible = !blocked && layoutGlow();
    }

    layer.classList.toggle('yag-show', visible && hasFrame);
    updateLoop();
  }

  function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(() => {
      syncQueued = false;
      sync();
    });
  }

  // --------------------------------------------------------------- mounting

  function mountImmersive() {
    if (mounted !== 'immersive') {
      unmount();
      mounted = 'immersive';
      layer.className = 'yag-immersive';
      root.setAttribute(IMMERSIVE_ATTR, '');
    }
    // YouTube never replaces <body>, but be safe against anything removing us.
    if (layer.parentNode !== document.body) document.body.appendChild(layer);
  }

  function mountGlow(nextHost) {
    if (mounted !== 'glow') {
      unmount();
      mounted = 'glow';
      layer.className = 'yag-glow';
    }
    if (nextHost !== host) {
      releaseHost();
      host = nextHost;
      if (getComputedStyle(host).position === 'static') host.setAttribute('data-yag-pos', '');
      host.setAttribute('data-yag-host', '');
      resizeObs.observe(host);
      lastBox = '';
    }
    if (layer.parentNode !== host) host.appendChild(layer);
  }

  function releaseHost() {
    if (!host) return;
    resizeObs.unobserve(host);
    host.removeAttribute('data-yag-host');
    host.removeAttribute('data-yag-pos');
    host = null;
  }

  // Removes the layer and every hook content.css keys on. After this the
  // page is styled by YouTube alone.
  function unmount() {
    if (!mounted) return;
    mounted = null;
    root.removeAttribute(IMMERSIVE_ATTR);
    releaseHost();
    layer.classList.remove('yag-show');
    layer.remove();
    // Glow mode sizes the canvas inline; immersive sizes it from CSS.
    canvas.style.width = '';
    canvas.style.height = '';
    canvas.style.transform = '';
    lastBox = '';
  }

  function detach() {
    if (!mounted && !player && !video) return;
    stopLoop();
    bindVideo(null);
    if (player) resizeObs.unobserve(player);
    player = null;
    unmount();
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    visible = false;
    hasFrame = false;
  }

  // ----------------------------------------------------------- glow layout

  // Positions the canvas around the player. Returns false if the player has
  // no usable size (hidden, collapsed).
  function layoutGlow() {
    const pr = player.getBoundingClientRect();
    if (pr.width < 80 || pr.height < 45) return false;
    const hr = host.getBoundingClientRect();
    const s = settings.spread;
    const x = Math.round(pr.left - hr.left - host.clientLeft - s);
    const y = Math.round(pr.top - hr.top - host.clientTop - s);
    const w = Math.round(pr.width + s * 2);
    const h = Math.round(pr.height + s * 2);
    const box = x + ',' + y + ',' + w + ',' + h;
    if (box !== lastBox) {
      lastBox = box;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      canvas.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    }
    return true;
  }

  // ---------------------------------------------------------------- drawing

  function bindVideo(next) {
    if (video) for (const type of VIDEO_EVENTS) video.removeEventListener(type, onVideoEvent);
    video = next;
    if (video) for (const type of VIDEO_EVENTS) video.addEventListener(type, onVideoEvent);
  }

  function onVideoEvent(e) {
    // A paused video still deserves the right colours after a seek or load.
    if ((e.type === 'seeked' || e.type === 'loadeddata') && video.paused && visible) {
      draw(performance.now());
    }
    updateLoop();
  }

  // Draws only while the video is actually playing in a visible tab. When
  // it stops, the canvas simply keeps the last frame, so the glow stays.
  function updateLoop() {
    const shouldRun =
      !!video && visible && !document.hidden && !video.paused && !video.ended;
    if (shouldRun) {
      if (!running || loopVideo !== video) {
        stopLoop();
        running = true;
        loopVideo = video;
        scheduleFrame();
      }
    } else {
      if (running) stopLoop();
      // Opened on a paused video (or returned from fullscreen): show one frame.
      if (video && visible && !hasFrame && !document.hidden) draw(performance.now());
    }
  }

  function stopLoop() {
    if (!running) return;
    running = false;
    if (HAS_VFC) loopVideo.cancelVideoFrameCallback(loopHandle);
    else cancelAnimationFrame(loopHandle);
    loopVideo = null;
    loopHandle = 0;
  }

  function scheduleFrame() {
    loopHandle = HAS_VFC
      ? loopVideo.requestVideoFrameCallback(onFrame)
      : requestAnimationFrame(onFrame);
  }

  function onFrame(now) {
    if (!running) return;
    if (now - lastDraw >= MIN_FRAME_MS) draw(now);
    scheduleFrame();
  }

  function draw(now) {
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    // Blend the new frame over the previous one. The alpha is time-based, so
    // the fade speed is the same at any frame rate.
    const dt = now - lastDraw;
    const alpha = hasFrame && dt < 1000 ? 1 - Math.exp(-dt / FADE_MS) : 1;
    ctx.globalAlpha = Math.max(0.08, Math.min(1, alpha));
    try {
      ctx.drawImage(video, 0, 0, CANVAS_W, CANVAS_H);
    } catch (err) {
      return; // frame not available yet
    }
    lastDraw = now;
    if (!hasFrame) {
      hasFrame = true;
      layer.classList.toggle('yag-show', visible);
    }
  }

  // --------------------------------------------------------------- settings

  function applySettings(next) {
    settings = next;
    layer.style.setProperty('--yag-opacity', String(settings.intensity / 100));
    layer.style.setProperty('--yag-dim', String(settings.dim / 100));
    // The blur fades the canvas edges to transparent over roughly two radii,
    // so the immersive canvas overhangs the viewport by at least that much.
    layer.style.setProperty('--yag-bleed', Math.round(settings.blur * BLEED_PER_BLUR) + 'px');
    canvas.style.filter =
      'blur(' + settings.blur + 'px) saturate(' + settings.saturation + '%) brightness(' +
      settings.brightness + '%)';
    lastBox = '';
    sync();
  }

  // Live preview from the popup (sent on every slider move).
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'yag:settings') applySettings(yagSanitize(msg.settings));
  });

  // Saved changes, including ones made while another tab was in front.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const next = { ...settings };
    let touched = false;
    for (const key of Object.keys(YAG_DEFAULTS)) {
      if (key in changes) {
        next[key] = changes[key].newValue === undefined ? YAG_DEFAULTS[key] : changes[key].newValue;
        touched = true;
      }
    }
    if (touched) applySettings(yagSanitize(next));
  });

  chrome.storage.sync.get({ ...YAG_DEFAULTS }, (items) => {
    void chrome.runtime.lastError; // fall back to defaults if storage failed
    settingsLoaded = true;
    applySettings(yagSanitize(items));
  });

  // ------------------------------------------------------------ page events

  // YouTube is a single-page app: these fire on in-app navigation.
  // yt-navigate-start detaches straight away when leaving a watch page, so
  // the next page never renders with transparent backgrounds.
  document.addEventListener('yt-navigate-start', queueSync);
  document.addEventListener('yt-navigate-finish', sync);
  document.addEventListener('yt-page-data-updated', sync);
  document.addEventListener('fullscreenchange', sync);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('popstate', queueSync);

  // Catches the player being created, moved (theater mode, miniplayer) or
  // replaced. Throttled: YouTube mutates the DOM constantly.
  new MutationObserver(() => {
    if (mutationTimer) return;
    mutationTimer = setTimeout(() => {
      mutationTimer = 0;
      sync();
    }, 250);
  }).observe(root, { childList: true, subtree: true });
})();
