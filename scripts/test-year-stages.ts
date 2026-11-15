/**
 * Этапы года: вход, середина, итог.
 *
 * Зачем тест. Этап — это единственное место, где продукт говорит семье «сейчас
 * середина года». Ошибка здесь не падает: отчёт с этапом «вход» в мае выглядит
 * нормально, просто он врёт. И вторая, более частая ошибка: этап незаметно
 * превращается в прогресс — «2 из 3», «пройдено 33%». Это уже оценка ребёнка,
 * и она противоречит всему остальному продукту.
 *
 * Проверяется:
 *  - первый урок года — вход, последний — итог, середина — середина;
 *  - этапы считаются от числа занятий, а не от номеров 1/18/36;
 *  - у каждого этапа есть вопрос и одно действие;
 *  - в текстах этапов нет процентов, баллов и медицинских слов;
 *  - вопрос этапа не повторяет вопрос другого этапа.
 *
 * Запуск: npm run test-year-stages
 */

import { strict as assert } from 'node:assert';
import { YEAR } from '../lib/content/year/index.ts';
import { STAGE_INFO, stageNote, stageOfLesson, stageOfNumber, type YearStage } from '../lib/year/stages.ts';

const total = YEAR.lessons.length;
assert.equal(total, 36, `в году ${total} занятий, ожидалось 36`);

/* ---- 1. Крайние и средняя точки ---- */

assert.equal(stageOfLesson(YEAR.lessons[0], total), 'opening', 'занятие 1 не вход');
assert.equal(stageOfLesson(YEAR.lessons[total - 1], total), 'closing', 'последнее занятие не итог');
assert.equal(stageOfLesson(YEAR.lessons[Math.ceil(total / 2) - 1], total), 'middle', 'середина года не середина');

// Между крайними точками — всегда середина, а не «второй этап».
for (const lesson of YEAR.lessons.slice(1, -1)) {
  if (lesson.number === Math.ceil(total / 2)) continue;
  assert.equal(stageOfLesson(lesson, total), 'middle', `занятие ${lesson.number}: этап не определён`);
}
console.log('  ok вход, середина и итог на своих занятиях');

/* ---- 2. Этап считается от числа занятий, а не от номеров ---- */

// Если год станет другим, крайние точки остаются крайними.
for (const count of [12, 24, 36, 48]) {
  assert.equal(stageOfNumber(1, count), 'opening', `год из ${count}: первое занятие не вход`);
  assert.equal(stageOfNumber(count, count), 'closing', `год из ${count}: последнее занятие не итог`);
}
// Мусорные номера не дают «этап 4» и не падают.
assert.equal(stageOfNumber(0, 36), 'opening', 'занятие 0 не входит в этапы');
assert.equal(stageOfNumber(99, 36), 'closing', 'занятие за концом года не итог');
assert.equal(stageOfNumber(1, 1), 'opening', 'год из одного занятия сломал этапы');
console.log('  ok этап зависит от длины года, крайние номера не ломают');

/* ---- 3. У этапа есть вопрос, действие и запрет ---- */

const ids: YearStage[] = ['opening', 'middle', 'closing'];
for (const id of ids) {
  const info = STAGE_INFO[id];
  assert.equal(info.id, id, `этап «${id}» отвечает чужим id`);
  assert.ok(info.title.length > 3, `этап «${id}» без названия`);
  assert.ok(info.task.length > 30, `этап «${id}» без действия для педагога`);
  assert.ok(info.avoid.length > 30, `этап «${id}» без запрета`);
  assert.ok(info.question.endsWith('?'), `этап «${id}»: вопрос без вопросительного знака`);
}

// Три этапа — три разных вопроса. Одинаковый вопрос означает, что этап
// существует только в коде.
const questions = ids.map((id) => STAGE_INFO[id].question);
assert.equal(new Set(questions).size, 3, 'вопросы этапов повторяются');
console.log('  ok у каждого этапа своё действие, запрет и вопрос');

/* ---- 4. Этап не стал оценкой ---- */

const text = JSON.stringify(STAGE_INFO) + stageNote('opening') + stageNote('middle') + stageNote('closing');
for (const bad of [/%/, /\bбалл/i, /уровень/i, /терапи/i, /коррекц/i, /диагноз/i, /норма\b/i, /отстаёт/i]) {
  assert.ok(!bad.test(text), `в текстах этапов есть недопустимое: ${bad}`);
}
// «Этап 2 из 3» — это прогресс, а не состояние; такого быть не должно.
assert.ok(!/из трёх этапов|этап \d из/i.test(text), 'этап описан как прогресс');
console.log('  ok в этапах нет процентов, баллов, уровней и медицины');

/* ---- 5. Строка для отчёта ---- */

const note = stageNote('closing');
assert.ok(note.startsWith(STAGE_INFO.closing.title), 'строка этапа не начинается с названия');
assert.ok(note.length < 200, `строка этапа слишком длинная: ${note.length}`);
console.log('  ok строка этапа короткая и начинается с названия');

console.log('\nЭтапы года: вход, середина, итог — без процентов и оценок.');
