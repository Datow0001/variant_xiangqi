export class GameError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'GameError';
  }
}

export function asGameError(error: unknown): GameError {
  return error instanceof GameError ? error : new GameError('INTERNAL_ERROR', '伺服器處理失敗，請稍後再試');
}
