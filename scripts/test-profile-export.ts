import { makeProfileExport } from '../lib/profile-export.ts';
function check(v: unknown, label: string): asserts v { if (!v) throw Error(label); }
const secret = 'PRIVATE_INTERNAL_MARKER';
const extra = { debugSecret: secret };
const p = { id: 'p', parentId: 'parent', name: 'Тест', age: 8, band: '8-10', createdAt: 1, ...extra };
const t = { taskId: 'task', skill: 'attention', level: 1, correct: true, ms: 25, ...extra };
const sc = { scenarioId: 's', competency: 'empathy', choice: 0, quality: 'good', ...extra };
const player = { profileId: 'p', xp: 5, coins: 1, stars: 1, streak: 1, bestStreak: 1, lastActiveDay: '', badges: [], inventory: [], equipped: { head: null, body: null, pet: null, room: null, ...extra }, missions: { day: 1, ids: ['warmup'], progress: { warmup: 2, accidentalObject: { secret } }, claimed: [], ...extra }, stats: { days: 0, tasks: 0, correctTasks: 0, scenarios: 0, goodScenarios: 0, bestCombo: 0, perfectDays: 0, minutes: 0, ...extra }, startedAt: 1, ...extra };
const data: any = { profile: p, skills: [{ profileId: 'p', skill: 'attention', level: 1, ability: .5, streak: 0, played: 0, updatedAt: 1, ...extra }, { profileId: 'other', skill: 'attention', ...extra }],
  sessions: [{ id: 's', profileId: 'p', startedAt: 1, seconds: 0, tasks: [t], scenario: sc, plan: ['task'], ...extra,
    storySelection: { cardId: 'day_1_music', ...extra }, runtime: { index: 1, taskAnswers: [t], scenarioAnswer: sc, items: [{ answer: secret }], ...extra }, lastReceipt: { fingerprint: secret } }, { id: 'other-s', profileId: 'other', tasks: [], plan: [] }],
  programStates: [{ profileId: 'p', completedDays: 1, lastDayIndex: 0, startedAt: 1, ...extra }], playerStates: [player],
  subs: [{ profileId: 'p', plan: 'month', status: 'active', startedAt: 1, until: 2, ...extra }], payments: [{ id: secret, providerId: secret, confirmationUrl: secret, profileId: 'p', plan: 'month', amount: '599.00', currency: 'RUB', days: 30, status: 'pending', createdAt: 1, ...extra }] };
const exported = makeProfileExport(data, '2026-01-01T00:00:00.000Z');
const json = JSON.stringify(exported);
check(!json.includes(secret) && !json.includes('debugSecret'), 'внутренние поля исключаются на всех уровнях');
check(!json.includes('other-s') && !json.includes('other'), 'другой профиль исключается');
check(exported.sessions[0].storySelection?.cardId === 'day_1_music', 'выбор истории включён без лишних внутренних полей');
check(exported.sessions[0].inProgress?.step === 1 && exported.sessions[0].inProgress?.tasks[0].taskId === 'task', 'пройденные шаги включены без будущих ответов');
check(exported.player[0].missions?.progress.warmup === 2 && !('accidentalObject' in (exported.player[0].missions?.progress ?? {})), 'прогресс содержит только числовые значения');
check(exported.payments[0].amount === '599.00' && exported.player[0].coins === 1 && exported.profile.id === 'p', 'основные данные присутствуют');
console.log('Экспорт профиля: разрешённые поля, вложенные записи, платёжные секреты и изоляция проверены');
