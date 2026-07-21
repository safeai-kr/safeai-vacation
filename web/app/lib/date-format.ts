const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function formatKstDateTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '-';

  const kst = new Date(timestamp + KST_OFFSET_MS);
  return [
    `${kst.getUTCFullYear()}.${pad(kst.getUTCMonth() + 1)}.${pad(kst.getUTCDate())}`,
    `${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`,
  ].join(' ');
}
