import { setupTelegram, haptic, showBackButton, hideBackButton, initData } from '../lib/telegramClient.ts';
function check(v: unknown, message: string): void { if (!v) throw Error(message); }
const calls: string[] = [];
let active = new Set<() => void>();
const app = {
  initData: 'signed-data',
  themeParams: { bg_color: '#000000', text_color: '#ffffff' },
  ready() { calls.push('ready'); },
  expand() { calls.push('expand'); },
  isVersion(version: string) { calls.push(version); return false; },
  disableVerticalSwipes() { calls.push('disable'); },
  setHeaderColor() { throw new Error('unsupported'); },
  setBackgroundColor() { calls.push('background'); },
  HapticFeedback: { notificationOccurred() { throw new Error('unsupported'); } },
  BackButton: { onClick(fn: () => void) { active.add(fn); }, offClick(fn: () => void) { active.delete(fn); }, show() {}, hide() {} },
};
(globalThis as any).window = { Telegram: { WebApp: app } };
setupTelegram();
check(calls.includes('ready') && calls.includes('expand') && calls.includes('background'), 'инициализация переживает неподдерживаемые вызовы');
check(!calls.includes('disable'), 'свайпы не отключаются в старом клиенте');
check(initData() === 'signed-data', 'initData доступен для заголовка');
haptic('success');
const one = () => {}, two = () => {};
showBackButton(one); showBackButton(two);
check(active.size === 1 && active.has(two), 'старый обработчик кнопки назад снят');
hideBackButton();
check(active.size === 0, 'обработчик кнопки назад снят при выходе');
app.isVersion = () => true;
setupTelegram();
check(calls.includes('disable'), 'свайпы отключаются в поддерживаемом клиенте');
console.log('Telegram SDK: старые версии, исключения и обработчики кнопки проверены на моках');
