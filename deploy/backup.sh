#!/usr/bin/env bash
# 成长星球 · 数据库定时备份脚本
# 用法：crontab -e → 0 3 * * * /opt/growth-planet-new/deploy/backup.sh
set -euo pipefail

BACKUP_DIR="/opt/growth-planet-new/backups"
DB_CONTAINER="gp-db"
DB_USER="gp_app"
DB_NAME="growth_planet"
RETENTION_DAYS=14

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="gp_backup_${TIMESTAMP}.sql.gz"
FILEPATH="${BACKUP_DIR}/${FILENAME}"

echo "[$(date)] 开始备份 → ${FILENAME}"

docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" --no-owner --no-privileges | gzip > "$FILEPATH"

SIZE=$(du -h "$FILEPATH" | cut -f1)
echo "[$(date)] 备份完成: ${FILENAME} (${SIZE})"

# 清理超过保留期的旧备份
DELETED=$(find "$BACKUP_DIR" -name "gp_backup_*.sql.gz" -mtime +${RETENTION_DAYS} -delete -print | wc -l)
if [ "$DELETED" -gt 0 ]; then
  echo "[$(date)] 清理 ${DELETED} 个超过 ${RETENTION_DAYS} 天的旧备份"
fi

echo "[$(date)] 备份任务结束"
