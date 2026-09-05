#!/usr/bin/env bash
# 成长星球·科学班生态 —— 一键部署（Docker）
# 在仓库根目录执行： bash deploy/deploy.sh
# 前置：Docker + compose 插件已装；域名 A 记录已指向本机公网 IP；80/443 空闲。
# 说明：首次用自签证书，浏览器会提示“不安全”，属正常；按末尾指引换 Let's Encrypt 正式证书。
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "✗ 未检测到 Docker，请先安装：https://docs.docker.com/get-docker/" >&2; exit 1
fi

# 1. 生成 .env（含随机密钥）若尚未存在
if [ ! -f deploy/.env ]; then
  JWT=$(openssl rand -hex 32)
  DBP=$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 24)
  cat > deploy/.env <<EOF
DB_PASSWORD=$DBP
DB_HOST=gp-db
DB_PORT=5432
DB_NAME=growth_planet
DB_USER=gp_app
PORT=3100
NODE_ENV=production
JWT_SECRET=$JWT
JWT_EXPIRES_IN=30d
ALLOW_REGISTER=false
LOG_LEVEL=info
API_BASE=
EOF
  echo "✓ 已生成 deploy/.env（密钥随机，请妥善保管，切勿提交到 Git）"
fi

# 2. 构建前端（同域模式，由 Nginx 反代 /api）
bash deploy/build-frontend.sh

# 3. 自签证书（仅首跑；之后可换 Let's Encrypt）
if [ ! -f deploy/certs/fullchain.pem ]; then
  mkdir -p deploy/certs
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout deploy/certs/privkey.pem \
    -out deploy/certs/fullchain.pem \
    -days 365 -subj "/CN=localhost" >/dev/null 2>&1
  echo "✓ 已生成自签证书 deploy/certs（浏览器会提示不安全，属正常）"
fi

# 4. 启动全部服务
docker compose -f deploy/growth-planet-docker-compose.yml up -d --build

# 5. 等数据库健康
echo "… 等待数据库就绪"
for i in $(seq 1 30); do
  if docker exec gp-db pg_isready -U gp_app -d growth_planet >/dev/null 2>&1; then break; fi
  sleep 2
done

# 6. 初始化表结构（幂等，可重复执行）
docker exec -i gp-db psql -U gp_app -d growth_planet < deploy/growth-planet-init.sql

echo
echo "==================== 部署完成 ===================="
echo "访问： https://<你的域名>"
echo
echo "创建首位老师账号："
echo "  docker exec -it gp-api node scripts/create-teacher.js 老师邮箱 密码 姓名"
echo
echo "【重要】换正式 HTTPS 证书（去掉浏览器“不安全”提示）："
echo "  1) 在 deploy/growth-planet-docker-compose.yml 的 gp-web 里把 ./certs 换成 ./letsencrypt"
echo "  2) 在本机执行："
echo "     sudo certbot certonly --webroot -w deploy/certbot -d <你的域名>"
echo "     sudo cp /etc/letsencrypt/live/<你的域名>/fullchain.pem deploy/letsencrypt/"
echo "     sudo cp /etc/letsencrypt/live/<你的域名>/privkey.pem  deploy/letsencrypt/"
echo "  3) 重启： docker compose -f deploy/growth-planet-docker-compose.yml restart gp-web"
echo
echo "查看日志： docker compose -f deploy/growth-planet-docker-compose.yml logs -f"
