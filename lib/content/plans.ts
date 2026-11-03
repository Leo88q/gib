import type { PlanId } from '../types';

export const PLANS: Record<PlanId, { title: string; price: number; days: number; perks: string[] }> = {
  month: {
    title: 'Месяц',
    price: 599,
    days: 30,
    perks: ['Все тренажёры', 'Отчёт для родителя', 'Офлайн-миссии с родителем'],
  },
  year: {
    title: 'Год',
    price: 4990,
    days: 365,
    perks: ['Всё из «Месяца»', 'Экономия 30%', 'История прогресса за год'],
  },
  year_pro: {
    title: 'Год с экспертом',
    price: 9990,
    days: 365,
    perks: ['Всё из «Года»', '4 разбора с нейропсихологом в месяц', 'Корректировка программы'],
  },
};
