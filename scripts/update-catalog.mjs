import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = resolve(root, 'data/catalog');
const sourceRoot = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en';
const sources = {
  skin: 'skins_not_grouped.json', agent: 'agents.json', case: 'crates.json', sticker: 'stickers.json',
  sticker_slab: 'sticker_slabs.json', charm: 'keychains.json', music_kit: 'music_kits.json',
  patch: 'patches.json', graffiti: 'graffiti.json', collectible: 'collectibles.json', key: 'keys.json'
};

async function download(url, attempt = 1) {
  try {
    const response = await fetch(url, { headers: { 'user-agent': 'CSELL-catalog-refresh/1.0', accept: 'application/json' }, signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (attempt >= 3) throw error;
    await new Promise(resolve => setTimeout(resolve, attempt * 1400));
    return download(url, attempt + 1);
  }
}

function compact(item, category) {
  return {
    id: item.id ?? null,
    name: item.name ?? item.market_hash_name ?? 'Unknown CS2 item',
    market_hash_name: item.market_hash_name ?? item.name ?? '',
    image: item.image ?? '',
    category,
    rarity: item.rarity ? { name: item.rarity.name ?? '', color: item.rarity.color ?? '' } : null,
    weapon: item.weapon ? { name: item.weapon.name ?? '' } : null,
    type: item.type ?? '',
    min_float: item.min_float ?? null,
    max_float: item.max_float ?? null
  };
}

await mkdir(outputDir, { recursive: true });
const changed = [];
for (const [category, file] of Object.entries(sources)) {
  const source = await download(`${sourceRoot}/${file}`);
  if (!Array.isArray(source)) throw new Error(`Unexpected catalog shape for ${file}`);
  const normalized = source.map(item => compact(item, category));
  const target = resolve(outputDir, `${category}.json`);
  const temporary = `${target}.tmp`;
  await writeFile(temporary, `${JSON.stringify(normalized)}\n`, 'utf8');
  await rename(temporary, target);
  changed.push(`${category}: ${normalized.length}`);
}
await writeFile(resolve(root, 'data/catalog-meta.json'), `${JSON.stringify({ source: 'ByMykel/CSGO-API', updatedAt: new Date().toISOString(), categories: Object.keys(sources) }, null, 2)}\n`, 'utf8');
console.log(`CSELL catalog refreshed (${new Date().toISOString()})`);
console.log(changed.join('\n'));
