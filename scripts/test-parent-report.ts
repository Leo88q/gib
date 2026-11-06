import assert from 'node:assert/strict';
import { buildReport } from '../lib/engine/session.ts';
import { playerReportBlock } from '../lib/engine/rewards.ts';
import { makeProfileExport } from '../lib/profile-export.ts';
import { emptyStats } from '../lib/gamification.ts';
import type { PlayerState, Profile } from '../lib/types.ts';
import { STORY_SKILLS } from '../lib/content/story-skills.ts';
import { SKILL_BY_ID } from '../lib/content/skills-catalog.ts';

/**
 * Отчёт родителю — единственное место, где взрослый видит ребёнка. Здесь
 * проверяем не цифры, а границы: чего в отчёте быть не должно.
 */

const profile: Profile = { id: 'p', parentId: 'owner', name: 'Тест', age: 9, band: '8-10', createdAt: 1 };
const player: PlayerState = {
  profileId: 'p', xp: 120, coins: 30, stars: 7, streak: 3, bestStreak: 5, lastActiveDay: '2026-11-05',
  badges: ['first_step'], inventory: [], equipped: { head: null, body: null, pet: null, room: null },
  missions: { day: 2, ids: [], progress: {}, claimed: [] },
  stats: { ...emptyStats(), days: 4, tasks: 12, correctTasks: 9, scenarios: 4, perfectDays: 2, minutes: 25 },
  startedAt: 1,
} as unknown as PlayerState;

/* ---- 1. В отчёте нет «идеальных дней» ---- */
{
  const block = playerReportBlock(player, 'Исследователь');
  assert.equal(Object.hasOwn(block, 'perfectDays'), false, 'perfectDays не попадает в блок отчёта');
  // Остальные счётчики на месте: убрали только оценку безошибочности.
  assert.equal(block.days, 4);
  assert.equal(block.badges, 1);
  assert.equal(block.xp, 120);
  assert.equal(block.levelTitle, 'Исследователь');
  console.log('  ok отчёт не показывает «идеальные дни»');
}

/* ---- 2. В отчёте нет метки оценки выбора ---- */
{
  const report = buildReport(profile);
  assert.equal(JSON.stringify(report).includes('"quality"'), false, 'метки оценки в отчёте нет');
  assert.equal(JSON.stringify(report).includes('perfectDays'), false, 'счётчик безошибочности в отчёт не проходит');
  console.log('  ok в отчёте нет ни метки оценки, ни счётчика безошибочности');
}

/* ---- 2b. Гибкие навыки в отчёте — список тем, а не оценка ---- */
{
  // Навык недели собирается из карты «история → навыки». Проверяем сам
  // источник: то, что попадёт в отчёт, не содержит оценок и цифр успеха.
  const weekScenarioIds = ['sk_name_feelings', 'w7d3', 'sk_not_judge'];
  const ids = new Set<string>();
  for (const storyId of weekScenarioIds) for (const skillId of STORY_SKILLS[storyId]?.skills ?? []) ids.add(skillId);
  const softSkills = [...ids].map(id => SKILL_BY_ID[id]).filter(Boolean);
  assert.ok(softSkills.length > 0, 'навыки недели не собрались');
  // Оценивает не любое слово «плохо»: в описании навыка оно может быть
  // примером расплывчатого самоописания. Оценкой ребёнка считаются только
  // прямые ярлыки и числовые рейтинги.
  for (const skill of softSkills) {
    const text = `${skill.title} ${skill.looksLike}`.toLowerCase();
    for (const word of ['молодец', 'неудачник', 'уровень развития', 'хуже других', 'баллы за']) {
      assert.equal(text.includes(word), false, `навык ${skill.id}: оценочное слово «${word}»`);
    }
    assert.equal(/\d+\s*(балл|очк|%|процент)/i.test(text), false, `навык ${skill.id}: число как оценка`);
  }
  // Один навык встречается в нескольких историях — список не раздувается.
  assert.equal(new Set(softSkills.map(skill => skill.id)).size, softSkills.length, 'навыки недели повторяются');
  console.log('  ok гибкие навыки недели — темы без оценок, без повторов');
}

/* ---- 3. Исторические данные не теряются ---- */
{
  // Счётчики остаются в выгрузке данных ребёнка: это его данные, и убрать их
  // из выгрузки значило бы скрыть то, что в хранилище есть.
  const exported = makeProfileExport({
    profile, skills: [], sessions: [], programStates: [], subs: [], payments: [], playerStates: [player],
  });
  const stats = exported.player[0]?.stats as Record<string, unknown> | undefined;
  assert.ok(stats, 'выгрузка содержит статистику');
  assert.equal(stats!.perfectDays, 2, 'исторический счётчик остаётся в выгрузке');
  assert.equal(stats!.goodScenarios, 0, 'исторический goodScenarios остаётся в выгрузке');
  console.log('  ok исторические счётчики остаются в выгрузке данных ребёнка');
}

/* ---- 4. Отчёт не оценивает ребёнка словами ---- */
{
  const text = JSON.stringify(buildReport(profile)).toLowerCase();
  for (const word of ['молодец', 'плохо', 'неуд', 'виноват', 'темперамент', 'характер', 'одарён']) {
    assert.equal(text.includes(word), false, `в отчёте не должно быть «${word}»`);
  }
  console.log('  ok отчёт не оценивает личность ребёнка');
}
