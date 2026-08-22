/** Recursively readonly view of authored data without changing runtime session types. */
export type DeepReadonly<Value> = Value extends (
  ...arguments_: never[]
) => unknown
  ? Value
  : Value extends readonly unknown[]
    ? { readonly [Index in keyof Value]: DeepReadonly<Value[Index]> }
    : Value extends object
      ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
      : Value;

/**
 * Deep-freezes plain authored data while safely handling repeated and cyclic
 * object references. Runtime state must remain instance-owned and mutable.
 */
export const deepFreeze = <Value>(value: Value): DeepReadonly<Value> => {
  const visited = new WeakSet<object>();

  const freeze = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== "object") return;
    if (visited.has(candidate)) return;
    visited.add(candidate);
    for (const key of Reflect.ownKeys(candidate))
      freeze(Reflect.get(candidate, key));
    Object.freeze(candidate);
  };

  freeze(value);
  return value as DeepReadonly<Value>;
};
