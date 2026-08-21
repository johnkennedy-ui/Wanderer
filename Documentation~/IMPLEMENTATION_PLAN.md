# Browser-first implementation plan and current boundary

The current coherent cut is a browser-playable Wanderer vertical MVP. It contains the browser runtime, deterministic domain, test suite, and a configuration-only Capacitor boundary. It replaces the earlier documentation-only / Unity planning truth for this repository.

## Delivered browser slices

1. **Foundation:** Vite/TypeScript/Three, explicit composition root, pure domain boundaries, browser keyboard/touch adapters, and bounded chunk projection.
2. **Loop:** deterministic world with distance danger, movement, stationary auto-combat, data-driven normal/elite/boss rewards, death respawn, and readable runtime effects.
3. **Settlement:** exactly five buildings with data-driven costs, actual distinct L1-L3 Campfire/Workshop/Farm/Storage/Healer effects, freeform validation, relocation, demolition/refund, and capacity enforcement.
4. **Persistence/progression:** five resource roles, explicit campfire-only version-2 saves, committed save-point identity/position, Boss Core, ten upgrades including qualitative Chain Strike, and primary/backup recovery.
5. **Browser assurance:** deterministic Vitest coverage, architecture guard, Vite production build, and Playwright browser consumer scenarios.

## Follow-on order (not part of this candidate)

1. Generate `android/` under a dedicated Capacitor/native contract, record generated output and exact browser candidate identity.
2. Implement and validate a native storage/lifecycle adapter with the same manual-only primary/backup rules.
3. Run authorised physical-device input, pause/resume, process-loss, safe-area, performance, APK/AAB, ARM64, target-SDK, signing, and policy checks.
4. Reassess current Google Play requirements immediately before packaging.

No browser test or configuration file upgrades those native/device items to verified status. Native Android is ungenerated and unverified. The web runtime remains the canonical gameplay source; a Capacitor wrapper must package its `dist` output without introducing a second gameplay authority.
