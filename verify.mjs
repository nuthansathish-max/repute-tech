import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const required = ['server.js','bootstrap.js','index.html','schema.prisma','package.json','auth.js','ai.js','aiProvider.js','google.js','whatsapp.js','reviewPipeline.js','scheduler.js','customerJourney.js','seed.js'];
for (const file of required) if (!fs.existsSync(path.join(root,file))) throw new Error(`Missing required file: ${file}`);
const jsFiles = required.filter(f => f.endsWith('.js')).concat(['verify.mjs']);
const importRe = /(?:from|import\()\s*["'](\.[^"']+\.js)["']/g;
const missingImports=[];
for (const file of jsFiles) {
  const text=fs.readFileSync(path.join(root,file),'utf8');
  let m;
  while ((m=importRe.exec(text))) {
    const target=path.resolve(root,path.dirname(file),m[1]);
    if (!fs.existsSync(target)) missingImports.push(`${file} -> ${m[1]}`);
  }
}
if (missingImports.length) throw new Error(`Missing local imports: ${missingImports.join(', ')}`);
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if (pkg.scripts?.build !== 'prisma generate --schema=./schema.prisma && prisma db push --schema=./schema.prisma') throw new Error('Unexpected build script');
if (pkg.scripts?.start !== 'node bootstrap.js') throw new Error('Unexpected start script: auth bootstrap must run before server.js');
console.log('repute-tech.in deployment package verification passed.');
console.log(`Required files: ${required.length}`);
console.log('Local module imports: OK');
console.log('Render build/start scripts: OK');
console.log('Auth bootstrap: OK');
