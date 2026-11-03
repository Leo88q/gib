/** Spoken/visible equivalents of visual puzzle symbols. */
const COLORS: Record<string, string> = { red: 'красный', blue: 'синий', green: 'зелёный', yellow: 'жёлтый', purple: 'фиолетовый', orange: 'оранжевый' };
const SHAPES: Record<string, string> = { circle: 'круг', square: 'квадрат', triangle: 'треугольник', star: 'звезда', heart: 'сердце', diamond: 'ромб' };
export function colorName(value: string): string { return COLORS[value] ?? 'неизвестный цвет'; }
export function shapeName(value: string): string { return SHAPES[value] ?? 'фигура'; }
export function cardName(shape: string, color: string): string { return `${colorName(color)}, ${shapeName(shape)}`; }
export function positionName(index: number, cols: number): string { return `ряд ${Math.floor(index / cols) + 1}, столбец ${index % cols + 1}`; }
