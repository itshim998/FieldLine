import fs from 'node:fs';
import path from 'node:path';

const srcDir = path.resolve(process.cwd(), 'backend/src/ml/artifacts');
const destDir = path.resolve(process.cwd(), 'dist/backend/src/ml/artifacts');

if (fs.existsSync(srcDir)) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of fs.readdirSync(srcDir)) {
    if (file.endsWith('.json')) {
      fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    }
  }
}
