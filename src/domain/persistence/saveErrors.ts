import type { CurrentSave } from "./currentSave";
import type { SaveV2Document } from "./saveV2";
import type { SaveV3Document } from "./saveV3";
import type { SaveV4Document } from "./saveV4";

export type SaveLoadFailure =
  | "absent"
  | "invalid-json"
  | "invalid-document"
  | "unsupported-schema"
  | "unsupported-generator";

export interface SaveDecodeSuccess {
  readonly ok: true;
  readonly document: CurrentSave;
  readonly wireDocument: SaveV2Document | SaveV3Document | SaveV4Document;
}

export interface SaveDecodeFailure {
  readonly ok: false;
  readonly failure: SaveLoadFailure;
  readonly message: string;
}

export type SaveDecodeResult = SaveDecodeSuccess | SaveDecodeFailure;
