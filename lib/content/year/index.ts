import { PROGRAM, PROGRAM_DAYS } from '../program/index.ts';
import { buildYearPlan } from './types.ts';

/**
 * Годовая сетка, собранная из существующей программы.
 *
 * Программа не переписана: те же 12 тем и те же 60 дней симулятора. Год — это
 * вид сверху, в котором единица планирования — занятие раз в неделю, а дни
 * симулятора идут домашней практикой между занятиями.
 */
export const YEAR = buildYearPlan(PROGRAM, PROGRAM_DAYS);

export * from './types.ts';
