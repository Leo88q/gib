import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Лицензии — ГИБ',
  description: 'Шрифты, пиктограммы и открытые библиотеки сервиса и условия их использования.',
};

/**
 * Список открытых компонентов и шрифтов с указанием лицензий.
 *
 * OpenMoji распространяется по CC BY-SA 4.0 и требует атрибуции — она указана
 * здесь и в тексте лицензии. Остальные файлы лежат в public/licenses и
 * отдаются по прямым ссылкам.
 */

const OPEN_SOURCE = [
  { name: 'OpenDyslexic (шрифт OpenDyslexic)', license: 'SIL Open Font License 1.1', file: 'opendyslexic-ofl.txt' },
  { name: 'OpenMoji (пиктограммы в историях)', license: 'CC BY-SA 4.0', file: 'openmoji-cc-by-sa-4.0.txt' },
  { name: 'Phaser', license: 'MIT', file: 'phaser.txt' },
  { name: 'Blockly', license: 'Apache 2.0', file: 'blockly.txt' },
  { name: 'inkjs', license: 'MIT', file: 'inkjs.txt' },
  { name: 'Mingo (валидация JSON)', license: 'MIT', file: 'mingo-mit.txt' },
  { name: 'PocketBase JS SDK', license: 'MIT', file: 'pocketbase-js-mit.txt' },
  { name: 'simple-qbn', license: 'MIT', file: 'simple-qbn-mit.txt' },
  { name: 'ts-fsrs', license: 'MIT', file: 'ts-fsrs-mit.txt' },
  { name: 'XState', license: 'MIT', file: 'xstate-mit.txt' },
  { name: 'uuid', license: 'MIT', file: 'uuid-mit.txt' },
] as const;

export default function LicensesPage() {
  return (
    <main className="page legal-page">
      <p className="muted small"><Link href="/legal">← Все документы</Link></p>
      <h1>Лицензии и открытые компоненты</h1>
      <p className="muted">
        Сервис построен на открытых библиотеках и шрифтах. Полные тексты лицензий лежат в
        репозитории и отдаются по ссылкам ниже. Иллюстрации персонажей и сцен — оригинальная
        графика проекта (сгенерирована и отредактирована авторами проекта).
      </p>

      <section className="legal-section">
        <h2>Атрибуции</h2>
        <ul>
          <li>
            <strong>OpenMoji</strong> © OpenMoji contributors — графика распространяется по
            <a href="https://openmoji.org">openmoji.org</a> под лицензией CC BY-SA 4.0.
            Используется в истории и интерфейсе без модификации смысловых знаков.
          </li>
          <li>
            <strong>OpenDyslexic</strong> — шрифт с открытой лицензией SIL OFL 1.1,
            создан для удобства чтения детьми с дислексией; файл шрифта не изменён.
          </li>
        </ul>
      </section>

      <section className="legal-section">
        <h2>Открытый код и лицензии</h2>
        <ul>
          {OPEN_SOURCE.map((item) => (
            <li key={item.name}>
              {item.name} — {item.license}.{' '}
              <a href={`/licenses/${item.file}`} target="_blank" rel="noreferrer">текст лицензии</a>
            </li>
          ))}
        </ul>
      </section>

      <section className="legal-section">
        <h2>Чего здесь нет</h2>
        <p className="muted">
          Маркетинговых изображений из стоков, чужих логотипов и персональных данных третьих лиц.
          Если вы нашли материал без указания источника, напишите оператору — раздел будет исправлен.
        </p>
      </section>

      <p><Link href="/legal">← Все документы</Link></p>
    </main>
  );
}
