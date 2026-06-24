import fs from "node:fs/promises";
import path from "node:path";
import pngToIco from "png-to-ico";

const root = path.resolve(process.cwd());
const inputs = [
  {
    source: path.join(root, ".codex-temp/favorites/icons8-shark-1-100.png"),
    output: path.join(root, "src-tauri/icons/tray-disconnected.ico"),
  },
  {
    source: path.join(root, ".codex-temp/favorites/icons8-shark-100.png"),
    output: path.join(root, "src-tauri/icons/tray-connected.ico"),
  },
  {
    source: path.join(root, ".codex-temp/favorites/icons8-shark-100.png"),
    output: path.join(root, "src-tauri/icons/icon.ico"),
  },
];

const cleanupTargets = [
  path.join(root, "src-tauri/icons/32x32.png"),
  path.join(root, "src-tauri/icons/128x128.png"),
  path.join(root, "src-tauri/icons/128x128@2x.png"),
  path.join(root, "src-tauri/icons/icon.png"),
  path.join(root, "src-tauri/icons/iconB.ico"),
  path.join(root, "src-tauri/icons/tray-connected.png"),
  path.join(root, "src-tauri/icons/tray-disconnected.png"),
  path.join(root, "src-tauri/icons/tray-disconnectedddd.png"),
];

for (const item of inputs) {
  const buffer = await fs.readFile(item.source);
  const ico = await pngToIco(buffer);
  await fs.writeFile(item.output, ico);
  console.log(`wrote ${path.relative(root, item.output)}`);
}

for (const target of cleanupTargets) {
  try {
    await fs.unlink(target);
    console.log(`removed ${path.relative(root, target)}`);
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
  }
}
