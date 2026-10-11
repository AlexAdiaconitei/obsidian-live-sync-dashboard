// Counts attempts per key within a one-minute window, for at most 1000 keys.
export class AttemptLimiter {
  private readonly entries = new Map<string, { count: number; until: number }>();

  count(key: string): number {
    const entry = this.entries.get(key);
    return entry && entry.until > Date.now() ? entry.count : 0;
  }

  add(key: string): void {
    const now = Date.now();
    for (const [name, value] of this.entries) if (value.until <= now) this.entries.delete(name);
    const entry = this.entries.get(key) ?? { count: 0, until: now + 60_000 };
    if (!this.entries.has(key) && this.entries.size >= 1000) {
      // Evict the oldest key with the fewest attempts, so a flood of new keys cannot reset the
      // counter of an account under attack.
      let evict: string | undefined;
      let fewest = Infinity;
      for (const [name, value] of this.entries)
        if (value.count < fewest) [evict, fewest] = [name, value.count];
      this.entries.delete(evict!);
    }
    this.entries.set(key, { ...entry, count: entry.count + 1 });
  }
}
