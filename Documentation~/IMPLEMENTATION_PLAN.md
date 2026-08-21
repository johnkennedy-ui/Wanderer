# Browser-first implementation plan and current boundary

The current coherent cut is a browser-playable Wanderer vertical MVP. It
contains the browser runtime, deterministic domain, test suite, and a
configuration-only Capacitor boundary. It replaces the earlier documentation
only / Unity planning truth for this repository.

## Delivered browser slices

1. **Foundation:** Vite/TypeScript/Three, explicit composition root, pure domain
   boundaries, browser keyboard/touch adapters, and bounded chunk projection.
2. **Loop:** deterministic world, movement, stationary auto-combat, three
   ordinary archetypes, elite, boss, drops, death/respawn, and passive feedback.
3. **Settlement:** all five building types, freeform validation, three levels,
   relocation, demolition/refund, and effects.
4. **Persistence/progression:** explicit campfire-only versioned saves with
   primary/backup recovery, persistent boss delta, Boss Core, and three-choice
   upgrade selection.
5. **Browser assurance:** deterministic Vitest coverage, architecture guard,
   Vite production build, and Playwright browser consumer scenarios.

## Follow-on order (not part of this candidate)

1. Generate `android/` under a dedicated Capacitor/native contract, record
   generated output and exact browser candidate identity.
2. Implement and validate a native storage/lifecycle adapter with the same
   manual-only primary/backup rules.
3. Run authorised physical-device input, pause/resume, process-loss, safe-area,
   performance, APK/AAB, ARM64, target-SDK, signing, and policy checks.
4. Reassess current Google Play requirements immediately before packaging.

No browser test or configuration file upgrades those native/device items to
verified status. The web runtime remains the canonical gameplay source; a
Capacitor wrapper must package its `dist` output without introducing a second
gameplay authority.
