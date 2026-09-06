#!/usr/bin/env bash
# 成长星球·服务器重新部署脚本
# 场景：服务器上已有旧部署（非 git 仓库或代码过时），需要替换为最新版
# 保留：postgres 数据、SSL 证书
# 用法：在服务器上执行 bash deploy/server-redeploy.sh
set -euo pipefail

OLD_DIR="/opt/growth-planet"
NEW_DIR="/opt/growth-planet-new"
REPO_URL="https://github.com/kendra-KD/Primary-school-teaching-aids.git"
NGINX_CONF="/etc/nginx/conf.d/growth-planet.conf"

echo "=== 1. 备份 postgres 数据和 SSL 证书 ==="
cp -r "$OLD_DIR/deploy/data" /opt/gp-data-bak
cp -r "$OLD_DIR/deploy/certs" /opt/gp-certs-bak
echo "✓ 已备份到 /opt/gp-data-bak 和 /opt/gp-certs-bak"

echo "=== 2. clone 最新仓库 ==="
rm -rf "$NEW_DIR"
git clone "$REPO_URL" "$NEW_DIR"
echo "✓ 已 clone 到 $NEW_DIR"

echo "=== 3. 恢复数据和证书到新目录 ==="
cp -r /opt/gp-data-bak "$NEW_DIR/deploy/data"
cp -r /opt/gp-certs-bak "$NEW_DIR/deploy/certs"
echo "✓ 数据和证书已恢复"

echo "=== 4. 构建前端 ==="
cd "$NEW_DIR"
bash deploy/build-frontend.sh

echo "=== 5. 验证构建产物 ==="
echo "frontend-built 目录内容："
ls -la deploy/frontend-built/
# 确认关键文件存在
if [ ! -f "deploy/frontend-built/teacher-dashboard.html" ]; then
  echo "✗ 错误：teacher-dashboard.html 未构建出来，检查 frontend/ 目录是否有该文件"
  exit 1
fi
echo "✓ teacher-dashboard.html 已构建"

echo "=== 6. 更新 nginx 配置 root 指向 ==="
# 备份旧 nginx 配置
cp "$NGINX_CONF" "${NGINX_CONF}.bak.$(date +%s)"
# 替换 root 指向新目录
sudo sed -i "s|root .*;|root $NEW_DIR/deploy/frontend-built;|" "$NGINX_CONF"
# 确认 index 行包含 teacher-dashboard.html
if ! grep -q "teacher-dashboard.html" "$NGINX_CONF"; then
  sudo sed -i "s|index index.html;|index index.html teacher-dashboard.html;|" "$NGINX_CONF"
fi
echo "✓ nginx 配置已更新"
echo "--- 当前 nginx 配置 ---"
cat "$NGINX_CONF"

echo "=== 7. 测试并重载 nginx ==="
sudo nginx -t && sudo nginx -s reload
echo "✓ nginx 已重载"

echo "=== 8. 验证前端可访问 ==="
curl -s -o /dev/null -w "HTTP %{http_code}" http://127.0.0.1/teacher-dashboard.html
echo ""
echo "✓ 部署完成！"
echo ""
echo "下一步："
echo "  1. 用无痕窗口访问 http://39.102.215.224 看登录按钮"
echo "  2. 确认后删除旧目录：rm -rf $OLD_DIR"
echo "  3. 重命名新目录：mv $NEW_DIR $OLD_DIR && sudo sed -i 's|$NEW_DIR|$OLD_DIR|g' $NGINX_CONF && sudo nginx -s reload"
echo "  4. 重启后端服务（如果后端从旧目录启动的话）"
