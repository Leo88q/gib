'use client';

import { ensureMaxBridge, maxBridge, maxLaunchRequested } from './max-client.ts';

/**
 * Клиентская обвязка Telegram Mini App: инициализация, тема, кнопка «Назад»,
 * отключение вертикальных свайпов (иначе игра листается при игре).
 */

type TG = {
  ready?: () => void;
  expand?: () => void;
  initData?: string;
  initDataUnsafe?: { user?: { id: number } };
  themeParams?: Record<string, string>;
  colorScheme?: 'light' | 'dark';
  BackButton?: { show: () => void; hide: () => void; onClick: (cb: () => void) => void; offClick: (cb: () => void) => void };
  HapticFeedback?: {
    notificationOccurred?: (type: 'error' | 'success' | 'warning') => void;
    impactOccurred?: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    selectionChanged?: () => void;
  };
  disableVerticalSwipes?: () => void;
  enableClosingConfirmation?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  isVersion?: (v: string) => boolean;
};

export function tg(): TG | null {
  if (typeof window === 'undefined') return null;
  return ((window as unknown as { Telegram?: { WebApp?: TG } }).Telegram?.WebApp ?? null) as TG | null;
}

export function initData(): string {
  return tg()?.initData ?? '';
}

/** Подготовка приложения внутри Telegram. */
export function setupTelegram(): void {
  const app = tg();
  if (!app || maxLaunchRequested() || maxBridge()?.initData) return;
  safely(() => app.ready?.());
  safely(() => app.expand?.());
  safely(() => { if (app.isVersion?.('7.7')) app.disableVerticalSwipes?.(); });
  safely(() => app.setHeaderColor?.('#fff6e5'));
  safely(() => app.setBackgroundColor?.('#fff6e5'));
  // The illustrated palette has light fixed surfaces: applying a dark Telegram
  // text color alone would make text and outlines invisible on those surfaces.
}

/** Optional Telegram SDK features can exist but throw on older clients. */
function safely(fn: () => void): void { try { fn(); } catch { /* unsupported SDK method */ } }

export function haptic(type: 'error' | 'success' | 'warning' | 'light' | 'medium' | 'heavy') {
  if (maxBridge()?.initData || maxLaunchRequested()) return;
  const h = tg()?.HapticFeedback;
  if (!h) return;
  if (type === 'error' || type === 'success' || type === 'warning') {
    safely(() => h.notificationOccurred?.(type));
  } else {
    safely(() => h.impactOccurred?.(type));
  }
}

let backHandler: (() => void) | null = null;
let backButton: TG['BackButton'] | null = null;
function activeBackButton(): TG['BackButton'] | null {
  const telegramData = initData(); const maxData = maxBridge()?.initData;
  if (telegramData && maxData) return null;
  if (maxData || maxLaunchRequested()) return maxBridge()?.BackButton ?? null;
  return tg()?.BackButton ?? null;
}

export function showBackButton(handler: () => void): void {
  const button = activeBackButton();
  if (backHandler && backButton) safely(() => backButton!.offClick(backHandler!));
  backHandler = null; backButton = null;
  if (!button) return;
  backHandler = handler; backButton = button;
  safely(() => button.onClick(handler));
  safely(() => button.show());
}

export function hideBackButton(): void {
  if (backHandler && backButton) safely(() => backButton!.offClick(backHandler!));
  if (backButton) safely(() => backButton!.hide());
  backHandler = null; backButton = null;
}

let telegramLoading: Promise<void> | null = null;
/** Load Telegram's SDK only for its launch, never as a side effect of a MAX launch. */
export function ensureTelegramBridge(): Promise<void> {
  if (typeof window === 'undefined' || maxLaunchRequested() || maxBridge()?.initData) return Promise.resolve();
  const fragment = new URLSearchParams(window.location?.hash?.slice(1) ?? '');
  const data = fragment.getAll('tgWebAppData');
  if (data.length > 1 || (data.length === 1 && !data[0])) return Promise.reject(Error('invalid_telegram_launch'));
  if (initData()) return Promise.resolve();
  let savedLaunch = false;
  try { savedLaunch = Boolean(window.sessionStorage?.getItem('__telegram__initParams')); } catch { /* storage is optional */ }
  if (!data.length && !savedLaunch) return Promise.resolve();
  if (telegramLoading) return telegramLoading;
  telegramLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-web-app.js';
    script.referrerPolicy = 'no-referrer';
    let finished = false;
    const timer = setTimeout(() => finish(false), 10_000);
    function finish(ok: boolean) {
      if (finished) return;
      finished = true; clearTimeout(timer); script.onload = null; script.onerror = null;
      if (ok && initData()) { setupTelegram(); resolve(); }
      else { script.remove(); reject(Error('telegram_bridge_unavailable')); }
    }
    script.onload = () => finish(true); script.onerror = () => finish(false);
    try { document.head.appendChild(script); } catch { finish(false); }
  }).catch(error => { telegramLoading = null; throw error; });
  return telegramLoading;
}

/** Signed launch data is sent only to same-origin API routes, never in a URL. */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  if (typeof input !== 'string' || !input.startsWith('/api/')) throw Error('invalid_api_url');
  const target = new URL(input, 'https://gib.invalid');
  if (target.origin !== 'https://gib.invalid' || !target.pathname.startsWith('/api/')) throw Error('invalid_api_url');
  await ensureMaxBridge();
  await ensureTelegramBridge();
  const telegramData = initData();
  const maxData = maxBridge()?.initData ?? '';
  if (typeof telegramData !== 'string' || typeof maxData !== 'string' || (telegramData && maxData)) throw Error('ambiguous_platform');
  if (maxLaunchRequested() && !maxData) throw Error('max_bridge_unavailable');
  const headers = new Headers(init?.headers);
  headers.delete('x-telegram-init-data'); headers.delete('x-max-init-data');
  if (telegramData) headers.set('x-telegram-init-data', telegramData);
  else if (maxData) headers.set('x-max-init-data', maxData);
  return fetch(input, { ...init, headers, redirect: 'error' });
}
