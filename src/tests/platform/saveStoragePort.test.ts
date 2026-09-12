import { describe, expect, it } from "vitest";
import type { LoadedSave, SaveStoragePort } from "../../app/ports/saveStorage";
import { GameSession } from "../../domain/GameSession";
import {
  createAsyncBrowserSaveStorage,
  SAVE_KEYS,
  type KeyValueStore,
} from "../../platform/storage/browserSaveStorage";
import { MemorySaveStorage } from "../support/memorySaveStorage";

class Store implements KeyValueStore {
  readonly values = new Map<string, string>();
  writes = 0;
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.writes += 1;
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.writes += 1;
    this.values.delete(key);
  }
}

const absent: LoadedSave = {
  ok: false,
  document: null,
  source: null,
  warning: null,
  failure: "absent",
  message: "absent",
};
const valid = () => {
  const request = new GameSession().createValidCampfireSaveRequest(1);
  if (request === null) throw new Error("fixture campfire unavailable");
  return request.document;
};

const contract = (name: string, make: () => SaveStoragePort): void => {
  describe(name, () => {
    it("loads without committing and commits only when explicitly called", async () => {
      const storage = make();
      await storage.load();
      const result = await storage.commit(valid());
      expect(result.ok).toBe(true);
    });
  });
};

contract("memory save storage contract", () => new MemorySaveStorage(absent));
contract("browser save storage contract", () =>
  createAsyncBrowserSaveStorage(new Store()),
);

describe("browser async storage port", () => {
  it("does not write corrupt or unsupported data while loading", async () => {
    const store = new Store();
    store.values.set(SAVE_KEYS.primary, '{"schemaVersion":99}');
    const storage = createAsyncBrowserSaveStorage(store);
    const result = await storage.load();
    expect(result).toMatchObject({ ok: false, failure: "unsupported-schema" });
    expect(store.writes).toBe(0);
  });
});
