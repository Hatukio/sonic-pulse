# Sonic Pulse Immersive V2 Design

Date: 2026-07-02
Status: Approved in conversation; awaiting written-spec review
Selected visual direction: A — Arc Theatre
Selected rendering architecture: Three.js/WebGL with a future WebGPU boundary

## 1. Objective

Upgrade Sonic Pulse from a Canvas-based music visualizer into a fully interactive, immersive Electron music player. The experience must exceed the supplied Mineradio reference in visual depth while remaining usable for long listening sessions.

This release covers four coordinated upgrades:

1. A GPU-accelerated volumetric 3D point-cloud scene generated from album artwork.
2. Rhythm-adaptive spatial lyrics inside the player and in a separate desktop overlay.
3. User-selectable 30, 60, 120, and unlocked animation frame rates.
4. An Arc Theatre control surface inspired by a precise JARVIS command system.

The architecture must allow future camera-based gesture control without implementing or pretending to implement gesture recognition in this release.

## 2. Confirmed Product Decisions

- The default playback experience is always the 3D point-cloud scene.
- Official MV playback is optional and initiated by the user.
- A song displays an `MV` badge only when its active music provider reports an official MV.
- The first provider is NetEase Cloud Music. Provider interfaces must support future QQ Music and Qishui Music adapters.
- MV playback uses the highest quality officially available and preserves the MV's source frame rate.
- The animation frame-rate selector controls the point cloud, lyrics, camera, particles, HUD, and UI motion. It does not alter MV source frame rate.
- Desktop lyrics use the same immersive, rhythm-adaptive visual language as in-app lyrics.
- Desktop lyrics are freely positionable at the center, edges, or bottom of any display.
- The selected visual direction is Arc Theatre: full-bleed immersion, restrained chrome, a right-side command rail, and a low glass playback arc.

## 3. Scope and Non-Goals

### In scope

- Three.js/WebGL rendering engine.
- Album-art point sampling and volumetric point-cloud generation.
- Audio-feature-driven point-cloud, camera, post-processing, and lyric behavior.
- NetEase official MV discovery, badge state, URL retrieval, playback, and graceful fallback.
- Provider abstraction for future music platforms.
- In-app spatial lyrics with translation support.
- Transparent, always-on-top, click-through desktop lyric window with a layout mode.
- 30/60/120/unlocked animation scheduling and real-time FPS reporting.
- Arc Theatre JARVIS control rail and persistent settings.
- Modularization of the existing monolithic front end where required by these features.

### Out of scope

- Camera permission requests.
- Hand detection, gesture classification, or gesture-driven commands.
- QQ Music and Qishui Music integrations.
- Unofficial MV scraping or cross-platform MV substitution.
- MV downloading, redistribution, DRM circumvention, or quality unlocking.
- Automatic frame-rate downgrades that override a user's explicit selection.

## 4. System Architecture

The renderer and interaction model are split into independently testable modules rather than added to the existing single-file script.

### Core modules

- `AudioEngine`: owns the media element and Web Audio graph; publishes frequency bands, RMS energy, onset strength, dynamic range, beat pulses, and playback time.
- `SceneEngine`: owns the Three.js renderer, camera, scene, point-cloud meshes, post-processing, and scene transitions.
- `PointCloudGenerator`: samples album artwork and produces positions, colors, depth, edge weights, and stable particle identifiers.
- `VisualConductor`: converts audio features into a smoothed visual personality and parameter set.
- `LyricEngine`: loads, parses, synchronizes, and renders word- or line-timed lyrics and translations.
- `MVLayer`: discovers availability, requests an official URL, synchronizes video playback, and exposes MV state without replacing the audio source of truth.
- `RenderScheduler`: enforces the selected animation frame-rate policy and reports measured FPS.
- `MediaProvider`: platform-neutral contract for songs, lyrics, official MV metadata, and media URLs.
- `DesktopLyricBridge`: synchronizes lyric state and visual parameters to the separate Electron overlay window.
- `JarvisConsole`: edits and persists visual, lyric, MV, desktop, performance, and input settings.
- `InputRouter`: maps mouse and keyboard input today and provides a stable future adapter boundary for gestures.

### Provider contract

Each provider exposes normalized methods equivalent to:

- `getSong(id)`
- `getLyrics(id)`
- `getOfficialMV(id)`
- `getMVStream(mvId, preferredQuality)`
- `getArtwork(id)`

The normalized song model includes `provider`, `providerSongId`, `officialMV`, and `officialMVId`. NetEase song responses commonly contain an MV identifier; its presence is treated only as an availability hint until MV metadata is confirmed.

### Playback data flow

