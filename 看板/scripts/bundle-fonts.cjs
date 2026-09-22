'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'fonts');
fs.mkdirSync(output, { recursive: true });
const sources = [
  ['@fontsource-variable/hanken-grotesk','hanken-grotesk-latin-wght-normal.woff2','Hanken Grotesk','100 900'],
  ['@fontsource-variable/manrope','manrope-latin-wght-normal.woff2','Manrope','200 800'],
  ['@fontsource-variable/jetbrains-mono','jetbrains-mono-latin-wght-normal.woff2','JetBrains Mono','100 800'],
  ['@fontsource/material-symbols-outlined','material-symbols-outlined-latin-400-normal.woff2','Material Symbols Outlined','400'],
];
let css = '/* Self-hosted SIL Open Font License fonts; see fonts/*-LICENSE.txt. */\n';
for (const [pkg, file, family, weight] of sources) {
  const source = path.join(root, 'node_modules', pkg);
  fs.copyFileSync(path.join(source,'files',file),path.join(output,file));
  fs.copyFileSync(path.join(source,'LICENSE'),path.join(output,`${pkg.split('/').pop()}-LICENSE.txt`));
  css += `@font-face{font-family:'${family}';font-style:normal;font-display:swap;font-weight:${weight};src:url('/fonts/${file}') format('woff2')}\n`;
}
css += ".material-symbols-outlined{font-family:'Material Symbols Outlined';font-weight:normal;font-style:normal;font-size:24px;line-height:1;letter-spacing:normal;text-transform:none;display:inline-block;white-space:nowrap;word-wrap:normal;direction:ltr;-webkit-font-feature-settings:'liga';font-feature-settings:'liga';-webkit-font-smoothing:antialiased}\n";
fs.writeFileSync(path.join(root,'fonts.css'),css);
