const NAMED_ENTITIES = new Map([
  ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"],
]);

export function decodeXml(value: string): string {
  const unwrapped = value.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1');
  return unwrapped.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (entity, code: string) => {
    if (!code.startsWith('#')) return NAMED_ENTITIES.get(code.toLowerCase()) ?? entity;
    const hexadecimal = code[1]?.toLowerCase() === 'x';
    const point = Number.parseInt(code.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
  });
}

export function xmlTag(item: string, name: string): string {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i').exec(item);
  return decodeXml(match?.[1]?.trim() ?? '');
}

export function sizeToBytes(value: string): number {
  const match = /^([\d.]+)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|TB|B)$/i.exec(value.trim());
  if (match === null) return 0;
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase() ?? 'b';
  const power = new Map([
    ['b', 0], ['kb', 1], ['kib', 1], ['mb', 2], ['mib', 2],
    ['gb', 3], ['gib', 3], ['tb', 4], ['tib', 4],
  ]).get(unit) ?? 0;
  return Number.isFinite(amount) ? Math.round(amount * 1024 ** power) : 0;
}

export function rssItems(xml: string): string[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .map((match) => match[1])
    .filter((item): item is string => item !== undefined);
}

export function infoHashToHex(value: string): string | null {
  if (/^[a-f\d]{40}$/i.test(value)) return value.toLowerCase();
  if (!/^[a-z2-7]{32}$/i.test(value)) return null;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of value.toUpperCase()) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return null;
    accumulator = (accumulator << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >>> bits) & 0xff);
    }
  }
  return bytes.length === 20
    ? bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')
    : null;
}
