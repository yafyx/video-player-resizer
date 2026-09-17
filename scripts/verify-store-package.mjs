import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(process.argv[2] ?? join(projectRoot, '.output', 'chrome-mv3'));
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function readPngDimensions(filePath) {
  const bytes = readFileSync(filePath);
  const signature = '89504e470d0a1a0a';
  const validHeader = bytes.subarray(0, 8).toString('hex') === signature;
  check(validHeader, `${relative(projectRoot, filePath)} is not a PNG`);
  check(bytes.length >= 26, `${relative(projectRoot, filePath)} is too small to be a PNG`);
  if (!validHeader || bytes.length < 26) return { width: 0, height: 0, colorType: -1 };
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes[25],
  };
}

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(path));
    else files.push(path);
  }
  return files;
}

const packageJsonPath = join(projectRoot, 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
check(packageJson.name === 'video-player-resizer', 'package.json must use the product name, not the WXT starter name');
check(typeof packageJson.version === 'string' && /^\d+\.\d+\.\d+$/.test(packageJson.version), 'package.json must use a release semver');
check(packageJson.description === 'Resize the video on any page by dragging its edges.', 'package.json description is not the product description');

const manifestPath = join(outputRoot, 'manifest.json');
check(existsSync(manifestPath), `missing generated manifest at ${relative(projectRoot, manifestPath)}`);

if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  check(manifest.manifest_version === 3, 'generated package must use Manifest V3');
  check(manifest.name === 'Video Player Resizer', 'manifest name is not the product name');
  check(typeof manifest.description === 'string' && manifest.description.length > 0, 'manifest description is required');
  check(manifest.description.length <= 132, 'manifest description must be 132 characters or fewer');
  check(manifest.version === packageJson.version, 'manifest version does not match package.json');
  check(manifest.background?.service_worker === 'background.js', 'background service worker is missing');
  check(manifest.action && !('default_popup' in manifest.action), 'action must remain page-less so action clicks reach the active tab');
  check(JSON.stringify(manifest.permissions ?? []) === JSON.stringify(['storage']), 'manifest permissions must stay limited to storage');
  check(!manifest.host_permissions || manifest.host_permissions.length === 0, 'host_permissions duplicates the static content-script match and broadens the request surface');

  const contentScript = manifest.content_scripts?.find((entry) => entry.js?.length);
  check(contentScript?.matches?.includes('<all_urls>'), 'the content script must match all web pages for player detection');
  const iconResources = manifest.web_accessible_resources?.some(
    (entry) => entry.resources?.includes('icon/32.png') && entry.matches?.includes('<all_urls>'),
  );
  check(iconResources, 'the toolbar icon must remain a web-accessible resource');

  const expectedIcons = { 16: 16, 32: 32, 48: 48, 96: 96, 128: 128 };
  for (const [name, size] of Object.entries(expectedIcons)) {
    const iconPath = join(outputRoot, 'icon', `${name}.png`);
    check(existsSync(iconPath), `missing ${name}px extension icon`);
    if (existsSync(iconPath)) {
      const png = readPngDimensions(iconPath);
      check(png.width === size && png.height === size, `${relative(projectRoot, iconPath)} must be ${size}x${size}`);
      if (size === 128) check(png.colorType === 4 || png.colorType === 6, '128px icon must retain an alpha channel');
    }
  }
}

const packageFiles = walkFiles(outputRoot);
for (const filePath of packageFiles) {
  const relativePath = relative(outputRoot, filePath);
  check(!relativePath.endsWith('wxt.svg'), 'starter asset wxt.svg must not ship in the extension package');
  check(!relativePath.endsWith('.map'), `source map must not ship in the extension package: ${relativePath}`);
  check(!relativePath.includes('node_modules'), `node_modules must not ship in the extension package: ${relativePath}`);
  check(!relativePath.includes('.DS_Store'), `Finder metadata must not ship in the extension package: ${relativePath}`);
}

const storeAssetsRoot = join(projectRoot, 'store-assets');
const storeAssets = walkFiles(storeAssetsRoot).filter((filePath) => filePath.toLowerCase().endsWith('.png'));
check(storeAssets.length > 0, 'at least one Chrome Web Store screenshot is required in store-assets/');
for (const filePath of storeAssets) {
  const { width, height } = readPngDimensions(filePath);
  const validSize = (width === 1280 && height === 800) || (width === 640 && height === 400);
  check(validSize, `${relative(projectRoot, filePath)} must be 1280x800 or 640x400 (found ${width}x${height})`);
}

if (failures.length > 0) {
  console.error('Store package verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Store package verified: ${relative(projectRoot, outputRoot)}`);
  console.log(`- ${storeAssets.length} screenshot${storeAssets.length === 1 ? '' : 's'} at an accepted Chrome Web Store size`);
  console.log('- Manifest V3, product metadata, permissions, icons, and starter-file cleanup are valid');
}
