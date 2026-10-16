use serde::Serialize;
use std::sync::Mutex;
use tauri::{LogicalSize, Manager, PhysicalPosition, WebviewWindow};

// Remembers the "normal" window bounds while the app is in PIP mode, so exiting
// PIP restores the previous size/position (replaces electron/main.cjs `normalBounds`).
#[derive(Default)]
struct AppState {
    normal_bounds: Mutex<Option<(i32, i32, u32, u32)>>, // physical x, y, w, h
    is_pip: Mutex<bool>,
}

fn clamp_opacity(v: f64) -> f64 {
    if v.is_nan() {
        0.92
    } else {
        v.clamp(0.35, 1.0)
    }
}

#[inline]
fn e(err: tauri::Error) -> String {
    err.to_string()
}

// ============================================================
//  set_pip_mode — mirrors electron/main.cjs PIP toggle
// ============================================================
#[tauri::command]
fn set_pip_mode(
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
    enabled: bool,
    opacity: f64,
) -> Result<bool, String> {
    let was_pip = *state.is_pip.lock().unwrap();

    if enabled {
        // Capture the normal bounds only on the normal -> PIP transition, so a
        // re-invoke while already in PIP (e.g. starting a timer) can't overwrite
        // them with the tiny PIP size.
        if !was_pip {
            if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
                *state.normal_bounds.lock().unwrap() = Some((pos.x, pos.y, size.width, size.height));
            }
        }

        window
            .set_min_size(Some(LogicalSize::new(244.0, 244.0)))
            .map_err(e)?;
        window.set_resizable(false).map_err(e)?;
        window.set_always_on_top(true).map_err(e)?;

        // Reposition to the top-right of the current bounds (physical px), like Electron.
        if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
            let scale = window.scale_factor().unwrap_or(1.0);
            let pip_w = (244.0 * scale) as i32;
            let new_x = pos.x + (size.width as i32 - pip_w).max(0);
            window
                .set_position(PhysicalPosition::new(new_x, pos.y))
                .map_err(e)?;
        }
        window.set_size(LogicalSize::new(244.0, 244.0)).map_err(e)?;
        // Opacity is applied as CSS dimming on the JS side (transparent windows on
        // Windows can't use native layered opacity). Keep the value validated here.
        let _ = clamp_opacity(opacity);
    } else {
        window.set_always_on_top(false).map_err(e)?;
        window.set_resizable(true).map_err(e)?;
        window
            .set_min_size(Some(LogicalSize::new(360.0, 380.0)))
            .map_err(e)?;

        let saved = state.normal_bounds.lock().unwrap().take();
        if let Some((x, y, w, h)) = saved {
            window.set_size(tauri::PhysicalSize::new(w, h)).map_err(e)?;
            window
                .set_position(PhysicalPosition::new(x, y))
                .map_err(e)?;
        } else {
            window.set_size(LogicalSize::new(420.0, 442.0)).map_err(e)?;
            window.center().map_err(e)?;
        }
    }

    *state.is_pip.lock().unwrap() = enabled;
    Ok(enabled)
}

// ============================================================
//  set_opacity — CSS handles the visual; native path is a validated no-op.
// ============================================================
#[tauri::command]
fn set_opacity(opacity: f64) -> Result<bool, String> {
    let _ = clamp_opacity(opacity);
    Ok(true)
}

// ============================================================
//  notify — silent OS toast (renderer plays its own sound)
// ============================================================
#[tauri::command]
fn notify(window: WebviewWindow, title: String, body: String) -> Result<bool, String> {
    use tauri_plugin_notification::NotificationExt;
    window
        .app_handle()
        .notification()
        .builder()
        .title(if title.is_empty() {
            "Pomodoro".to_string()
        } else {
            title
        })
        .body(body)
        .show()
        .map_err(|err| err.to_string())?;
    Ok(true)
}

// ============================================================
//  sample_background — region BitBlt behind the widget -> light/dark tone
// ============================================================
#[derive(Serialize)]
struct BackgroundTone {
    tone: String,
    luminance: Option<u32>,
}

const REGION_MARGIN: i32 = 20;
const TONE_THRESHOLD: f32 = 150.0;

