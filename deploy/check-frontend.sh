#!/usr/bin/env bash
# 前端构建产物体检：① script 标签配对  ② JS 语法。
# 目的：一旦页面结构/语法坏了就直接让构建失败，避免发布「打不开」的页面。
# 用法： bash deploy/check-frontend.sh [html文件]
# 约定：<script> / </script> 必须顶格单独成行。
set -euo pipefail
cd "$(dirname "$0")/.."

F="${1:-deploy/frontend-built/teacher-dashboard.html}"
if [ ! -f "$F" ]; then echo "✗ 找不到文件：$F" >&2; exit 1; fi

fail=0

# ① script 标签配对（只统计顶格标签，避开注释里的示例文本）
total_open=$(grep -c '^<script' "$F" || true)
inline=$(grep '^<script' "$F" | grep -c '</script>' || true)
open=$((total_open - inline))
close=$(grep -c '^</script>' "$F" || true)
if [ "$open" -ne "$close" ]; then
  echo "✗ script 标签不配对：<script>=$open  </script>=$close —— 主脚本很可能未闭合！" >&2
  fail=1
else
  echo "✓ script 标签配对 OK：<script>=$open  </script>=$close"
fi

# ② JS 语法检查（本机有 node 时执行）
if command -v node >/dev/null 2>&1; then
  node deploy/check-frontend.js "$F" || fail=1
else
  echo "⚠ 未检测到 node，跳过 JS 语法检查（已做标签配对检查）"
fi

if [ "$fail" -ne 0 ]; then
  echo "" >&2
  echo "✗✗ 前端体检未通过 —— 已阻止发布。请修复后再构建。" >&2
  exit 1
fi
echo "✓ 前端体检全部通过，可安全发布"
