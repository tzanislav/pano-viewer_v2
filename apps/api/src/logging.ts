export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function log(level: LogLevel, action: string, fields: Record<string, string | number | boolean | undefined>): void {
  const entry = { at: new Date().toISOString(), level, action, ...fields };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
