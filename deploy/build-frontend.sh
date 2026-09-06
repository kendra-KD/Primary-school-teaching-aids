#!/usr/bin/env bash
# 构建前端：把 GP_API_BASE 占位符替换为部署地址
# 用法：bash deploy/build-frontend.sh [API_BASE]
#   API_BASE 留空 = 同域 HTTPS（由 Nginx 反代 /api，推荐，免跨域）
#   跨域示例： bash deploy/build-frontend.sh https://gp.example.com
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="frontend"
OUT="deploy/frontend-built"
API_BASE="${1:-}"   # 默认空串 = 同域

mkdir -p "$OUT"
for f in "teacher-dashboard.html" "index.html" "partner-demo.html"; do
  if [ -f "$SRC/$f" ]; then
    # 只替换赋值语句 window.GP_API_BASE='__GP_API_BASE__' → window.GP_API_BASE=''
    # 不用全局替换，否则检查语句 if(GP_API==='__GP_API_BASE__') 也会被替换导致 GP_CLOUD 恒为 false
    sed "s/window\.GP_API_BASE *= *'__GP_API_BASE__'/window.GP_API_BASE = '${API_BASE}'/g" "$SRC/$f" > "$OUT/$f"
  fi
done
echo "✓ 前端已构建到 $OUT （GP_API_BASE='${API_BASE:-同域}'）"
