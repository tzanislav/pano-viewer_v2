type Outcome = 'success' | 'failure';

export function logAction(action: string, outcome: Outcome, details: Record<string, string> = {}): void {
  const entry = { at: new Date().toISOString(), action, outcome, ...details };
  if (outcome === 'failure') console.warn(entry);
  else console.info(entry);
}
