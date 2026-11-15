'use client';

import React from 'react';
import type { MeetingPlan } from '@/lib/year/meeting';

/**
 * План встречи для родителя.
 *
 * Тот же план, что у педагога, но показан иначе. У педагога на экране одна
 * встреча из тридцати шести и его интересует методика; у родителя дома
 * интересует ответ на вопрос «что мне делать в четверг в семь». Поэтому
 * сверху — длина и этап года, блоки свёрнуты по минутам, а печать выводит
 * встречу целиком одним листом.
 *
 * Чего здесь нет: оценок, «ключей к упражнению» и текста для детей. Блоки
 * написаны взрослому, как и в кабинете педагога, — один текст на две роли
 * лучше двух расходящихся версий.
 */
export default function MeetingPlanCard({ plan }: { plan: MeetingPlan }) {
  return (
    <section className="card meeting-card">
      <h2>Встреча {plan.lesson}: {plan.unitTitle}</h2>
      <p className="muted">
        {plan.blocks.reduce((sum, block) => sum + block.minutes, 0)} минут · {plan.stage.title} · навыки: {plan.skills.join(', ')}
      </p>
      {plan.audience?.household && <p className="muted small">{plan.audience.household}</p>}
      {plan.frame && <blockquote className="meeting-frame">{plan.frame}</blockquote>}
      <ol className="meeting-blocks">
        {plan.blocks.map((block) => (
          <li key={block.title}>
            <strong>{block.minutes} мин · {block.title}</strong>
            <p>{block.lead}</p>
            <p className="muted small">{block.children}</p>
          </li>
        ))}
      </ol>
      {plan.freeze && (
        <div className="meeting-freeze">
          <strong>Если хочется сцены</strong>
          <p>{plan.freeze.start} {plan.freeze.stop} {plan.freeze.after}</p>
        </div>
      )}
      {plan.safety && (
        <details className="meeting-safety">
          <summary>Что проверить до телесного упражнения ({plan.safety.rules.length})</summary>
          <ul>
            {plan.safety.rules.map((rule) => <li key={rule.id}><strong>{rule.title}</strong> — {rule.do} <span className="muted small">{rule.why}</span></li>)}
          </ul>
        </details>
      )}
      <p className="muted small">
        Нужны: {plan.materials.join('; ')}. Ничего покупать не нужно.
      </p>
      <p className="meeting-closing">{plan.closing}</p>
      <button type="button" className="btn secondary small no-print" onClick={() => window.print()}>
        Распечатать эту встречу
      </button>
    </section>
  );
}
