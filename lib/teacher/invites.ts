/**
 * Приглашение ребёнка в группу — через код, который вводит родитель.
 *
 * Почему код, а не «педагог добавляет ребёнка по идентификатору». Первое —
 * согласие. Ребёнок не должен попадать в группу потому, что взрослый где-то
 * узнал его идентификатор: это доступ к посещаемости, а посещаемость — след
 * того, где ребёнок был в конкретный день. Второе — ошибки. Педагог, набирающий
 * идентификаторы вручную, рано или поздно добавит чужого.
 *
 * Как устроено:
 *  - у группы есть `joinCode`, его называет педагог родителям;
 *  - родитель вводит код в своём кабинете и выбирает ребёнка;
 *  - членство появляется только после этого шага.
 *
 * Код короткий, потому что его диктуют вслух и пишут в чат. Поэтому его нельзя
 * подобрать перебором: 8 символов из 32 — это 40 бит, а маршрут ограничен по
 * частоте. Код группы не связан с идентификатором ребёнка и ничего о нём не
 * говорит.
 */

import { randomInt } from 'node:crypto';

/** Алфавит без похожих символов: 0/O и 1/I путают при диктовке. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

/** Новый код группы. Криптостойкий: код — это право войти в группу. */
export function newJoinCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/**
 * Нормализация введённого кода: пробелы, дефисы и регистр.
 *
 * Родитель вводит код так, как ему удобно: «abcd-efgh», «ABCD EFGH». Отвергать
 * такой ввод — издевательство, а не безопасность.
 */
export function normalizeJoinCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.toUpperCase().replace(/[\s-]/g, '');
  if (clean.length !== CODE_LENGTH) return null;
  for (const char of clean) if (!ALPHABET.includes(char)) return null;
  return clean;
}

/** Годен ли код для передачи родителям: проверка при создании группы. */
export function validJoinCode(value: unknown): value is string {
  return typeof value === 'string' && normalizeJoinCode(value) === value;
}
