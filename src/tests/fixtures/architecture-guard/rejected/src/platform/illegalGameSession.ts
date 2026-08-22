import { GameSession } from "../domain/GameSession";

export const constructOutsideCompositionRoot = () => new GameSession();
