import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const inputDir = join(process.cwd(), 'assets', 'models');
const outputDir = join(process.cwd(), 'apps', 'web', 'public', 'models');

if (!existsSync(outputDir)) {
  mkdirSync(outputDir, { recursive: true });
}

if (!existsSync(inputDir)) {
  console.log('Pasta assets/models não encontrada. Nada a optimizar.');
  process.exit(0);
}

const files = readdirSync(inputDir).filter((f) => f.endsWith('.glb'));

if (files.length === 0) {
  console.log('Nenhum ficheiro .glb em assets/models/. A usar geometria provisória.');
  process.exit(0);
}

for (const file of files) {
  const inPath = join(inputDir, file);
  const outPath = join(outputDir, basename(file));
  console.log(`A optimizar ${file}...`);
  execFileSync(
    'npx',
    [
      '@gltf-transform/cli',
      'optimize',
      inPath,
      outPath,
      '--compress',
      'draco',
      '--texture-compress',
      'webp',
      '--texture-size',
      '1024',
    ],
    { stdio: 'inherit', shell: true }
  );
}

console.log('Optimização de modelos 3D concluída.');

