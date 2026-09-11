// 前端 HTML 产物体检：提取 <script> 块并做 JS 语法检查，同时校验标签闭合。
// 用法： node deploy/check-frontend.js <html文件>
// 约定：<script> / </script> 必须顶格单独成行（本项目单文件前端约定）。
const fs = require('fs');

const f = process.argv[2];
if (!f) { console.error('用法：node deploy/check-frontend.js <html文件>'); process.exit(2); }

const lines = fs.readFileSync(f, 'utf8').split('\n');
let depth = 0, start = 0, bad = 0;
const blocks = [];

lines.forEach((l, i) => {
  if (/^<script[^>]*>.*<\/script>/.test(l)) return;            // 同行自闭合，如 API_BASE
  if (/^<script/.test(l)) { depth++; if (depth === 1) start = i + 1; }
  else if (/^<\/script>/.test(l)) {
    if (depth === 1) blocks.push([start, i]);                  // 主块结束
    depth = Math.max(0, depth - 1);
  }
});

if (depth !== 0) {
  console.error(`✗ <script> 未闭合：还有 ${depth} 个未配对（主脚本可能吞掉了后续内容）`);
  process.exit(1);
}

blocks.forEach(([a, b], k) => {
  const code = lines.slice(a, b).join('\n');
  try {
    new Function(code);
    console.log(`✓ script#${k + 1} L${a + 1}-${b} 语法 OK`);
  } catch (e) {
    bad++;
    console.error(`✗ script#${k + 1} L${a + 1}-${b} 语法错误：${e.message}`);
  }
});

if (bad) { console.error(`✗ 有 ${bad} 个 <script> 存在语法错误`); process.exit(1); }
console.log(`✓ 全部 ${blocks.length} 个 <script> 语法通过`);
