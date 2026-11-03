/** Explicit mappings prevent underscores in domain IDs from becoming broken asset URLs. */
const skillIcons: Record<string, string> = {
  attention: 'attention', working_memory: 'working-memory', flexibility: 'flexibility',
  inhibition: 'inhibition', planning: 'planning', logic: 'logic',
};
const competencyIcons: Record<string, string> = {
  self_awareness: 'self-awareness', self_regulation: 'self-regulation', empathy: 'empathy',
  relationships: 'relationships', decision_making: 'decision-making',
  creative_thinking: 'creative-thinking', growth_mindset: 'growth-mindset',
};
export const DEFAULT_ART = '/art/mascot-think.png';
export function skillArt(skill: string): string {
  const icon = skillIcons[skill];
  return icon ? `/art/icon-${icon}.png` : DEFAULT_ART;
}
export function competencyArt(competency: string): string {
  const icon = competencyIcons[competency];
  return icon ? `/art/icon-${icon}.png` : DEFAULT_ART;
}
/** Every program week has its own illustration; unknown IDs use a safe fallback. */
export function weekArt(week: number, competency: string): string {
  if (Number.isInteger(week) && week >= 1 && week <= 12) return `/art/week-${String(week).padStart(2, '0')}.png`;
  return competencyArt(competency);
}
