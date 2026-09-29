import type { GameSession } from "../GameSession";

export interface IllegalSessionFeatureDependency {
  readonly session: GameSession;
}
