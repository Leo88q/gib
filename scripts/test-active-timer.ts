import { ActiveTimer } from '../lib/active-timer.ts';
function check(v: unknown, message: string): asserts v { if (!v) throw Error(message); }
const t = new ActiveTimer();
t.reset(100, true);
check(t.elapsed(600) === 500, 'visible time');
t.setVisible(false, 600);
check(t.elapsed(100000) === 500, 'background time excluded');
t.setVisible(false, 101000);
t.setVisible(true, 200000);
t.setVisible(true, 200010);
check(t.elapsed(200500) === 1000, 'multiple visibility events do not reset the timer');
t.reset(300000, false);
check(t.elapsed(400000) === 0, 'reset while hidden');
t.setVisible(true, 500000);
check(t.elapsed(500125) === 125, 'timer starts on return');
console.log('Таймер активного времени: пауза, возврат и повторные события проверены');
