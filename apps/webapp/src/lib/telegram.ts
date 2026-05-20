/**
 * Thin typed wrapper around the global `window.Telegram.WebApp` injected by
 * https://telegram.org/js/telegram-web-app.js.
 *
 * We keep this small on purpose — only what we use across the app.
 */

interface ThemeParams {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  link_color?: string;
  button_color?: string;
  button_text_color?: string;
  secondary_bg_color?: string;
  destructive_text_color?: string;
}

interface MainButton {
  text: string;
  isVisible: boolean;
  isActive: boolean;
  show: () => void;
  hide: () => void;
  enable: () => void;
  disable: () => void;
  setText: (t: string) => void;
  setParams: (p: Partial<{ text: string; color: string; text_color: string; is_active: boolean; is_visible: boolean }>) => void;
  onClick: (fn: () => void) => void;
  offClick: (fn: () => void) => void;
}

interface BackButton {
  isVisible: boolean;
  show: () => void;
  hide: () => void;
  onClick: (fn: () => void) => void;
  offClick: (fn: () => void) => void;
}

interface HapticFeedback {
  impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
  notificationOccurred: (type: "error" | "success" | "warning") => void;
  selectionChanged: () => void;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name?: string;
      last_name?: string;
      username?: string;
      photo_url?: string;
    };
    start_param?: string;
  };
  colorScheme: "light" | "dark";
  themeParams: ThemeParams;
  viewportHeight: number;
  viewportStableHeight: number;
  isExpanded: boolean;
  platform: string;
  version: string;
  MainButton: MainButton;
  BackButton: BackButton;
  HapticFeedback: HapticFeedback;
  ready: () => void;
  expand: () => void;
  close: () => void;
  showAlert: (msg: string, cb?: () => void) => void;
  showConfirm: (msg: string, cb: (ok: boolean) => void) => void;
  onEvent: (event: string, cb: (...args: unknown[]) => void) => void;
  offEvent: (event: string, cb: (...args: unknown[]) => void) => void;
  setHeaderColor: (color: string) => void;
  setBackgroundColor: (color: string) => void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export function getTg(): TelegramWebApp | null {
  return typeof window !== "undefined" ? window.Telegram?.WebApp ?? null : null;
}

/** Apply Telegram theme params as CSS variables. Re-runs whenever the theme changes. */
export function applyTheme(): void {
  const tg = getTg();
  if (!tg) return;
  const p = tg.themeParams;
  const set = (varName: string, value: string | undefined) => {
    if (value) document.documentElement.style.setProperty(varName, value);
  };
  set("--tg-bg", p.bg_color);
  set("--tg-text", p.text_color);
  set("--tg-hint", p.hint_color);
  set("--tg-link", p.link_color);
  set("--tg-button", p.button_color);
  set("--tg-button-text", p.button_text_color);
  set("--tg-secondary", p.secondary_bg_color);
  set("--tg-destructive", p.destructive_text_color);
}

export function initTelegram(): void {
  const tg = getTg();
  if (!tg) return;
  tg.ready();
  tg.expand();
  applyTheme();
  tg.onEvent("themeChanged", applyTheme);
}

export function haptic(kind: "light" | "medium" | "heavy" | "success" | "error" | "warning" | "selection"): void {
  const tg = getTg();
  if (!tg) return;
  try {
    if (kind === "success" || kind === "error" || kind === "warning") {
      tg.HapticFeedback.notificationOccurred(kind);
    } else if (kind === "selection") {
      tg.HapticFeedback.selectionChanged();
    } else {
      tg.HapticFeedback.impactOccurred(kind);
    }
  } catch {
    // Older Telegram clients may lack HapticFeedback; ignore.
  }
}
