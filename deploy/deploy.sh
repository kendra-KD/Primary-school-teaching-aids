#!/usr/bin/env bash
# 成长星球·科学班生态 —— 一键部署（Docker）
# 在仓库根目录执行： bash deploy/deploy.sh
# 前置：Docker + compose 插件已装；本机 80/443 由【宿主 Nginx】占用（不冲突）。
# 说明：前端静态托管与 /api 反代由宿主 Nginx 负责，见 deploy/nginx/host-gateway.example.conf。
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

# 2. 构建前端（同域模式，由宿主 Nginx 反代 /api）
bash deploy/build-frontend.sh

# 3. 启动后端 + 数据库（不含 Web，Web 由宿主 Nginx 负责）
docker compose -f deploy/growth-planet-docker-compose.yml up -d --build

# 4. 等数据库健康
echo "… 等待数据库就绪"
for i in $(seq 1 30); do
  if docker exec gp-db pg_isready -U gp_app -d growth_planet >/dev/null 2>&1; then break; fi
  sleep 2
done

# 5. 初始化表结构（幂等，可重复执行）
docker exec -i gp-db psql -U gp_app -d growth_planet < deploy/growth-planet-init.sql

echo
echo "==================== 部署完成 ===================="
echo "【还需一步】配置宿主 Nginx（本机 80/443 已在用，故由宿主 Nginx 反代）："
echo "  1) sudo cp deploy/nginx/host-gateway.example.conf /etc/nginx/conf.d/growth-planet.conf"
echo "  2) 编辑该文件，把 __DOMAIN__ 改成你的真实域名（先用 IP 可写 _ ）"
echo "  3) sudo nginx -t && sudo nginx -s reload"
echo
echo "创建首位老师账号："
echo "  docker exec -it gp-api node scripts/create-teacher.js 老师邮箱 密码 姓名"
echo
echo "【重要】换正式 HTTPS 证书（去掉浏览器“不安全”提示）："
echo "  见 host-gateway.example.conf 末尾被注释的 443 server 块 + certbot 指引"
echo
echo "查看日志： docker compose -f deploy/growth-planet-docker-compose.yml logs -f"
