import fs from 'node:fs';
import path from 'node:path';

const PUBLIC_FOLDERS = ['dist', 'public'];
const DEFAULT_INDEX_PATH = '/index.html';

function hasHiddenOrTraversalSegment(segments) {
  return segments.some((part) => part.startsWith('.'));
}

function resolveFileInFolder(projectRoot, folder, relativePath) {
  try {
    const root = fs.realpathSync(path.join(projectRoot, folder));
    const candidate = fs.realpathSync(path.resolve(root, `.${relativePath}`));
    const inside = path.relative(root, candidate);

    if (
      !inside ||
      path.isAbsolute(inside) ||
      hasHiddenOrTraversalSegment(inside.split(path.sep))
    ) {
      return null;
    }

    return fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Resolves a request pathname safely against published dist/ and public/ roots.
 */
export function resolvePublicFile(projectRoot, pathname) {
  let relative;
  try {
    relative = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (relative.includes('\\') || relative.includes('\0')) {
    return null;
  }
  if (hasHiddenOrTraversalSegment(relative.split('/'))) {
    return null;
  }

  const targetPath = relative === '/' ? DEFAULT_INDEX_PATH : relative;
  for (const folder of PUBLIC_FOLDERS) {
    const resolved = resolveFileInFolder(projectRoot, folder, targetPath);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}
