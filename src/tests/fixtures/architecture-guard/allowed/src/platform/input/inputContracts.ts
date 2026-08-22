import type { GameSession } from "../../domain/GameSession";

export interface SessionInputPort {
  session?: GameSession;
}