#[tauri::command]
fn sample_background(window: WebviewWindow) -> BackgroundTone {
    match sample_impl(&window) {
        Some(lum) => BackgroundTone {
            tone: if lum >= TONE_THRESHOLD {
                "light".to_string()
            } else {
                "dark".to_string()
            },
            luminance: Some(lum.round() as u32),
        },
        None => BackgroundTone {
            tone: "light".to_string(),
            luminance: None,
        },
    }
}

fn sample_impl(window: &WebviewWindow) -> Option<f32> {
    use xcap::Monitor;

    let pos = window.outer_position().ok()?; // physical
    let size = window.outer_size().ok()?; // physical
    let (wx, wy, ww, wh) = (pos.x, pos.y, size.width as i32, size.height as i32);

    // Monitor under the widget's centre.
    let cx = wx + ww / 2;
    let cy = wy + wh / 2;
    let mon = Monitor::from_point(cx, cy).ok()?;
    let (mx, my) = (mon.x().ok()?, mon.y().ok()?);
    let (mw, mh) = (mon.width().ok()? as i32, mon.height().ok()? as i32);

    // Widget rect + margin, clamped to the monitor.
    let left = (wx - REGION_MARGIN).max(mx);
    let top = (wy - REGION_MARGIN).max(my);
    let right = (wx + ww + REGION_MARGIN).min(mx + mw);
    let bottom = (wy + wh + REGION_MARGIN).min(my + mh);
    if right <= left || bottom <= top {
        return None;
    }

    let rx = (left - mx) as u32;
    let ry = (top - my) as u32;
    let rw = (right - left) as u32;
    let rh = (bottom - top) as u32;

    // One targeted BitBlt of only rw*rh px (the widget is excluded from capture,
    // so this reads the desktop *behind* it). Cost is independent of screen size.
    let img = mon.capture_region(rx, ry, rw, rh).ok()?;

    // Sparse-grid Rec.709 luma over the region (0..255).
    let (w, h) = (img.width(), img.height());
    let step = 8u32;
    let (mut sum, mut n) = (0.0f32, 0u32);
    let mut y = 0;
    while y < h {
        let mut x = 0;
        while x < w {
            let p = img.get_pixel(x, y).0;
            sum += 0.2126 * p[0] as f32 + 0.7152 * p[1] as f32 + 0.0722 * p[2] as f32;
            n += 1;
            x += step;
        }
        y += step;
    }

    if n == 0 {
        None
    } else {
        Some(sum / n as f32)
    }
}

// Reliable "has the cursor left the widget?" check. The webview can miss a fast
// pointer-exit (leaving the CSS hover state stuck), so the renderer polls this
// against the real OS cursor position while the hover controls are shown.
#[tauri::command]
fn pointer_outside_window(window: WebviewWindow) -> bool {
    match (
        window.outer_position(),
        window.outer_size(),
        window.app_handle().cursor_position(),
    ) {
        (Ok(pos), Ok(size), Ok(cursor)) => {
            let right = pos.x as f64 + size.width as f64;
            let bottom = pos.y as f64 + size.height as f64;
            !(cursor.x >= pos.x as f64
                && cursor.x < right
                && cursor.y >= pos.y as f64
                && cursor.y < bottom)
        }
        _ => false,
    }
}

// Exclude the always-on-top widget from its own capture so it doesn't sample its
// own pixels (Windows 10 2004+; shows the desktop behind it in captures).
#[cfg(windows)]
fn exclude_from_capture(window: &WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE,
    };
    if let Ok(h) = window.hwnd() {
        let hwnd = HWND(h.0 as *mut core::ffi::c_void);
        unsafe {
            let _ = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
        }
    }
}
#[cfg(not(windows))]
fn exclude_from_capture(_window: &WebviewWindow) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // single-instance must be registered before other plugins.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }));
    }

    builder
        .manage(AppState::default())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_autostart::init(
                    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                    None::<Vec<&str>>,
                ))?;
            }
            if let Some(w) = app.get_webview_window("main") {
                exclude_from_capture(&w);
                let _ = w.show();
                let _ = w.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_pip_mode,
            set_opacity,
            notify,
            sample_background,
            pointer_outside_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
