# Native Mobile Tracking Architecture & PWA Background Limitations

## 1. Browser PWA Limitations (Truthful Disclosure)
The Delivery Partner application ships as an installable Progressive Web App (`SLM Rider`) powered by `navigator.geolocation.watchPosition()` through the `BrowserGeolocationTracker` implementation of `ITrackingTransport`.

**Important Web Runtime Constraint:**
- A browser-based PWA **cannot guarantee continuous background GPS transmission** when:
  - The user locks their phone screen,
  - The browser app is minimized or switched away from (`visibilitychange` fires `BACKGROUNDED`), or
  - The OS suspends background JavaScript timers/processes or terminates the browser tab.
- The app explicitly surfaces `BACKGROUNDED`, `PAUSED`, `OFFLINE`, `GPS_DISABLED`, `PERMISSION_DENIED`, `POOR_ACCURACY`, and `PERMISSION_REVOKED` states cleanly in the Rider Dashboard rather than fabricating simulated GPS coordinates.

## 2. Clean Extension Path to Native Android (`Capacitor` / Kotlin `ForegroundService`)
To provide uninterrupted background GPS tracking even when the rider locks their screen or opens Google Maps turn-by-turn navigation:

1. **Shared Contract (`ITrackingTransport` in `src/services/location-tracker.ts`)**:
   - All UI components depend strictly on `ITrackingTransport` (`start()`, `stop()`, `pause()`, `resume()`, `getSnapshot()`).
   - Swap `BrowserGeolocationTracker` with a `CapacitorNativeLocationTransport` adapter when running inside Capacitor Android/iOS shells (`Capacitor.isNativePlatform()`).

2. **Android Foreground Service Requirements**:
   - Declare `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, and (if needed across restarts) `ACCESS_BACKGROUND_LOCATION` in `AndroidManifest.xml`.
   - Start a dedicated Android `ForegroundService` (`foregroundServiceType="location"`) **ONLY** when an assignment transitions into `TRACKABLE_ASSIGNMENT_STATUSES` (`ACCEPTED` through `ARRIVED_AT_CUSTOMER`).
   - Display a **persistent, non-dismissible system notification** while active:
     `"Shree Leela Rider · Active Delivery Tracking — Sharing route location for Order #SLM-..."` with a Stop/Pause action.
   - Immediately call `stopForeground(STOP_FOREGROUND_REMOVE)` and `stopSelf()` when the delivery transitions to `DELIVERED`, `RETURNED`, `CANCELLED`, or `ASSIGNMENT_REJECTED`.

3. **Backend Authentication & Data Minimization Continuity**:
   - Native transport posts to the exact same `POST /api/delivery/location` endpoint using session authentication, `{ orderId, latitude, longitude, heading, speedKmh, accuracyM, deviceTimestamp }`, inheriting server-side assignment ownership validation, speed/jump anomaly detection, and 30-day retention pruning automatically.
