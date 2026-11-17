import fs from 'node:fs';
import path from 'node:path';

export function resolvePublicFile(projectRoot, pathname) {
  let relative;
  try { relative = decodeURIComponent(pathname); } catch { return null; }
  if (relative.includes('\\') || relative.includes('\0')) return null;
  if (relative.split('/').some((part) => part.startsWith('.'))) return null;
  if (relative === '/') relative = '/index.html';
  for (const folder of ['dist', 'public']) {
    try {
      const root = fs.realpathSync(path.join(projectRoot, folder));
      const file = fs.realpathSync(path.resolve(root, '.' + relative));
      const inside = path.relative(root, file);
      if (!inside || inside.split(path.sep).some((part) => part.startsWith('.')) || path.isAbsolute(inside)) continue;
      if (fs.statSync(file).isFile()) return file;
    } catch { /* missing file, or broken symlink */ }
  }
  return null;
}
