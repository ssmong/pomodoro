import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Maximize2,
  Minus,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  Settings,
  X
} from "lucide-react";
import { playSound, primeAudio } from "./sound.js";

const STORAGE_KEY = "minimal-pomodoro-settings-v1";
const STATS_STORAGE_KEY = "minimal-pomodoro-stats-v1";
const INSTALL_STORAGE_KEY = "minimal-pomodoro-install-v1";

const DEFAULT_SETTINGS = {
  focusMinutes: 25,
  breakMinutes: 5,
  pipOpacity: 0.92,
  pipTextTone: "auto",
  theme: "minimal",
  notifyEnabled: true,
  soundType: "chime",
  soundVolume: 0.6,
  startInPip: true,
  showInTaskbar: false,
  launchAtStartup: false
};

const MODE_LABELS = {
  focus: "집중",
  break: "휴식"
};

function readSettings() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));

    return {
      focusMinutes: clampNumber(saved?.focusMinutes, 1, 180, DEFAULT_SETTINGS.focusMinutes),
      breakMinutes: clampNumber(saved?.breakMinutes, 1, 90, DEFAULT_SETTINGS.breakMinutes),
      pipOpacity: clampNumber(saved?.pipOpacity, 0.35, 1, DEFAULT_SETTINGS.pipOpacity),
      pipTextTone: normalizePipTextTone(saved?.pipTextTone),
      theme: normalizeTheme(saved?.theme),
      notifyEnabled:
        typeof saved?.notifyEnabled === "boolean"
          ? saved.notifyEnabled
          : DEFAULT_SETTINGS.notifyEnabled,
      soundType: normalizeSoundType(saved?.soundType),
      soundVolume: clampNumber(saved?.soundVolume, 0, 1, DEFAULT_SETTINGS.soundVolume),
      startInPip:
        typeof saved?.startInPip === "boolean" ? saved.startInPip : DEFAULT_SETTINGS.startInPip,
      showInTaskbar:
        typeof saved?.showInTaskbar === "boolean"
          ? saved.showInTaskbar
          : DEFAULT_SETTINGS.showInTaskbar,
      launchAtStartup:
        typeof saved?.launchAtStartup === "boolean"
          ? saved.launchAtStartup
          : DEFAULT_SETTINGS.launchAtStartup
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function normalizeTheme(value) {
  return ["minimal", "figma", "apple"].includes(value) ? value : DEFAULT_SETTINGS.theme;
}

function normalizePipTextTone(value) {
  return ["auto", "dark", "light"].includes(value) ? value : DEFAULT_SETTINGS.pipTextTone;
}

function normalizeSoundType(value) {
  return ["none", "chime", "bell", "digital"].includes(value) ? value : DEFAULT_SETTINGS.soundType;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);

  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function getDuration(mode, settings) {
  return (mode === "focus" ? settings.focusMinutes : settings.breakMinutes) * 60;
}

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function normalizeStats(value) {
  const source = value?.days && typeof value.days === "object" ? value.days : value;

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return { days: {} };
  }

  const days = {};

  Object.entries(source).forEach(([date, record]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return;
    }

    const completed =
      typeof record === "number" ? record : Number(record?.completed || record?.count || 0);
    const focusSeconds = typeof record === "number" ? 0 : Number(record?.focusSeconds || 0);
    const lastCompletedAt =
      typeof record === "object" && typeof record?.lastCompletedAt === "string"
        ? record.lastCompletedAt
        : null;
    const safeCompleted = Math.max(0, Math.floor(completed));
    const safeFocusSeconds = Math.max(0, Math.floor(focusSeconds));

    if (safeCompleted > 0 || safeFocusSeconds > 0) {
      days[date] = {
        completed: safeCompleted,
        focusSeconds: safeFocusSeconds,
        lastCompletedAt
      };
    }
  });

  return { days };
}

function readStats() {
  try {
    return normalizeStats(JSON.parse(window.localStorage.getItem(STATS_STORAGE_KEY)));
  } catch {
    return { days: {} };
  }
}

function readInstallDate() {
  try {
    const saved = window.localStorage.getItem(INSTALL_STORAGE_KEY);

    if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) {
      return saved;
    }
  } catch {
    // fall through and initialize below
  }

  // First run for this key: anchor to the earliest recorded stat day if the
  // user already has history, otherwise to today.
  const recordedDates = Object.keys(readStats().days || {}).sort();
  const initial = recordedDates[0] || getLocalDateKey();

  try {
    window.localStorage.setItem(INSTALL_STORAGE_KEY, initial);
  } catch {
    // ignore write failures
  }

  return initial;
}

