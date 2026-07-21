export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export function apiErrorResponse(error: unknown, fallbackMessage: string) {
  const rawMessage = error instanceof DomainError ? error.message.trim() : '';
  const expected = error instanceof DomainError && Boolean(rawMessage) && rawMessage.length <= 500;
  return {
    message: expected ? rawMessage : fallbackMessage,
    expected,
  };
}
