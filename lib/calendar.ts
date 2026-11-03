/** Time zones offered at profile creation. Existing profiles use Moscow time. */
export const DEFAULT_TIME_ZONE = 'Europe/Moscow';
export const TIME_ZONES = [
  { id: 'Europe/Kaliningrad', label: 'Калининград (UTC+2)' },
  { id: 'Europe/Moscow', label: 'Москва (UTC+3)' },
  { id: 'Europe/Samara', label: 'Самара (UTC+4)' },
  { id: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)' },
  { id: 'Asia/Omsk', label: 'Омск (UTC+6)' },
  { id: 'Asia/Krasnoyarsk', label: 'Красноярск (UTC+7)' },
  { id: 'Asia/Irkutsk', label: 'Иркутск (UTC+8)' },
  { id: 'Asia/Yakutsk', label: 'Якутск (UTC+9)' },
  { id: 'Asia/Vladivostok', label: 'Владивосток (UTC+10)' },
  { id: 'Asia/Magadan', label: 'Магадан (UTC+11)' },
  { id: 'Asia/Kamchatka', label: 'Камчатка (UTC+12)' },
] as const;
export function isTimeZone(value: unknown): value is string {
  return typeof value === 'string' && TIME_ZONES.some(zone => zone.id === value);
}
export function profileZone(value?: string): string { return isTimeZone(value) ? value : DEFAULT_TIME_ZONE; }
const formats = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let found = formats.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    formats.set(timeZone, found);
  }
  return found;
}
function parts(ts: number, zone: string) {
  const p: Record<string, number> = {};
  for (const part of formatter(profileZone(zone)).formatToParts(new Date(ts))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return p;
}
export function calendarDay(ts: number, zone = DEFAULT_TIME_ZONE): string {
  const p = parts(ts, zone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
/** Shift a civil date independently of the machine's local time zone. */
export function shiftDay(day: string, count: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + count)).toISOString().slice(0, 10);
}
export function weekStartDay(ts: number, zone = DEFAULT_TIME_ZONE): string {
  const day = calendarDay(ts, zone);
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return shiftDay(day, -((dow + 6) % 7));
}
/** Midnight for a selected supported time zone; uses the zone's actual offset at that date. */
export function dayStart(day: string, zone = DEFAULT_TIME_ZONE): number {
  const [year, month, date] = day.split('-').map(Number);
  const target = Date.UTC(year, month - 1, date);
  let instant = target;
  for (let i = 0; i < 4; i++) {
    const p = parts(instant, zone);
    const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const next = instant + (target - represented);
    if (next === instant) break;
    instant = next;
  }
  return instant;
}
