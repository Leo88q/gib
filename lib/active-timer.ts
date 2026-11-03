/** Counts only foreground time. Times must use the same monotonic clock (performance.now). */
export class ActiveTimer {
  private accumulated = 0;
  private since: number | null = null;
  reset(now: number, visible: boolean) { this.accumulated = 0; this.since = visible ? now : null; }
  setVisible(visible: boolean, now: number) {
    if (!visible && this.since !== null) {
      this.accumulated += Math.max(0, now - this.since);
      this.since = null;
    } else if (visible && this.since === null) this.since = now;
  }
  elapsed(now: number) { return Math.round(this.accumulated + (this.since === null ? 0 : Math.max(0, now - this.since))); }
}
