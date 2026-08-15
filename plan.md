## Plan: Add DLNA Media Server Mode

Extend the current single-mode Internet Radio app into a dual-mode player (Radio and DLNA Media Server) with a top-page mode switch, while preserving all current radio behavior. The recommended approach is to keep one Flask app and one SPA-like page, add a mode-aware API layer, and add a DLNA browsing state machine on the frontend (server list -> folders -> tracks). Start with MVP scope: browse and play DLNA tracks only, and persist the last selected mode.

**Steps**
1. Phase 1 - Data model and mode foundation
2. Add playback mode persistence to backend data schema in [app.py](app.py): keep existing categories/stations structure and add mode field with backward-compatible default to Radio for older data.
3. Update data load/save path in [app.py](app.py) so mode survives restart and remains safe if field is missing. This enables switch continuity without breaking existing stations CRUD.
4. Add mode APIs in [app.py](app.py): GET current mode and PUT mode changes, with strict validation (radio or media_server).
5. Update status response contract in [app.py](app.py) to include active mode so frontend can render correct labels and controls even after refresh.
6. Phase 2 - DLNA service integration (backend)
7. Introduce a dedicated DLNA integration layer (new module) using Python DLNA/UPnP library (as chosen), isolated from route handlers to keep [app.py](app.py) maintainable.
8. Add API for server discovery in [app.py](app.py): return discovered media servers with stable identifiers and friendly names; include timeout/error handling for slow networks.
9. Add API for browsing in [app.py](app.py): given server id and container id/path, return folders + tracks in a normalized shape (item type, title, id/path, playable URL if available).
10. Add API for play action in [app.py](app.py): resolve selected DLNA track to stream URL, then reuse current MPC playback path (clear/add/play) so transport controls remain consistent.
11. Make /api/status mode-aware in [app.py](app.py): in radio mode keep current station matching; in media_server mode report track metadata and source type without forcing station id mapping.
12. Phase 3 - Frontend mode switch and DLNA navigation UI
13. Add a top mode switch UI in [templates/index.html](templates/index.html) above the title area (Radio | Media Server), preserving existing layout and controls below.
14. Add mode-specific containers in [templates/index.html](templates/index.html): keep current radio sections untouched and add a new Media Server view (servers list, breadcrumb/path bar, folder/track list).
15. Extend frontend state in [static/app.js](static/app.js): current mode, discovered servers, active server, navigation stack/breadcrumb, and selected track context.
16. Implement mode switching actions in [static/app.js](static/app.js): switch visible sections, call mode API, and trigger initial DLNA screen load when entering media server mode.
17. Implement DLNA browse flow in [static/app.js](static/app.js): server list -> folder drilling -> breadcrumb back navigation -> track selection and play.
18. Make transport actions mode-aware in [static/app.js](static/app.js): Play/Pause/Stop remain shared; Prev/Next behavior remains radio-centric in MVP (can be disabled or labeled in media mode to avoid ambiguous behavior).
19. Keep periodic status sync in [static/app.js](static/app.js) and adapt render logic by mode so now playing text stays correct for both radio stream metadata and DLNA track metadata.
20. Add focused styling for switch + breadcrumb + list states in [static/style.css](static/style.css), reusing existing station card patterns for mobile friendliness.
21. Phase 4 - Hardening and fallback behavior
22. Add graceful fallback when DLNA library/network is unavailable: backend returns explicit errors; frontend shows friendly status and allows switching back to radio instantly.
23. Keep current local-development behavior (missing MPC) consistent with existing unavailable responses in [app.py](app.py).
24. Ensure mode changes do not interfere with existing category/station management workflows in [static/app.js](static/app.js) and [templates/index.html](templates/index.html).
25. Phase 5 - Verification and release readiness
26. Validate full radio regression manually: station select, favorites, CRUD categories/stations, volume, pause/resume, status polling.
27. Validate DLNA MVP manually: discover servers, enter server, traverse folders, play track, switch mode while playing, refresh page and confirm persisted mode.
28. Validate resilience cases: unreachable server, empty folder, malformed metadata, long folder names on mobile, and slow discovery timeout messaging.
29. Smoke-test on Raspberry Pi Zero 2W for responsiveness under polling + DLNA browse, and confirm no crashes from repeated mode toggling.

**Relevant files**
- [app.py](app.py) - extend data schema persistence, add mode API, add DLNA discovery/browse/play APIs, and make status mode-aware.
- [templates/index.html](templates/index.html) - add top mode switch and media-server mode container while keeping existing radio sections.
- [static/app.js](static/app.js) - add mode state machine, DLNA navigation flow, API wiring, and mode-aware rendering/sync behavior.
- [static/style.css](static/style.css) - style mode switch, media list/breadcrumb, and mobile-safe behavior.
- [stations.json](stations.json) - persisted mode field addition (backward-compatible migration path).

**Verification**
1. Start app and verify mode defaults/backward compatibility using existing data file (no data loss).
2. Test API contracts with browser or curl-style calls: mode get/set, DLNA servers, DLNA browse, DLNA play, and status in both modes.
3. Confirm UI behavior on desktop and mobile widths: switch placement, list readability, breadcrumb overflow handling.
4. Regression-test radio controls and management modals after adding media server mode.
5. Run real-device test on Pi Zero 2W with an actual DLNA server on LAN; verify switch latency and playback stability.

**Decisions**
- Use Python DLNA library integration on backend (not external CLI-first approach).
- Persist last selected mode across restarts.
- Scope first iteration to MVP: server/folder/track browse and direct track playback only.
- Keep one-page architecture and reuse current control/status components.

**Further Considerations**
1. Prev/Next semantics in media mode: Option A disable in media mode for MVP, Option B map to folder list neighbors, Option C implement queue-first behavior. Recommendation: Option A now, revisit after MVP stabilizes.
2. Data migration strategy: store mode in stations.json now (simple), and move to separate settings file later only if config expands.
3. Discovery cache TTL: add short server cache (for example 10-30s) to reduce repeated network scans from frequent UI refreshes.