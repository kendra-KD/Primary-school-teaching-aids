#!/usr/bin/env node
// 部署前语法自检：递归检查 src/ 与 scripts/ 下所有 JS 文件
// 用法：cd server && npm run check   （失败时退出码 1，可用于 CI 阻断）
import { readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js') || p.endsWith('.mjs')) files.push(p);
  }
}

for (const root of ['src', 'scripts']) {
  try {
    walk(root);
  } catch {
    // 目录不存在则跳过
  }
}

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`OK   ${file}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${file}`);
    console.error(err.stderr?.toString() || err.message);
  }
}

console.log(`\n${files.length - failed}/${files.length} 个文件语法检查通过`);
process.exit(failed > 0 ? 1 : 0);
