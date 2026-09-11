#!/usr/bin/env bash
# 成长星球 · 数据库恢复脚本
# 用法：./restore.sh gp_backup_20260911_030001.sql.gz
# 或列出可用备份：./restore.sh --list
set -euo pipefail

BACKUP_DIR="/opt/growth-planet-new/backups"
DB_CONTAINER="gp-db"
DB_USER="gp_app"
DB_NAME="growth_planet"

if [ "${1:-}" = "--list" ]; then
  echo "可用备份："
  ls -lh "$BACKUP_DIR"/gp_backup_*.sql.gz 2>/dev/null || echo "  （无备份）"
  exit 0
fi

FILE="${1:-}"
if [ -z "$FILE" ]; then
  echo "用法：$0 <备份文件名> 或 $0 --list"
  echo "示例：$0 gp_backup_20260911_030001.sql.gz"
  exit 1
fi

FILEPATH="${BACKUP_DIR}/${FILE}"
if [ ! -f "$FILEPATH" ]; then
  echo "❌ 备份文件不存在：${FILEPATH}"
  echo "可用备份："
  ls -lh "$BACKUP_DIR"/gp_backup_*.sql.gz 2>/dev/null
  exit 1
fi

echo "⚠️  即将从 ${FILE} 恢复数据库，当前数据将被覆盖！"
read -p "确认恢复？输入 yes 继续：" CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "已取消"
  exit 0
fi

echo "[$(date)] 开始恢复..."
gunzip -c "$FILEPATH" | docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" 2>&1

echo "[$(date)] 恢复完成。建议执行 health check 确认数据完整性。"
