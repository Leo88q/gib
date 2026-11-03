'use client';

/** Only interface features used by the app. The bridge data is never proof of identity. */
export type MaxBridge = {
  initData?: string;
  BackButton?: { show: () => void; hide: () => void; onClick: (fn: () => void) => void; offClick: (fn: () => void) => void };
};
export function maxBridge(): MaxBridge | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { WebApp?: MaxBridge }).WebApp ?? null;
}
export function maxLaunchRequested(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location?.hash?.slice(1) ?? '').has('WebAppData');
}
let loading: Promise<void> | null = null;
/** Load only when MAX launch data is present; do not contact MAX on ordinary Telegram launches. */
export function ensureMaxBridge(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  const fragment = new URLSearchParams(window.location?.hash?.slice(1) ?? '');
  if (fragment.has('WebAppData') && (fragment.getAll('WebAppData').length !== 1 || !fragment.get('WebAppData') || fragment.has('tgWebAppData'))) return Promise.reject(Error('invalid_max_launch'));
  if (typeof maxBridge()?.initData === 'string' && maxBridge()!.initData) return Promise.resolve();
  if (!fragment.has('WebAppData')) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://st.max.ru/js/max-web-app.js';
    script.referrerPolicy = 'no-referrer';
    let finished = false;
    const timeout = setTimeout(() => finish(false), 10_000);
    function finish(ok: boolean) {
      if (finished) return; finished = true; clearTimeout(timeout);
      script.onload = null; script.onerror = null;
      if (ok && typeof maxBridge()?.initData === 'string' && maxBridge()!.initData) resolve();
      else { script.remove(); reject(Error('max_bridge_unavailable')); }
    }
    script.onload = () => finish(true); script.onerror = () => finish(false);
    try { document.head.appendChild(script); } catch { finish(false); }
  }).catch(error => { loading = null; throw error; });
  return loading;
}
