declare module 'simple-qbn' {
  class State { set(key: string, value: unknown): void; }
  class Card { constructor(content: string, qualities: Record<string, unknown>[]); isAvailable(state: State): boolean; }
  const qbn: Readonly<{ State: typeof State; Card: typeof Card }>;
  export default qbn;
}