1. The user selects a song.
2. Audio begins through the existing same-origin proxy path.
3. Artwork and lyrics load concurrently.
4. The point cloud is generated and becomes the default scene.
5. Official MV availability resolves asynchronously and updates the song-row badge and playback control.
6. If the user enables MV, the official highest-quality stream is loaded into `MVLayer`.
7. Lyrics and a reduced-intensity particle layer remain above the MV.
8. If the MV fails or is closed, the existing point-cloud scene resumes without stopping or restarting the song.

## 5. Three-Dimensional Visual System

### Point-cloud construction

Album artwork is decoded into an offscreen texture. The generator uses:

- Color-aware pixel sampling.
- Edge weighting to preserve faces, lettering, and recognizable silhouettes.
- Luminance- and edge-derived depth.
- Seeded noise so regeneration remains stable for the same artwork.
- Stable particle IDs so particles morph instead of popping between layouts.

The initial implementation provides four spatial forms:

- Artwork sculpture: recognizable volumetric album composition.
- Nebula field: full-screen spatial expansion.
- Energy tunnel: forward motion for dense rhythmic passages.
- Fluid ribbons: slow continuous flow for low-energy music.

Transitions interpolate GPU buffers and shader parameters rather than rebuilding DOM or recreating every particle.

### Rhythm adaptation

`VisualConductor` derives a visual personality from smoothed low-, mid-, and high-frequency energy, onset density, dynamic range, and recent beat strength.

- Ambient/ballad: breathing depth, slow orbit, long trails, restrained bloom.
- Pop: elastic motion, clear beat pulses, medium camera travel.
- Rock/electronic: shockwaves, stronger depth displacement, rapid but bounded camera energy.
- Fluid/R&B: ribbon-like shear, lateral flow, softer transitions.

Automatic selection is the default. The user can lock any form or personality from the console.

### Post-processing

The Arc Theatre look uses controlled bloom, depth fog, chromatic energy at high-intensity moments, motion trails, and vignette. Effects are capped to preserve lyric readability and avoid constant maximum intensity.

## 6. MV Experience

- The point-cloud scene remains the default even when an MV exists.
- The library and song lists show an `MV` badge only after official availability is confirmed.
- The playback arc exposes an MV toggle only for an available official MV.
- Enabling MV crossfades the scene into a full-bleed video plate.
- Lyrics, lightweight beat particles, and the playback arc remain visible.
- MV quality is the highest officially returned by the active provider.
- The MV keeps its original frame rate; Sonic Pulse animation layers follow the user's selected render rate.
- MV audio is muted so the existing audio track remains the timing and volume authority.
- MV time follows the main audio clock. Drift beyond the defined tolerance triggers a seek correction.

Failure states are local: unavailable URLs, authorization failures, decoding errors, or network interruption show a concise message and return to the still-running point-cloud scene.

## 7. Immersive Lyrics

### Timing

The lyric loader prefers word-level timing when the provider supplies it. If only line-level LRC data exists, words receive proportional timing based on character count and punctuation, with the original line time retained as the synchronization boundary.

### In-app rendering

Lyrics are scene elements with depth and camera relationship, not a flat page overlay. Four rhythm-compatible behaviors are available to the conductor:

- Depth focus: the current phrase approaches while context recedes.
- Orbital line: words follow a shallow curved path through the point cloud.
- Particle materialization: the current phrase forms from nearby particles and disperses after completion.
- Energy typography: beat pulses travel through glyph glow and outline without moving the reading anchor excessively.

The active lyric remains readable at all times. Strong transitions happen at phrase boundaries and musical onsets rather than continuously shaking individual characters.

Translation is visually secondary and can be disabled independently.

### Desktop lyric window

Electron creates a separate transparent, frameless, always-on-top window.

Normal mode:

- Does not take focus.
- Ignores mouse events and forwards them to the application beneath it.
- Displays the selected rhythm-adaptive lyric style.

Layout mode:

- Temporarily accepts mouse input.
- Shows a restrained placement frame and drag handle.
- Supports free drag, scale, width, opacity, and display selection.
- Saves bounds and style when layout mode ends.

The overlay can be placed at the center, edges, or bottom of any monitor. The user can separately limit its effect intensity when a calmer desktop experience is desired.

## 8. Frame-Rate Policy

The available values are `30`, `60`, `120`, and `unlocked`.

- 30/60/120 use a time-based scheduler that renders only when the corresponding frame interval elapses.
- Unlocked renders on every available animation frame.
- Simulation and motion use elapsed time, not frame count, so speed does not change between modes.
- Measured FPS and GPU load appear in the performance panel.
- Performance warnings are advisory. Sonic Pulse does not silently override the selected rate.
- MV source playback remains independent.
- The desktop lyric window uses the same selected animation rate unless the user later receives a dedicated override in a separate release.

## 9. Arc Theatre Interface

### Default state

The main surface is full-bleed visual content with minimal persistent chrome:

