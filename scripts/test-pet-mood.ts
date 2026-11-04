import assert from 'node:assert/strict';
import { petMood, petMoodText, petStage, MISSING_AFTER_DAYS, type PetMood } from '../lib/pet-mood';

const moods: PetMood[] = ['happy', 'sleepy', 'curious', 'missing'];

// 1. Первый заход: питомец любопытный, ничего не требует.
{
  assert.equal(petMood({ completedDays: 0, daysSinceLast: null }), 'curious');
  assert.equal(petMood({ completedDays: 0, daysSinceLast: 0 }), 'curious', 'пустая программа не даёт «радости»');
}

// 2. Занимался сегодня — радость.
{
  assert.equal(petMood({ completedDays: 5, daysSinceLast: 0 }), 'happy');
  assert.equal(petMood({ completedDays: 1, daysSinceLast: 0 }), 'happy');
}

// 3. Небольшой перерыв — не грусть, а сон.
{
  for (const d of [1, 2, MISSING_AFTER_DAYS - 1]) {
    assert.equal(petMood({ completedDays: 4, daysSinceLast: d }), 'sleepy', `${d} дн. — ещё не «соскучился»`);
  }
}

// 4. Долгий перерыв — «соскучился», но прогресс не страдает.
{
  assert.equal(petMood({ completedDays: 9, daysSinceLast: MISSING_AFTER_DAYS }), 'missing');
  assert.equal(petMood({ completedDays: 60, daysSinceLast: 90 }), 'missing', 'даже длинная пауза не «убивает» питомца');
}

// 5. Настроение не зависит от успехов: только от факта игры.
{
  const low = petMood({ completedDays: 1, daysSinceLast: 0 });
  const high = petMood({ completedDays: 60, daysSinceLast: 0 });
  assert.equal(low, high, 'мало пройдено и много пройдено — одинаковая радость');
}

// 6. Тексты без вины, оценок и обещаний награды.
{
  for (const mood of moods) {
    const text = petMoodText(mood);
    assert.ok(text.length > 0 && text.length < 90, `${mood}: короткий текст`);
    assert.ok(!/должен|надо|обязан|плохо|молодец|лучше/i.test(text), `${mood}: нет давления и оценок: ${text}`);
    assert.ok(!/награда|приз|бонус|монет/i.test(text), `${mood}: нет обещаний награды`);
  }
  assert.ok(petMoodText('missing').includes('когда захочется'), 'возвращение добровольное');
}

// 7. Стадии роста: те же пороги, что были в SVG, но проверяемые отдельно.
{
  assert.equal(petStage(1), 0);
  assert.equal(petStage(2), 0);
  assert.equal(petStage(3), 1);
  assert.equal(petStage(5), 1);
  assert.equal(petStage(6), 2);
  assert.equal(petStage(99), 2);
  assert.equal(petStage(Number.NaN), 0, 'испорченный уровень не растит питомца');
  assert.equal(petStage(-3), 0);
}

// 8. Мусорные дни не ломают состояние.
{
  assert.equal(petMood({ completedDays: 3, daysSinceLast: -1 }), 'sleepy');
  assert.equal(petMood({ completedDays: 3, daysSinceLast: Number.NaN }), 'sleepy', 'NaN не считается «сегодня»');
}

console.log('  ok настроение питомца: реакция на игру, перерыв без вины, рост по уровню');
