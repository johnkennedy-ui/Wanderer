import type { GameSession } from "../../domain/GameSession";

export interface KeyboardContract {
  dispose(): void;
  session?: GameSession;
}
