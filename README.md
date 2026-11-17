# Ambient Glow for YouTube

A Manifest V3 extension for Chrome and Brave that lights the YouTube watch page
with the colours of the video in real time, like a room lit by the screen
(Immersive mode), or adds a glow around the player only (Glow mode).

Plain JavaScript, HTML and CSS. No build step, no frameworks, no remote code,
no analytics, no network requests.

## Install (Load unpacked)

1. Open `chrome://extensions` (Brave: `brave://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this folder (the one containing `manifest.json`).
4. **Reload any YouTube tabs that were already open.** Chrome only injects
   content scripts into pages loaded after the extension was installed.
5. Open a video. Click the toolbar icon to adjust the glow.

After editing any file, press the reload arrow on the extension card and
reload the YouTube tab.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest. Only permission: `storage`. Content script limited to `https://www.youtube.com/*`. |
| `defaults.js` | Default values, slider ranges and input clamping, shared by content script and popup. |
| `content.js` | Finds the player, draws frames, mounts the layer for the current mode, reacts to navigation and settings. |
| `content.css` | The layer styles, plus every YouTube override for Immersive mode (all scoped to an attribute the script sets). |
| `popup.html` / `popup.css` / `popup.js` | The settings popup. |
| `icons/` | 16, 48 and 128 px PNG icons. |

## Modes

- **Immersive** (default). One `<canvas>` is fixed behind the whole page and
  YouTube's own backgrounds are made transparent, so the page becomes a soft
  wash of the video's colours, like a room lit by the screen.
- **Glow**. The original effect: a halo around the player only. YouTube's
  page is left as it is.

## How the effect works

1. **Tiny canvas.** A 64x36 `<canvas>` receives the current video frame via
   `drawImage(video, …)`. That is the only per-frame work done in JavaScript;
   pixel data is never read back.
2. **CSS does the heavy lifting.** The canvas is stretched with CSS and
   `filter: blur() saturate() brightness()` turns it into light. Scaling and
   blurring run on the GPU.
   - Immersive: `#yag-layer` is `position: fixed; inset: 0; z-index: -1;
     pointer-events: none`, appended to `<body>`. The canvas inside it
     overhangs the viewport on every side by 5% (110% overall) or 2.5x the
     blur radius, whichever is larger, so the blur's transparent fringe is
     always off-screen. The layer clips it, so there are no scrollbars.
   - Glow: the layer is mounted on `ytd-watch-flexy` and the canvas is sized
     to the player plus *Spread*.
3. **Smooth fades.** Each new frame is drawn over the previous one with
   partial opacity (`globalAlpha`), derived from the time since the last draw
   (about a 200 ms time constant), so hard cuts cross-fade instead of
   flickering, at any frame rate.
4. **Frame timing.** `requestVideoFrameCallback` when available, otherwise
   `requestAnimationFrame`, capped at roughly 30 draws per second. Drawing
   stops while the video is paused or ended or the tab is hidden; the canvas
   keeps its last frame, so the light stays on. After a seek while paused,
   one frame is drawn so the colours stay correct.
5. **Dim.** `#yag-dim` sits above the canvas and below the page: black in
   dark theme, white in light theme (YouTube's text is dark there).

### When it is active

`content.js` has one idempotent `sync()` that every event calls
(`yt-navigate-start`, `yt-navigate-finish`, `yt-page-data-updated`,
`fullscreenchange`, `visibilitychange`, `popstate`, a `ResizeObserver` and a
throttled `MutationObserver`).

- Only on `/watch`, with the player inside the watch page.
- Off on the home page, search, Shorts, channel pages, the miniplayer, in
  fullscreen and when the popup switch is off. In those cases the layer is
  removed from the DOM and `data-yag-immersive` is removed from `<html>`.
  Every rule in `content.css` is scoped to that attribute (or to
  `[data-yag-host]` for Glow), so nothing of the extension still applies.

## YouTube selectors and variables

Everything below is in `content.css` unless noted. Checked against the live
watch page in November 2026 (dark theme, default view and theater mode).

### Found by content.js

| Selector | Used for |
| --- | --- |
| `ytd-watch-flexy:not([hidden])`, `ytd-watch-grid:not([hidden])` | Watch page root |
| `#movie_player` | The player; class `ytp-player-minimized` = miniplayer |
| `video.html5-main-video` | Frame source |
| `ytd-watch-flexy[fullscreen]` | Fullscreen detection (plus `document.fullscreenElement`) |
| `html[dark]` | Dark / light theme (in `content.css`) |

### CSS variables overridden (Immersive)

Set on `ytd-watch-flexy, ytd-watch-grid`, not on `<html>`, so menus, dialogs
and the guide drawer keep their solid colours.

| Variable | Set to | Note |
| --- | --- | --- |
| `--t3e41d7b17b187f69` | `transparent` | Hashed alias of the base background. **This is the one YouTube's stylesheets reference today.** |
| `--t518e925f61bdcb91` | glass | Hashed alias of the raised background (playlist header, side panels, comment box) |
| `--yt-sys-color-baseline--base-background` | `transparent` | Readable name, current token set |
| `--yt-sys-color-baseline--raised-background` | glass | |
| `--yt-spec-base-background` | `transparent` | Older token set (empty on today's build) |
| `--yt-spec-general-background-a` / `-b` / `-c` | `transparent` | Older |
| `--yt-spec-raised-background` | glass | Older |
| `--yt-deprecated-general-background-a` / `-b` / `-c` | `transparent` | |
| `--yt-saturated-raised-background` | glass (hover) | Description box hover |

If YouTube renames the hashed variables, find the new names in DevTools:
select `ytd-app`, look at its `background` rule, and copy the `var(--t…)`
name. The element rules below do not depend on the variables.

### Elements made transparent (Immersive)

| Area | Selectors |
| --- | --- |
| Page shell | `body`, `ytd-app`, `#content.ytd-app`, `#page-manager.ytd-app`, `ytd-page-manager`, `ytd-watch-flexy`, `ytd-watch-grid`, `#columns.ytd-watch-flexy`, `#primary.ytd-watch-flexy`, `#primary-inner.ytd-watch-flexy`, `#below.ytd-watch-flexy`, `#secondary.ytd-watch-flexy`, `#secondary-inner.ytd-watch-flexy`, `.box.ytd-watch-flexy` |
| `<html>` | Kept at YouTube's page colour (`#0f0f0f` / `#fff`). It paints underneath the canvas, so it never hides the glow; it is what shows before the first frame and at Intensity below 100% |
| Top bar | `ytd-masthead`, `#container.ytd-masthead`, `#frosted-glass.ytd-app` |
| Chips bar | `yt-related-chip-cloud-renderer`, `yt-chip-cloud-renderer`, `#chips-wrapper.yt-chip-cloud-renderer`, `#chips-wrapper.ytd-feed-filter-chip-bar-renderer`, `#left-arrow-button.yt-chip-cloud-renderer`, `#right-arrow-button.yt-chip-cloud-renderer`, `ytd-feed-filter-chip-bar-renderer`, `chip-bar-view-model`, `.ytChipBarViewModelHost`, and the fade gradients `#left-arrow…::after`, `#right-arrow…::before` |
| Sidebar | `#related.ytd-watch-flexy`, `ytd-watch-next-secondary-results-renderer` (and its `#items`), `ytd-item-section-renderer`, `#header.ytd-item-section-renderer`, `ytd-compact-video-renderer`, `yt-lockup-view-model`, `ytd-reel-shelf-renderer`, `ytd-rich-shelf-renderer`, `.button-container.ytd-rich-shelf-renderer` |
| Comments | `ytd-comments`, `#comments.ytd-watch-flexy`, `ytd-comments-header-renderer`, `ytd-comment-thread-renderer`, `ytd-comment-view-model`, `ytd-comment-simplebox-renderer`, `#placeholder-area.ytd-comment-simplebox-renderer` |
| Playlist | `.header.ytd-playlist-panel-renderer`, `.playlist-items.ytd-playlist-panel-renderer`, `ytd-playlist-panel-video-renderer` (glass on `:hover` and `[selected]`) |
| Side panels | `#content.ytd-engagement-panel-section-list-renderer`, `#header.ytd-engagement-panel-title-header-renderer` |

### Frosted glass (semi-transparent + `backdrop-filter`)

| Area | Selectors |
| --- | --- |
| Top bar | `#background.ytd-masthead`; search field `.ytSearchboxComponentInputBox`, `.ytSearchboxComponentSearchButton` (tint only) |
| Description | `#description.ytd-watch-metadata` (and its `[description-collapsed] … :hover` state) |
| Panels | `#container.ytd-playlist-panel-renderer`, `ytd-engagement-panel-section-list-renderer`, `ytd-live-chat-frame` |

### Text shadow

On `ytd-watch-metadata`, `#secondary.ytd-watch-flexy`, `ytd-comments`,
`ytd-playlist-panel-renderer`, `ytd-engagement-panel-section-list-renderer`
(it inherits to all text inside). Switched off again for `button`,
`yt-chip-cloud-chip-renderer`, `.ytChipShapeChip`, `.badge`,
`.ytBadgeShapeHost`.

### Player and YouTube's own ambient mode

| Selector | Rule |
| --- | --- |
| `ytd-watch-flexy:not([theater]):not([fullscreen]) #ytd-player.ytd-watch-flexy` | `border-radius: 12px; overflow: hidden`. Nothing else touches the player |
| `#cinematics-container`, `#cinematics.ytd-watch-flexy` | Hidden in both modes, so YouTube's ambient mode does not stack with this one |

### Glow mode only

`[data-yag-host]` (set on `ytd-watch-flexy`) gets `isolation: isolate`, and
`position: relative` if it was static.

## Settings

Stored in `chrome.storage.sync`. The popup sends each change straight to the
active tab for an instant preview and saves it 250 ms after the last change
(`storage.sync` is limited to about 120 writes per minute, less than a dragged
slider produces). Other open YouTube tabs pick the change up through
`chrome.storage.onChanged`.

| Setting | Default | Range | Modes |
| --- | --- | --- | --- |
| Enabled | on | on / off | both |
| Mode | Immersive | Immersive / Glow | |
| Intensity (opacity) | 90% | 0 - 100% | both |
| Blur | 80 px | 0 - 150 px | both |
| Saturation | 180% | 50 - 300% | both |
| Brightness | 120% | 50 - 200% | both |
| Dim | 25% | 0 - 90% | Immersive |
| Spread | 60 px | 0 - 200 px | Glow |

**Reset** restores the sliders and keeps the on/off switch and the mode.

## Known limits

- DRM-protected videos (purchased films) draw as black, so the light is dark.
- Live chat is an iframe; its inside keeps YouTube's solid background.
- In theater mode the black bars beside the video belong to the player and
  are left alone.
- Other extensions that restyle the watch page (other ambient-light
  extensions, vidIQ panels) keep their own backgrounds, and a second ambient
  extension will stack with this one.
- `m.youtube.com`, embedded players and YouTube Music are out of scope.

## Chrome Web Store publishing checklist

Preparation
- [x] Listing name is "Ambient Glow for YouTube" (`name` and `default_title` in
      `manifest.json`). The icon is a plain screen with coloured light around
      it and uses nothing from YouTube's logo.
- [ ] Bump `version` in `manifest.json` for every upload.
- [ ] Run the manual tests below in Chrome and Brave.
- [ ] Zip the **contents** of this folder so `manifest.json` is at the root
      of the zip. The README may stay; leave out anything else you add
      (`.git`, screenshots, notes).

Developer account
- [ ] Register at the Chrome Web Store Developer Dashboard (one-time US$5 fee).
- [ ] Verify your contact email; turn on 2-step verification on the Google account.

Store listing
- [ ] Description: what it does, that it only runs on youtube.com, and that
      it is not affiliated with YouTube or Google.
- [ ] Category (e.g. "Fun" or "Accessibility & Tools") and language.
- [ ] Store icon 128x128 (`icons/icon128.png`).
- [ ] At least one screenshot, 1280x800 or 640x400. Dark theme shows the effect best.
- [ ] Optional: small promo tile 440x280.

Privacy tab
- [ ] Single purpose: "Adds an ambient light effect to the YouTube watch page that follows the colours of the video."
- [ ] Justify `storage`: "Saves the user's glow settings (on/off, intensity,
      mode, blur, saturation, brightness, dim, spread)."
- [ ] Justify host access to `https://www.youtube.com/*`: "The content script
      reads the video element on the page to draw the light behind the page, and restyles the watch page so it shows through."
- [ ] Remote code: **No**.
- [ ] Data usage: no user data collected, sold or transferred. Tick the three
      certification boxes.
- [ ] A privacy policy URL is not required when no data is collected, but a
      one-paragraph page stating that is quick to write and avoids questions.

Submit
- [ ] Choose visibility (Public / Unlisted) and regions, then **Submit for review**.
- [ ] Review usually takes from a few hours to a few days. Host access to a
      specific site can add time.
- [ ] After approval, install from the store in a clean profile and repeat a
      short smoke test.

Brave installs extensions from the Chrome Web Store, so no separate listing is needed.

## Manual test cases

Reload the extension and the YouTube tab before starting. Run everything in
Chrome, then repeat in Brave.

| # | Test | Steps | Expected |
| --- | --- | --- | --- |
| 0 | Both modes | Run tests 1-9 and 14-16 once in **Immersive** and once in **Glow** | In Immersive "glow" below means the whole page background |
| 1 | First load | Open any `youtube.com/watch` video | Glow fades in around the player within about a second and follows the video colours |
| 2 | New video navigation | Click a suggested video, then use browser Back | Glow carries on with the new video, no reload needed; only one glow |
| 3 | Home to video | Start on the YouTube home page, click a video | Glow appears; nothing is drawn on the home page |
| 4 | Theater mode | Press `t` twice | Glow follows the player into theater mode and back; no horizontal scrollbar |
| 5 | Fullscreen | Press `f`, then `Esc` | No glow in fullscreen; it returns afterwards |
| 6 | Miniplayer | Press `i`, then expand again | No glow around the miniplayer or on the page behind it; returns on expand |
| 7 | Pause | Pause, wait, seek while paused, play | Glow stays still while paused, updates once after the seek, resumes on play |
| 8 | Hidden tab | Switch to another tab for a while and come back | Glow resumes immediately; CPU for the tab drops while hidden (Task Manager, Shift+Esc) |
| 9 | Clicks | Use the player controls, like button, description, comments, sidebar | Everything is clickable as usual |
| 10 | Popup live update | Move each slider and flip the toggle with a video open | The page changes while dragging, no reload |
| 11 | Persistence | Change settings, close the popup, reload the tab, reopen the popup | Settings are kept; **Reset** restores defaults |
| 12 | Two tabs | Open two videos in two tabs, change a setting in one | The other tab picks it up |
| 13 | Light theme | YouTube avatar menu > Appearance > Light | Glow visible and softer; text stays readable |
| 14 | Window resize | Resize the window, cross the single-column breakpoint | Glow stays aligned with the player |
| 15 | Ads and live | Watch a video with a pre-roll ad, and a live stream | Glow follows the ad, then the video; works on live |
| 16 | Other pages | From a video, go to Home, search results, Shorts and a channel page | No glow, YouTube looks completely normal (solid backgrounds, no `data-yag-immersive` on `<html>`), no console errors |
| 16b | Mode switch | Flip Immersive / Glow in the popup with a video playing | Switches live; Dim shows only in Immersive, Spread only in Glow |
| 16c | Menus | In Immersive open the account menu, the ⋯ menu, Save to playlist and the guide drawer | All keep solid, readable backgrounds |
| 16d | Playlist | In Immersive open a video from a playlist | Playlist panel is frosted, rows readable, current row highlighted |
| 17 | Brave | Repeat 1-7 with Shields at default | Same behaviour as Chrome |
| 18 | Errors | `chrome://extensions` > extension card | No **Errors** button appears |
