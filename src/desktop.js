// Tauri v2 replacement for electron/preload.cjs.
// Re-exposes the same `window.desktopWindow.*` surface the renderer already uses,
// so App.jsx call sites stay unchanged. No-op when not running inside Tauri
// (e.g. plain browser), mirroring Electron's `window.desktopWindow` presence guard.
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isEnabled, enable, disable } from "@tauri-apps/plugin-autostart";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const win = inTauri ? getCurrentWindow() : null;

// Apply PIP opacity as CSS dimming of the app content (Option A — keeps the
// transparent, rounded translucent widget intact on Windows).
function applyCssOpacity(opacity) {
  const clamped = Math.min(1, Math.max(0.35, Number(opacity) || 0.92));
  document.documentElement.style.setProperty("--app-opacity", String(clamped));
}

const desktop = inTauri
  ? {
      async setPipMode(enabled, opacity) {
        applyCssOpacity(enabled ? opacity : 1);
        return invoke("set_pip_mode", { enabled: !!enabled, opacity: Number(opacity) });
      },
      async setOpacity(opacity) {
        applyCssOpacity(opacity);
        return invoke("set_opacity", { opacity: Number(opacity) });
      },
      async notify(payload) {
        let granted = await isPermissionGranted();
        if (!granted) granted = (await requestPermission()) === "granted";
        if (!granted) return false;
        return invoke("notify", {
          title: payload?.title ?? "Pomodoro",
          body: payload?.body ?? ""
        });
      },
      async sampleBackground() {
        return invoke("sample_background"); // -> { tone, luminance }
      },
      async pointerOutsideWindow() {
        return invoke("pointer_outside_window"); // -> bool
      },
      async setSkipTaskbar(skip) {
        try {
          await win.setSkipTaskbar(!!skip);
          return true;
        } catch (err) {
          console.error("setSkipTaskbar failed", err);
          return false;
        }
      },
      async setLaunchAtStartup(enabled) {
        // Toggle only when the current state differs — calling disable() on a
        // missing Run entry throws "file not found" on Windows.
        try {
          const current = await isEnabled().catch(() => false);
          if (enabled && !current) await enable();
          else if (!enabled && current) await disable();
          return isEnabled().catch(() => !!enabled);
        } catch (err) {
          console.error("setLaunchAtStartup failed", err);
          return false;
        }
      },
      async getLaunchAtStartup() {
        return isEnabled().catch(() => false);
      },
      async minimize() {
        try {
          await win.minimize();
        } catch (err) {
          console.error("minimize failed", err);
        }
      },
      async close() {
        try {
          await win.close();
        } catch (err) {
          console.error("close failed", err);
        }
      }
    }
  : null;

// Expose under the same name App.jsx already reads, so call sites are untouched.
if (desktop) {
  window.desktopWindow = desktop;
}

export default desktop;
