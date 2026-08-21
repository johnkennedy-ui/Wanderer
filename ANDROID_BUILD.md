# Capacitor Android follow-on — configuration only

This browser cut includes `@capacitor/core`, `@capacitor/android`,
`@capacitor/cli`, and `capacitor.config.ts`. The configuration names `dist` as
`webDir`, so a future wrapper consumes the exact Vite web build rather than a
separate Android gameplay fork.

No generated wrapper is present. In particular, this cut did **not** run:

```bash
npx cap add android
npx cap sync android
```

`npm run android:sync` is intentionally a future command; it needs an
authorised, separately evidenced wrapper-generation task first. It must not be
used as evidence for a browser build.

## Still unverified

- Android wrapper generation and source review
- Android/Capacitor local-storage recovery semantics
- pause/resume and background/process-loss behaviour
- APK/AAB, ARM64, SDK/target-SDK compatibility, signing, install, or device UI
- performance, safe-area behaviour, Play policy, and Play submission

A separately scoped Android task must create the generated `android/` output,
validate its generated-artifact status, and run device evidence against the
same committed browser candidate. Browser Playwright tests are not physical
Android results.
