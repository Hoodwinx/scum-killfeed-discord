// Parse the SCUM death summary; ignore accompanying JSON details.
export function parseKill(line) {
  if (!line || !/\bDied:\s*/i.test(line)) return null;
  const victim = line.match(/\bDied:\s*(.*?)\s*\(([^)]*)\)/i);
  const killer = line.match(/\bKiller:\s*(.*?)\s*\(([^)]*)\)/i);
  const weapon = line.match(/\bWeapon:\s*(.*?)\s+Distance:/i);
  const distance = line.match(/\bDistance:\s*([\d.]+)\s*m/i);
  if (!victim) return null;
  const timestamp = line.match(/^(\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2})/);
  return {
    timestamp: timestamp?.[1] ?? null,
    victim: victim[1].trim(),
    killer: killer?.[1].trim() ?? 'Unknown',
    killerType: killer?.[2].trim() ?? 'Unknown',
    weapon: weapon?.[1].trim() ?? 'Unknown',
    distance: distance ? Number(distance[1]) : null
  };
}

export function decodeLog(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.toString('utf16le').replace(/^\uFEFF/, '');
  let zeroOdd = 0;
  const sample = Math.min(buffer.length - (buffer.length % 2), 128);
  for (let i = 1; i < sample; i += 2) if (buffer[i] === 0) zeroOdd++;
  return sample >= 8 && zeroOdd >= sample / 4 ? buffer.toString('utf16le') : buffer.toString('utf8');
}
