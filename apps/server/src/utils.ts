let sequence = 0;

export function makeId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
