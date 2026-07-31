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

function redactSensitiveErrorText(value: string) {
  return value
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, '[REDACTED_KEY]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\bya29\.[A-Za-z0-9._-]+/g, '[REDACTED_TOKEN]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_TOKEN]')
    .replace(/("(?:private_key|client_secret|access_token|id_token)"\s*:\s*")[^"]+(")/gi, '$1[REDACTED]$2')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800);
}

export function adminErrorDiagnostic(error: unknown) {
  const value = error && typeof error === 'object'
    ? error as Record<string, unknown>
    : null;
  const cause = value?.cause;
  const causeMessage = cause instanceof globalThis.Error
    ? cause.message
    : cause && typeof cause === 'object' && typeof (cause as Record<string, unknown>).message === 'string'
      ? String((cause as Record<string, unknown>).message)
      : '';
  const code = value?.code ?? value?.status ?? (error instanceof globalThis.Error ? error.name : 'UNKNOWN');
  const parts = [
    error instanceof globalThis.Error ? error.message : typeof error === 'string' ? error : '',
    typeof value?.details === 'string' ? value.details : '',
    causeMessage,
  ].filter(Boolean);
  const message = redactSensitiveErrorText([...new Set(parts)].join(' · ')) || '알 수 없는 서버 오류';

  return {
    code: redactSensitiveErrorText(String(code || 'UNKNOWN')).slice(0, 80),
    message,
  };
}