- Small Sonic Pulse identity and state at the top.
- Central spatial lyric and point-cloud scene.
- Low glass playback arc with artwork, track, transport, progress, MV state, and selected FPS.
- Compact energy-core button at the lower right.

### Expanded command rail

Activating the energy core opens a translucent right-side command rail. The rail does not cover the central lyric anchor.

Control groups:

1. Visual Core: point-cloud form, particle count, depth, bloom, trails, camera.
2. Lyrics: automatic style, manual style lock, size, intensity, translation.
3. MV: official MV state, toggle, active quality, synchronization state.
4. Desktop Lyrics: enable, enter layout mode, opacity, display, reset placement.
5. Performance: 30/60/120/unlocked, measured FPS, GPU load, warning state.
6. Input: mouse and keyboard status plus a disabled, clearly labeled future gesture entry.

The rail uses cyan-white functional light, restrained amber for MV and warnings, and no decorative telemetry that lacks a real value.

## 10. Persistence

Versioned settings are stored locally and include:

- Render frame rate.
- Automatic or locked visual personality.
- Particle and post-processing values.
- Lyric visibility, style lock, size, intensity, and translation.
- Desktop lyric enabled state, monitor, bounds, opacity, and style intensity.
- MV preference for the current session. MV does not auto-enable merely because the previous song had an MV.

Invalid or old settings migrate to safe defaults. The console provides a restore-defaults action.

## 11. Failure Handling and Progressive Degradation

- WebGL unavailable: retain audio, library, controls, and a simple non-3D lyric display.
- Artwork unavailable or CORS-blocked: generate a provider-colored procedural cloud.
- Word timing unavailable: use line timing with proportional word progression.
- Lyrics unavailable: keep the visualizer and display a non-blocking unavailable state.
- MV unavailable or failed: retain audio and return to point cloud.
- Desktop overlay cannot be created: keep in-app lyrics and expose a clear error in the desktop section.
- Performance below the selected target: show measured FPS and recommendations without forced changes.
- Provider request failure: identify the provider and affected resource; do not collapse unrelated playback state.

## 12. Security, Privacy, and Rights Boundaries

- Only official MV metadata and streams reported by the active provider are used.
- No MV downloads or redistribution are implemented.
- Existing authentication cookies remain in server memory and are not exposed to the renderer.
- Renderer-facing APIs return normalized data, not raw provider credentials.
- Desktop lyrics require no screen capture or accessibility control.
- Camera permissions are not requested in this release.

## 13. Verification Strategy

### Unit coverage

- Frame scheduler timing at all four settings.
- Point-cloud sampling determinism and valid buffer sizes.
- Visual-conductor smoothing and personality boundaries.
- LRC and word-timed lyric parsing and fallbacks.
- Provider normalization and MV badge logic.
- Settings validation and migration.

### Integration coverage

- Play, pause, seek, previous, next, and track changes.
- Song with official MV, song without MV, and failed MV URL.
- MV/audio synchronization and return to point cloud.
- In-app lyric synchronization with and without word timing.
- Desktop lyric creation, click-through, layout mode, persistence, and multiple displays.
- Console controls changing real renderer state.

### Visual and performance coverage

- Arc Theatre layout at the Electron minimum size and 1280×800 default.
- 30, 60, 120, and unlocked animation behavior.
- Point-cloud transition continuity and lyric readability.
- MV, lyrics, particles, and playback chrome layering.
- Reduced-motion behavior.
- GPU-resource cleanup after repeated track and MV changes.

## 14. Migration Strategy

The existing player remains functional while responsibilities move out of `public/index.html` in vertical slices:

1. Extract shared playback and state contracts without changing behavior.
2. Introduce Three.js scene hosting beside the existing canvas path.
3. Move audio analysis to `AudioEngine` and connect the new scene.
4. Add provider-normalized MV metadata and MV playback.
5. Replace the lyric overlay with `LyricEngine`.
6. Add the desktop lyric window and bridge.
7. Replace the simple visual console with Arc Theatre.
8. Remove superseded canvas code after regression verification.

This sequence avoids a single all-or-nothing rewrite and keeps local-file playback available throughout development.

## 15. Acceptance Criteria

- A song starts in an artwork-derived volumetric point-cloud scene.
- Visual behavior changes meaningfully with musical energy while preserving lyric readability.
- Songs with confirmed official MVs display an MV badge; songs without MVs do not.
- MV playback is user-initiated, highest official quality, synchronized to audio, and safely reversible.
- 30, 60, 120, and unlocked modes affect all non-MV animation layers without changing motion speed.
- The Arc Theatre command rail is functional and does not obstruct the lyric anchor.
- Desktop lyrics remain visually immersive, can be placed freely, and do not block other applications outside layout mode.
- Playback continues through missing lyrics, failed MV requests, or renderer degradation.
- No camera permission is requested and no gesture feature is presented as working.
