import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(join(root, 'public', 'temperature-icon.svg'));
for (const [size, filename] of [[192, 'temperature-192.png'], [512, 'temperature-512.png'], [180, 'apple-touch-icon.png']]) {
  await sharp(source).resize(size, size).png().toFile(join(root, 'public', filename));
}