function getDaysSinceInstall(installDate, today) {
  const [year, month, day] = installDate.split("-").map(Number);
  const start = new Date(year, month - 1, day);
  const now = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const elapsed = Math.round((now - start) / 86400000);

  // Inclusive of the install day, so day 1 divides by 1 (not 7).
  return Math.max(1, elapsed + 1);
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function getStatsSummary(stats, installDate) {
  const days = stats.days || {};
  const today = new Date();
  const todayKey = getLocalDateKey(today);
  const last7Keys = Array.from({ length: 7 }, (_, index) => getLocalDateKey(addDays(today, -index)));
  const dayRecords = Object.values(days);
  const total = dayRecords.reduce((sum, day) => sum + day.completed, 0);
  const focusSeconds = dayRecords.reduce((sum, day) => sum + day.focusSeconds, 0);
  const last7 = last7Keys.reduce((sum, key) => sum + (days[key]?.completed || 0), 0);
  // Average over the last 7 days, but divide only by the days the app has
  // existed (capped at 7) so a day-1 user isn't averaged against empty days.
  const averageWindow = Math.min(7, getDaysSinceInstall(installDate, today));

  return {
    today: days[todayKey]?.completed || 0,
    last7,
    dailyAverage: last7 / averageWindow,
    streak: getStreak(days, today),
    total,
    focusSeconds
  };
}

function getStreak(days, today) {
  let date = today;
  let streak = 0;

  if (!days[getLocalDateKey(date)]?.completed) {
    date = addDays(date, -1);
  }

  while (days[getLocalDateKey(date)]?.completed > 0) {
    streak += 1;
    date = addDays(date, -1);
  }

  return streak;
}

function formatStatDate(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day);

  return date.toLocaleDateString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  });
}

function formatMinutes(totalSeconds) {
  const minutes = Math.round(totalSeconds / 60);

  if (minutes <= 0) {
    return "시간 미기록";
  }

  return `${minutes}분`;
}

function formatAverage(value) {
  if (!value || value <= 0) {
    return "0회";
  }

  return `${Math.round(value * 10) / 10}회`;
}

