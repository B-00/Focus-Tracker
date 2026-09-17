#!/usr/bin/env node
// One-shot script that rasterizes icons/icon.svg into the PNG sizes
// Firefox's manifest expects. Committed alongside the PNGs so a normal
// clone doesn't need to run this — re-run with `pnpm icons` only when
// the SVG source changes.
//
// Sizes come from the MV3 icons spec: 16, 32, 48, 96, 128.
//
// ponytail: `sharp` is a devDep only; ship-time bundle is untouched.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = resolve(__dirname, '..', 'icons');
const SOURCE = resolve(ICONS_DIR, 'icon.svg');
const SIZES = [16, 32, 48, 96, 128];

async function main() {
  const svg = await readFile(SOURCE);
  await mkdir(ICONS_DIR, { recursive: true });
  for (const size of SIZES) {
    const out = resolve(ICONS_DIR, `icon-${size}.png`);
    await sharp(svg, { density: 384 })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(out);
    console.log(`  ✓ ${size}×${size} → ${out}`);
  }
  console.log('icons built.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
