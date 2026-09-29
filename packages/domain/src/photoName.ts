const extension = /\.(?:jpe?g|png|webp)$/i;

export function photoNameStem(fileName: string): string {
  const clean = fileName.normalize('NFKC').trim();
  if (!clean || /[\\/]/.test(clean) || Array.from(clean).some(char => char.charCodeAt(0) < 32)) {
    throw new RangeError('Invalid photo filename');
  }
  const stem = clean.replace(extension, '').trim();
  if (!stem || stem === '.' || stem === '..') throw new RangeError('Invalid photo filename');
  return stem;
}

/** Same visible name, regardless of extension or casing, replaces within a tour. */
export function photoNameKey(fileName: string): string {
  return photoNameStem(fileName).toLocaleLowerCase('en-US');
}
