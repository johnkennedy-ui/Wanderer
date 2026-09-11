import { describe, expect, it } from "vitest";
import {
  createApplicationBootstrap,
  createCampfireSaveIntent,
  type CampfireSaveSession,
} from "../../app/applicationLifecycle";
import type { LoadedSave } from "../../app/ports/saveStorage";
import { GameSession } from "../../domain/GameSession";

const absent: LoadedSave = {
  ok: false,
  document: null,
  source: null,
  warning: null,
  failure: "absent",
  message: "No save exists.",
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

describe("application bootstrap", () => {
  it("awaits storage before creating the session or any later composition work", async () => {
    const loaded = deferred<LoadedSave>();
    const order: string[] = [];
    const booting = createApplicationBootstrap(
      {
        load: async () => {
          order.push("load");
          return loaded.promise;
        },
      },
      (saved) => {
        order.push(saved === undefined ? "fresh-session" : "saved-session");
        return { saved };
      },
    );

    expect(order).toEqual(["load"]);
    loaded.resolve(absent);
    await expect(booting).resolves.toEqual({
      session: { saved: undefined },
      platformMessage: "Fresh runtime: no committed save loaded.",
    });
    expect(order).toEqual(["load", "fresh-session"]);
  });
});

describe("explicit campfire save intent", () => {
  const validRequest = () => {
    const request = new GameSession().createValidCampfireSaveRequest(1);
    if (request === null) throw new Error("home campfire must be valid");
    return request;
  };

  it("commits only a valid campfire request and excludes overlapping commits", async () => {
    const request = validRequest();
    const committed = deferred<{ ok: true; message: string; cleanupWarning: null }>();
    const messages: string[] = [];
    let requests = 0;
    let records = 0;
    const session: CampfireSaveSession = {
      createValidCampfireSaveRequest: () => {
        requests += 1;
        return request;
      },
      recordSaveCommitted: (document) => {
        expect(document).toBe(request.document);
        records += 1;
      },
    };
    let commits = 0;
    const intent = createCampfireSaveIntent(
      session,
      {
        commit: async (document) => {
          expect(document).toBe(request.document);
          commits += 1;
          return committed.promise;
        },
      },
      (message) => messages.push(message),
      () => 1,
    );

    const first = intent.save();
    const overlapping = intent.save();
    expect(requests).toBe(1);
    expect(commits).toBe(1);
    committed.resolve({ ok: true, message: "Saved explicitly.", cleanupWarning: null });
    await Promise.all([first, overlapping]);
    expect(records).toBe(1);
    expect(messages).toEqual(["Saved explicitly. Save point: home campfire."]);
  });

  it("does not commit when no valid campfire request exists", async () => {
    const messages: string[] = [];
    const session: CampfireSaveSession = {
      createValidCampfireSaveRequest: () => null,
      recordSaveCommitted: () => {
        throw new Error("an invalid save must not be recorded");
      },
    };
    const intent = createCampfireSaveIntent(
      session,
      {
        commit: async () => {
          throw new Error("an invalid save must not commit");
        },
      },
      (message) => messages.push(message),
      () => 1,
    );

    await intent.save();
    expect(messages).toEqual([
      "Save was not committed: move to a valid campfire first.",
    ]);
  });
});
