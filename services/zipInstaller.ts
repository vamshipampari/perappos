/**
 * ZIP extraction and local bundle installation for the Add App screen.
 *
 * Reads a ZIP file from the filesystem, extracts it to the app's document
 * directory, rewrites absolute paths in index.html, and returns a ParsedBundle
 * ready for insertion into the apps database table.
 */

import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { Alert } from 'react-native';

import { extractTitle, isBinaryExt } from '@/services/urlFetcher';

export const BUNDLE_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB

export interface ParsedBundle {
  appId: string;
  html: string | null;
  name: string;
  hash: string | null;
  size: number;
  sourceType: 'url' | 'zip';
  sourceUrl?: string;
  /** Filesystem path WITHOUT file:// prefix and WITHOUT trailing slash. */
  bundlePath: string;
}

export async function extractAndBundle(
  fileUri: string,
  appId: string,
  onStatus: (s: string) => void
): Promise<ParsedBundle> {
  const JSZip = (await import('jszip')).default;

  onStatus('Reading ZIP…');
  const b64 = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  onStatus('Extracting…');
  const zip = await JSZip.loadAsync(b64, { base64: true });

  // Locate index.html (root or one directory level deep)
  let indexEntry = zip.file('index.html') as import('jszip').JSZipObject | null;
  if (!indexEntry) {
    zip.forEach((path, file) => {
      if (!indexEntry && !file.dir && /^[^/]+\/index\.html$/i.test(path)) {
        indexEntry = file;
      }
    });
  }
  if (!indexEntry) throw new Error('No index.html found in this ZIP');

  const rawIndex = await (indexEntry as import('jszip').JSZipObject).async('string');
  const detectedName = extractTitle(rawIndex) || 'My App';

  // If ZIP nests everything inside a single directory (e.g. myapp/index.html),
  // strip that prefix so {appDir}/index.html is at the root.
  const indexPath: string = (indexEntry as any).name ?? 'index.html';
  const indexDir = indexPath.includes('/')
    ? indexPath.slice(0, indexPath.lastIndexOf('/') + 1)
    : '';

  const appDir = `${FileSystem.documentDirectory}apps/${appId}/`;
  await FileSystem.makeDirectoryAsync(appDir, { intermediates: true });

  // Write all ZIP entries to filesystem
  let totalSize = rawIndex.length;
  const writeTasks: Promise<void>[] = [];

  zip.forEach((relativePath, file) => {
    if (file.dir) return;

    // Normalise path — strip the indexDir prefix if present
    const normalised =
      indexDir && relativePath.startsWith(indexDir)
        ? relativePath.slice(indexDir.length)
        : relativePath;

    if (!normalised) return;

    const isBin = isBinaryExt(normalised);
    const localPath = `${appDir}${normalised}`;
    const dir = localPath.slice(0, localPath.lastIndexOf('/') + 1);

    writeTasks.push(
      (isBin
        ? file.async('base64' as any)
        : file.async('string' as any)
      )
        .then(async (content: string) => {
          totalSize += content.length;
          await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
          await FileSystem.writeAsStringAsync(localPath, content, {
            encoding: isBin
              ? FileSystem.EncodingType.Base64
              : FileSystem.EncodingType.UTF8,
          });
        })
        .catch(() => {})
    );
  });

  onStatus('Writing files…');
  await Promise.all(writeTasks);

  // Rewrite absolute paths in index.html so they resolve against file://
  //   src="/assets/x.js"  →  src="./assets/x.js"
  //   href="/assets/x.css" → href="./assets/x.css"
  let modifiedHtml = rawIndex
    .replace(/\bsrc="\/(?!\/)/g, 'src="./')
    .replace(/\bsrc='\/(?!\/)/g, "src='./")
    .replace(/\bhref="\/(?!\/)/g, 'href="./')
    .replace(/\bhref='\/(?!\/)/g, "href='./");

  await FileSystem.writeAsStringAsync(`${appDir}index.html`, modifiedHtml, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (totalSize > BUNDLE_SIZE_LIMIT) {
    Alert.alert(
      'Large ZIP',
      `This ZIP is ${(totalSize / 1024 / 1024).toFixed(1)} MB. App installed but performance may be affected.`,
      [{ text: 'OK' }]
    );
  }

  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawIndex
  );

  return {
    appId,
    html: modifiedHtml,
    name: detectedName,
    hash,
    size: totalSize,
    sourceType: 'zip',
    bundlePath: appDir.replace(/^file:\/\//, '').replace(/\/$/, ''),
  };
}