export default function App() {
  const [settings, setSettings] = useState(() => readSettings());
  const [mode, setMode] = useState("focus");
  const [remainingSeconds, setRemainingSeconds] = useState(DEFAULT_SETTINGS.focusMinutes * 60);
  const [isRunning, setIsRunning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [detectedBackgroundTone, setDetectedBackgroundTone] = useState("light");
  const [stats, setStats] = useState(() => readStats());
  const [installDate] = useState(() => readInstallDate());
  const endAtRef = useRef(null);
  const modeRef = useRef(mode);
  const settingsRef = useRef(settings);
  const startPipHandledRef = useRef(false);

  const durationSeconds = getDuration(mode, settings);
  const elapsedProgress = durationSeconds > 0 ? 1 - remainingSeconds / durationSeconds : 0;
  const isPaused = !isRunning && remainingSeconds < durationSeconds;
  const radius = 112;
  const circumference = 2 * Math.PI * radius;
  const strokeOffset = circumference * (1 - Math.max(0, Math.min(1, elapsedProgress)));
  const primaryControlLabel = isRunning ? "정지" : isPaused ? "계속" : "시작";
  const statusLabel = isRunning ? "진행 중" : isPaused ? "일시정지" : "대기";
  const canUseDesktopWindow = useMemo(() => Boolean(window.desktopWindow), []);
  const statsSummary = useMemo(() => getStatsSummary(stats, installDate), [stats, installDate]);
  const statRows = useMemo(
    () =>
      Object.entries(stats.days || {})
        .sort(([left], [right]) => right.localeCompare(left))
        .slice(0, 14),
    [stats]
  );
  const pipTextTone =
    settings.pipTextTone === "auto"
      ? detectedBackgroundTone === "dark"
        ? "light"
        : "dark"
      : settings.pipTextTone;

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    settingsRef.current = settings;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    window.localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(stats));
  }, [stats]);

  useEffect(() => {
    if (!isRunning) {
      setRemainingSeconds(getDuration(mode, settings));
    }
  }, [mode, settings.focusMinutes, settings.breakMinutes]);

  useEffect(() => {
    document.body.dataset.pip = String(isPip);
  }, [isPip]);

  useEffect(() => {
    // Hide/show the OS taskbar button (default: hidden floating widget).
    window.desktopWindow?.setSkipTaskbar?.(!settings.showInTaskbar);
  }, [settings.showInTaskbar]);

  useEffect(() => {
    // Register/unregister the app in the OS login items.
    window.desktopWindow?.setLaunchAtStartup?.(settings.launchAtStartup);
  }, [settings.launchAtStartup]);

  useEffect(() => {
    // Launch straight into PIP mode when enabled (runs once). The ref guard
    // keeps React StrictMode's double-invoke from re-entering PIP.
    if (startPipHandledRef.current) {
      return;
    }
    startPipHandledRef.current = true;

    if (settings.startInPip) {
      void setPipMode(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isPip) {
      window.desktopWindow?.setOpacity(settings.pipOpacity);
    }
  }, [isPip, settings.pipOpacity]);

  useEffect(() => {
    if (!isPip || settings.pipTextTone !== "auto" || !window.desktopWindow?.sampleBackground) {
      return undefined;
    }

    let canceled = false;

    async function sample() {
      const result = await window.desktopWindow.sampleBackground();

      if (!canceled && result?.tone) {
        setDetectedBackgroundTone(result.tone);
      }
    }

    const timeout = window.setTimeout(sample, 150);
    const interval = window.setInterval(sample, 220);

    return () => {
      canceled = true;
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [isPip, settings.pipTextTone]);

  useEffect(() => {
    // Fallback for a missed pointer-leave on the small PIP window: while the
    // hover controls are shown, poll the real cursor position and hide once it
    // has actually left the widget (the webview sometimes drops the exit event).
    if (!isPip || !hovering || !window.desktopWindow?.pointerOutsideWindow) {
      return undefined;
    }

    const id = window.setInterval(async () => {
      const outside = await window.desktopWindow.pointerOutsideWindow();
      if (outside) {
        setHovering(false);
      }
    }, 250);

    return () => window.clearInterval(id);
  }, [isPip, hovering]);

  useEffect(() => {
    if (!isRunning) {
      return undefined;
    }

    if (!endAtRef.current) {
      endAtRef.current = Date.now() + remainingSeconds * 1000;
    }

    const tick = window.setInterval(() => {
      const nextRemaining = Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000));
      setRemainingSeconds(nextRemaining);

      if (nextRemaining <= 0) {
        completeTimer();
      }
    }, 200);

    return () => window.clearInterval(tick);
  }, [isRunning]);

  function completeTimer() {
    const currentMode = modeRef.current;
    const nextMode = currentMode === "focus" ? "break" : "focus";
    const nextSeconds = getDuration(nextMode, settingsRef.current);

    if (currentMode === "focus") {
      recordCompletedFocusSession();
    }

    alertSessionEnd(currentMode);

    modeRef.current = nextMode;
    setMode(nextMode);
    setRemainingSeconds(nextSeconds);

    if (currentMode === "focus") {
      // 집중이 끝나면 휴식은 자동으로 이어서 시작한다.
      endAtRef.current = Date.now() + nextSeconds * 1000;
    } else {
      // 휴식이 끝나면 멈추고, 사용자가 직접 "시작"을 눌러야 다음 집중이 시작된다.
      endAtRef.current = null;
      setIsRunning(false);
    }
  }

  function alertSessionEnd(finishedMode) {
    const current = settingsRef.current;

    playSound(current.soundType, current.soundVolume);

    if (current.notifyEnabled) {
      const message =
        finishedMode === "focus"
          ? { title: "집중 완료", body: "휴식 시간이 시작됐어요." }
          : { title: "휴식 완료", body: "준비되면 시작을 눌러 다시 집중하세요." };

      window.desktopWindow?.notify?.(message);
    }
  }

  function recordCompletedFocusSession() {
    const completedAt = new Date();
    const today = getLocalDateKey(completedAt);
    const focusSeconds = getDuration("focus", settingsRef.current);

    setStats((current) => {
      const normalized = normalizeStats(current);
      const currentDay = normalized.days[today] || {
        completed: 0,
        focusSeconds: 0,
        lastCompletedAt: null
      };

      return {
        days: {
          ...normalized.days,
          [today]: {
            completed: currentDay.completed + 1,
            focusSeconds: currentDay.focusSeconds + focusSeconds,
            lastCompletedAt: completedAt.toISOString()
          }
        }
      };
    });
  }

  function startTimer() {
    primeAudio();
    const seconds = remainingSeconds > 0 ? remainingSeconds : getDuration(mode, settings);
    setRemainingSeconds(seconds);
    endAtRef.current = Date.now() + seconds * 1000;
    setIsRunning(true);
    void setPipMode(true);
  }

  function pauseTimer() {
    if (endAtRef.current) {
      setRemainingSeconds(Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000)));
    }

    endAtRef.current = null;
    setIsRunning(false);
  }

  function toggleTimer() {
    if (isRunning) {
      pauseTimer();
    } else {
      startTimer();
    }
  }

  function resetTimer() {
    endAtRef.current = null;
    setIsRunning(false);
    setRemainingSeconds(getDuration(mode, settings));
  }

  function setTimerMode(nextMode) {
    endAtRef.current = null;
    setIsRunning(false);
    setMode(nextMode);
    setRemainingSeconds(getDuration(nextMode, settings));
  }

  async function setPipMode(nextPip) {
    const accepted = canUseDesktopWindow
      ? await window.desktopWindow.setPipMode(nextPip, settings.pipOpacity)
      : nextPip;

    setIsPip(Boolean(accepted));

    if (accepted) {
      setShowSettings(false);
      setShowStats(false);
    }

    return Boolean(accepted);
  }

  async function togglePipMode() {
    await setPipMode(!isPip);
  }

  function updateSetting(key, value) {
    setSettings((current) => {
      if (key === "theme") {
        return {
          ...current,
          theme: normalizeTheme(value)
        };
      }

      if (key === "pipTextTone") {
        return {
          ...current,
          pipTextTone: normalizePipTextTone(value)
        };
      }

      if (key === "soundType") {
        return {
          ...current,
          soundType: normalizeSoundType(value)
        };
      }

      if (key === "notifyEnabled") {
        return {
          ...current,
          notifyEnabled: Boolean(value)
        };
      }

      if (key === "startInPip") {
        return {
          ...current,
          startInPip: Boolean(value)
        };
      }

      if (key === "showInTaskbar") {
        return {
          ...current,
          showInTaskbar: Boolean(value)
        };
      }

      if (key === "launchAtStartup") {
        return {
          ...current,
          launchAtStartup: Boolean(value)
        };
      }

      const limits = {
        focusMinutes: [1, 180, DEFAULT_SETTINGS.focusMinutes],
        breakMinutes: [1, 90, DEFAULT_SETTINGS.breakMinutes],
        pipOpacity: [0.35, 1, DEFAULT_SETTINGS.pipOpacity],
        soundVolume: [0, 1, DEFAULT_SETTINGS.soundVolume]
      }[key];

      return {
        ...current,
        [key]: clampNumber(value, ...limits)
      };
    });
  }

  function clearStats() {
    setStats({ days: {} });
  }

  return (
    <div
      className={`app-shell theme-${settings.theme} ${
        isPip ? `is-pip pip-contrast-${pipTextTone}` : ""
      }`}
      data-hover={hovering ? "true" : "false"}
      onPointerEnter={() => setHovering(true)}
      onPointerMove={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
    >
      {!isPip && (
        <header className="chrome">
          <div className="chrome-title">
            <span className="brand-mark" />
            <span>Pomodoro</span>
          </div>
          <div className="chrome-actions">
            <button
              className={`icon-button ${showSettings ? "is-active" : ""}`}
              type="button"
              title="설정"
              onClick={() => {
                setShowStats(false);
                setShowSettings((value) => !value);
              }}
            >
              <Settings size={16} />
            </button>
            <button
              className={`icon-button ${showStats ? "is-active" : ""}`}
              type="button"
              title="통계"
              onClick={() => {
                setShowSettings(false);
                setShowStats((value) => !value);
              }}
            >
              <BarChart3 size={16} />
            </button>
            <button className="icon-button" type="button" title="PIP" onClick={togglePipMode}>
              <PictureInPicture2 size={16} />
            </button>
            <button
              className="icon-button"
              type="button"
              title="최소화"
              onClick={() => window.desktopWindow?.minimize()}
            >
              <Minus size={16} />
            </button>
            <button
              className="icon-button"
              type="button"
              title="닫기"
              onClick={() => window.desktopWindow?.close()}
            >
              <X size={16} />
            </button>
          </div>
        </header>
      )}

      <main className={`content ${showSettings || showStats ? "settings-open" : ""}`}>
        <section className="timer-panel" aria-label="Pomodoro timer">
          {!isPip && (
            <div className="mode-strip">
              <span className="mode-name">{MODE_LABELS[mode]}</span>
              <span className="state-text">{statusLabel}</span>
            </div>
          )}

          <div className="timer-visual" aria-live="polite">
            <svg className="progress-ring" viewBox="0 0 260 260" aria-hidden="true">
              <circle className="progress-track" cx="130" cy="130" r={radius} />
              <circle
                className="progress-value"
                cx="130"
                cy="130"
                r={radius}
                style={{
                  strokeDasharray: circumference,
                  strokeDashoffset: strokeOffset
                }}
              />
            </svg>
            <div className="time-readout">
              <strong>{formatTime(remainingSeconds)}</strong>
            </div>

            <div
              className={`controls ${
                isRunning ? "is-running" : isPaused ? "is-paused" : "is-idle"
              }`}
            >
              <button
                className="button primary"
                type="button"
                title={primaryControlLabel}
                onClick={(event) => {
                  toggleTimer();
                  // Drop focus so :focus-within stops pinning the controls open;
                  // they then fade out on their own once the pointer leaves.
                  event.currentTarget.blur();
                }}
              >
                {isRunning ? <Pause size={18} /> : <Play size={18} />}
                <span>{primaryControlLabel}</span>
              </button>
              {isPaused && (
                <button
                  className="button secondary"
                  type="button"
                  title="초기화"
                  onClick={(event) => {
                    resetTimer();
                    event.currentTarget.blur();
                  }}
                >
                  <RotateCcw size={18} />
                  <span>초기화</span>
                </button>
              )}
            </div>
          </div>

          {isPip && (
            <div className="pip-overlay">
              <label className="pip-opacity" title="불투명도">
                <input
                  type="range"
                  min="0.35"
                  max="1"
                  step="0.05"
                  value={settings.pipOpacity}
                  onChange={(event) => updateSetting("pipOpacity", event.target.value)}
                  onMouseUp={(event) => event.currentTarget.blur()}
                  onTouchEnd={(event) => event.currentTarget.blur()}
                  aria-label="PIP 불투명도"
                />
              </label>
              <div className="pip-actions">
                <button
                  className="icon-button pip-exit"
                  type="button"
                  title="일반 창으로"
                  onClick={togglePipMode}
                >
                  <Maximize2 size={16} />
                </button>
                <button
                  className="icon-button pip-close"
                  type="button"
                  title="닫기"
                  onClick={() => window.desktopWindow?.close()}
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          )}
        </section>

        {!isPip && showSettings && (
          <aside className="settings-panel" aria-label="설정">
            <div className="settings-heading">
              <h2>설정</h2>
            </div>

            <label className="setting-row">
              <span>현재 타이머</span>
              <span className="segment-control">
                <button
                  className={mode === "focus" ? "selected" : ""}
                  type="button"
                  onClick={() => setTimerMode("focus")}
                >
                  집중
                </button>
                <button
                  className={mode === "break" ? "selected" : ""}
                  type="button"
                  onClick={() => setTimerMode("break")}
                >
                  휴식
                </button>
              </span>
            </label>

            <label className="setting-row">
              <span>테마</span>
              <span className="segment-control">
                {[
                  ["minimal", "기본"],
                  ["figma", "Figma"],
                  ["apple", "Apple"]
                ].map(([value, label]) => (
                  <button
                    className={settings.theme === value ? "selected" : ""}
                    key={value}
                    type="button"
                    onClick={() => updateSetting("theme", value)}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </label>

            <div className="setting-grid">
              <label>
                <span>집중 시간</span>
                <span className="number-field">
                  <input
                    type="number"
                    min="1"
                    max="180"
                    value={settings.focusMinutes}
                    onChange={(event) => updateSetting("focusMinutes", event.target.value)}
                  />
                  <span>분</span>
                </span>
              </label>

              <label>
                <span>휴식 시간</span>
                <span className="number-field">
                  <input
                    type="number"
                    min="1"
                    max="90"
                    value={settings.breakMinutes}
                    onChange={(event) => updateSetting("breakMinutes", event.target.value)}
                  />
                  <span>분</span>
                </span>
              </label>
            </div>

            <label className="setting-row">
              <span>완료 알림</span>
              <span className="segment-control">
                {[
                  [false, "끄기"],
                  [true, "켜기"]
                ].map(([value, label]) => (
                  <button
                    className={settings.notifyEnabled === value ? "selected" : ""}
                    key={String(value)}
                    type="button"
                    onClick={() => updateSetting("notifyEnabled", value)}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </label>

            <label className="setting-row">
              <span>완료 소리</span>
              <span className="segment-control">
                {[
                  ["none", "없음"],
                  ["chime", "차임"],
                  ["bell", "벨"],
                  ["digital", "디지털"]
                ].map(([value, label]) => (
                  <button
                    className={settings.soundType === value ? "selected" : ""}
                    key={value}
                    type="button"
                    onClick={() => {
                      updateSetting("soundType", value);
                      playSound(value, settings.soundVolume);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </label>

            {settings.soundType !== "none" && (
              <label className="setting-row">
                <span>소리 크기</span>
                <span className="range-field">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.soundVolume}
                    onChange={(event) => updateSetting("soundVolume", event.target.value)}
                    onMouseUp={(event) => playSound(settings.soundType, Number(event.target.value))}
                    onTouchEnd={(event) => playSound(settings.soundType, Number(event.target.value))}
                  />
                  <span>{Math.round(settings.soundVolume * 100)}%</span>
                </span>
              </label>
            )}

            <label className="setting-row">
              <span>PIP로 시작</span>
              <span className="segment-control">
                {[
                  [false, "끄기"],
                  [true, "켜기"]
                ].map(([value, label]) => (
                  <button
                    className={settings.startInPip === value ? "selected" : ""}
                    key={String(value)}
                    type="button"
                    onClick={() => updateSetting("startInPip", value)}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </label>

            <label className="setting-row">
              <span>작업 표시줄 표시</span>
              <span className="segment-control">
                {[
                  [false, "끄기"],
                  [true, "켜기"]
                ].map(([value, label]) => (
                  <button
                    className={settings.showInTaskbar === value ? "selected" : ""}
                    key={String(value)}
                    type="button"
                    onClick={() => updateSetting("showInTaskbar", value)}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </label>

            <label className="setting-row">
              <span>시작할 때 실행</span>
              <span className="segment-control">
                {[
                  [false, "끄기"],
                  [true, "켜기"]
                ].map(([value, label]) => (
                  <button
                    className={settings.launchAtStartup === value ? "selected" : ""}
                    key={String(value)}
                    type="button"
                    onClick={() => updateSetting("launchAtStartup", value)}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </label>

            <label className="setting-row">
              <span>PIP 불투명도</span>
              <span className="range-field">
                <input
                  type="range"
                  min="0.35"
                  max="1"
                  step="0.05"
                  value={settings.pipOpacity}
                  onChange={(event) => updateSetting("pipOpacity", event.target.value)}
                />
                <span>{Math.round(settings.pipOpacity * 100)}%</span>
              </span>
            </label>

            <label className="setting-row">
              <span>PIP 글자색</span>
              <span className="segment-control">
                {[
                  ["auto", "자동"],
                  ["dark", "어둡게"],
                  ["light", "밝게"]
                ].map(([value, label]) => (
                  <button
                    className={settings.pipTextTone === value ? "selected" : ""}
                    key={value}
                    type="button"
                    onClick={() => updateSetting("pipTextTone", value)}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </label>
          </aside>
        )}

        {!isPip && showStats && (
          <aside className="stats-panel" aria-label="통계">
            <div className="settings-heading">
              <h2>통계</h2>
              <span className="stats-total">{statsSummary.total}회 완료</span>
            </div>

            <div className="stats-summary">
              <div className="stats-metric">
                <span>오늘</span>
                <strong>{statsSummary.today}회</strong>
              </div>
              <div className="stats-metric">
                <span>일 평균</span>
                <strong>{formatAverage(statsSummary.dailyAverage)}</strong>
              </div>
              <div className="stats-metric">
                <span>연속</span>
                <strong>{statsSummary.streak}일</strong>
              </div>
              <div className="stats-metric">
                <span>누적 집중</span>
                <strong>{formatMinutes(statsSummary.focusSeconds)}</strong>
              </div>
            </div>

            {statRows.length > 0 ? (
              <div className="stats-list">
                {statRows.map(([date, day]) => (
                  <div className="stats-row" key={date}>
                    <span className="stats-row-main">
                      <span>{formatStatDate(date)}</span>
                      <small>{formatMinutes(day.focusSeconds)}</small>
                    </span>
                    <strong>{day.completed}회</strong>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">아직 완료된 집중 세션이 없습니다.</div>
            )}

            {statRows.length > 0 && (
              <button className="button secondary stats-clear" type="button" onClick={clearStats}>
                <RotateCcw size={16} />
                <span>통계 초기화</span>
              </button>
            )}
          </aside>
        )}
      </main>
    </div>
  );
}
