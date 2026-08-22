export class SessionOwnedCache {
  private readonly values = new Map<string, number>();

  remember(key: string, value: number): void {
    if (!this.values.has(key) && this.values.size === 2) {
      const oldestKey = this.values.keys().next().value;
      if (oldestKey !== undefined) this.values.delete(oldestKey);
    }
    this.values.set(key, value);
  }

  read(key: string): number | undefined {
    return this.values.get(key);
  }

  dispose(): void {
    this.values.clear();
  }
}
