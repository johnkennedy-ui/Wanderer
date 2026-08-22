export let mutableModuleState = 0;
export const mutableObject = { active: false };

const sessionCache = new Map<string, number>();

export class UnsafeStatics {
  static runtimeCache = new Map<string, number>();

  static size(): number {
    return sessionCache.size + this.runtimeCache.size;
  }
}
