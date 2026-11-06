/**
 * Сводка «что мы храним» отвечает на вопрос «сколько», а не «что именно».
 *
 * Повод: маршрут `/api/profile/data` был описан в интерфейсе и в HTTP-тесте, но
 * самого маршрута в дереве не было. Кабинет взрослого показывал «Не удалось
 * загрузить, какие данные хранятся» — честную ошибку вместо ответа. HTTP-тест
 * это ловил, но требует живого сервера и потому в общий прогон не входил;
 * браузерный тест падал по той же причине.
 *
 * Здесь проверяется сам обработчик, без сети: контракт (какие ключи, какие
 * коды) и главное свойство — в ответе нет содержимого ответов и чувств.
 */
import assert from 'node:assert/strict';
import { GET } from '../app/api/profile/data/route.ts';
import { store } from '../lib/store.ts';

/** Запрос от демонстрационного взрослого: подпись не нужна в демо-режиме. */
function request(parent: string, profileId?: string) {
  const query = profileId === undefined ? '' : `?profileId=${encodeURIComponent(profileId)}`;
  return new Request(`http://127.0.0.1/api/profile/data${query}`, {
    headers: { 'x-demo-parent': parent },
  });
}

async function main() {
  // В демо-режиме владелец — `demo:<имя>`; окружение выставляем явно, чтобы
  // тест не зависел от того, чем запущен прогон.
  const previous = { NODE_ENV: process.env.NODE_ENV, GIB_DEMO_MODE: process.env.GIB_DEMO_MODE, TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN, MAX_BOT_TOKEN: process.env.MAX_BOT_TOKEN };
  // `NODE_ENV` в типах Next только для чтения, поэтому пишем через запись по ключу.
  (process.env as Record<string, string>).NODE_ENV = 'development';
  process.env.GIB_DEMO_MODE = '1';
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.MAX_BOT_TOKEN;

  const parent = `summary-${Date.now()}`;
  try {
    /* ---- 1. Без profileId — 400, с чужим — 404 ---- */
    {
      const missing = await GET(request(parent));
      assert.equal(missing.status, 400, 'profileId обязателен');
      const foreign = await GET(request(parent, 'p_does_not_exist'));
      assert.equal(foreign.status, 404, 'чужой и несуществующий профиль неразличимы');
      console.log('  ok без profileId — 400, чужой профиль — 404');
    }

    /* ---- 2. Сводка: категории, количество, согласие ---- */
    // Профиль создаём тем же путём, что и приложение: без навыков и состояния
    // игрока маршрут читал бы то, чего в жизни не бывает.
    const profile: import('../lib/types.ts').Profile = {
      id: `p_test_${Date.now()}`,
      parentId: `demo:${parent}`,
      name: 'Мира',
      age: 9,
      band: '8-10',
      timeZone: 'Europe/Moscow',
      createdAt: Date.now(),
    };
    store.addProfile(profile);
    {
      const response = await GET(request(parent, profile.id));
      assert.equal(response.status, 200, 'сводка отдаётся');
      const data = await response.json();

      assert.equal(data.profile.name, 'Мира');
      assert.deepEqual(
        Object.keys(data.counts).sort(),
        ['events', 'familyMarks', 'feelings', 'sessions', 'stories', 'tasks'],
        'категории названы',
      );
      assert.equal(data.counts.feelings, 0);
      assert.equal(data.feelings.enabled, false, 'по умолчанию сохранение выключено');
      assert.equal(data.feelings.retentionDays, 90, 'срок хранения из модели');
      assert.equal(data.feelings.limit, 60, 'лимит из модели');
      console.log('  ok сводка: категории, количество, согласие выключено по умолчанию');
    }

    /* ---- 3. Содержимого нет: только числа ---- */
    {
      const raw = JSON.stringify(await (await GET(request(parent, profile.id))).json());
      for (const forbidden of ['joy', 'радость', 'scenarioId', 'answer', 'initData', 'feelings:[']) {
        assert.equal(raw.includes(forbidden), false, `в сводке нет «${forbidden}»`);
      }
      // Ни одного поля с массивом содержимого: только счётчики и настройки.
      assert.equal(/"(items|checkins|answers|responses)"/.test(raw), false, 'нет полей с содержимым');
      console.log('  ok в сводке нет содержимого ответов, чувств и платформенных данных');
    }

    /* ---- 4. Отметка видна как число, но не как содержимое ---- */
    {
      store.transaction(() => {
        const player = store.playerState(profile.id);
        player.feelings = {
          prefs: { saveEnabled: true, consentAt: Date.now(), band: '8-10' },
          items: [{ id: 'c1', day: '2026-11-06', feelings: ['joy'], at: Date.now() }],
        };
        store.setPlayerState(player);
      });
      const data = await (await GET(request(parent, profile.id))).json();
      assert.equal(data.counts.feelings, 1, 'отметка посчитана');
      assert.equal(data.feelings.enabled, true);
      assert.equal(JSON.stringify(data).includes('joy'), false, 'сама отметка не раскрыта');
      console.log('  ok сохранённая отметка видна числом, без содержимого');
    }

    /* ---- 5. Отзыв согласия и удаление закрывают сводку ---- */
    {
      // Отзыв согласия стирает отметки — это правило продукта, а не следствие
      // сводки. Повторяем именно его: данные без основания не остаются лежать.
      store.transaction(() => {
        const player = store.playerState(profile.id);
        player.feelings = { prefs: { saveEnabled: false, consentAt: Date.now(), band: '8-10' }, items: [] };
        store.setPlayerState(player);
      });
      const revoked = await (await GET(request(parent, profile.id))).json();
      assert.equal(revoked.counts.feelings, 0, 'без согласия отметки не считаются');
      assert.equal(revoked.feelings.enabled, false);

      store.transaction(() => store.deleteProfile(profile.id));
      const gone = await GET(request(parent, profile.id));
      assert.equal(gone.status, 404, 'после удаления сводки нет');
      console.log('  ok отзыв обнуляет счётчик, удаление закрывает сводку');
    }
  } finally {
    if (previous.NODE_ENV !== undefined) (process.env as Record<string, string>).NODE_ENV = previous.NODE_ENV;
    if (previous.GIB_DEMO_MODE === undefined) delete process.env.GIB_DEMO_MODE; else process.env.GIB_DEMO_MODE = previous.GIB_DEMO_MODE;
    if (previous.TELEGRAM_BOT_TOKEN !== undefined) process.env.TELEGRAM_BOT_TOKEN = previous.TELEGRAM_BOT_TOKEN;
    if (previous.MAX_BOT_TOKEN !== undefined) process.env.MAX_BOT_TOKEN = previous.MAX_BOT_TOKEN;
  }

  console.log('\nСводка данных профиля: категории и количество, без содержимого.');
}

main().catch(error => { console.error(error); process.exit(1); });
