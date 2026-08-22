export let mutableModuleState = 0;
export const mutableObject = { active: false };
export const UPPERCASE_MUTABLE = { active: false };
export const TYPE_ONLY_IMMUTABLE = { active: false } as const;

const sessionCache = new Map<string, number>();

export class UnsafeStatics {
  static runtimeCache = new Map<string, number>();

  static size(): number {
    return sessionCache.size + this.runtimeCache.size;
  }
}
