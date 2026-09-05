# 成长星球 · 科学班生态（Primary-school-teaching-aids）

小学科学课堂辅助工具：每个孩子认领一个"生命伙伴"，全班伙伴组成一颗"生态星球"。
老师在课堂上即时点评（点伙伴 → 点科学标签，两步完成），伙伴当场产生生态反馈（开花 / 发光 / 长叶 / 藤蔓 / 进化）。

差异化护城河：**12 条科学学科专属行为标签**（提出好问题 / 观察记录 / 爱护实验生物 / 整理器材 / 工程制作 / 长期观察）——这些是希沃、ClassDojo 等通用积分工具记不下来的。

## 目录结构

```
design/    产品设计文档（需求调研、最终报告、访谈提纲、试用验证包、伙伴自选设计、年级偏好调研）
frontend/  老师大屏驾驶舱高保真原型 HTML（自包含，双击即用）+ 伙伴自选演示 HTML
server/    后端 API（Node 22 + Fastify 5 + Postgres）
deploy/    docker-compose、初始化 SQL、Nginx 配置、.env 样例
```

## 当前进展

- ✅ Phase 0–1：需求调研 + 老师大屏高保真原型（含花名册管理、班级切换）
- ✅ 伙伴自选设计（1–6 年级分层主题包，原创形象无版权风险）
- ✅ 后端 API：老师账号 / 班级 / 花名册 / 科学点评 / 全班实时状态 / 撤销点评
- ✅ 前端云同步层：配置 `GP_API_BASE` 后跨设备同步，未配置则纯本地运行
- ⏳ 学生端轻网页（入班码认领伙伴）待开发
- ⏳ 真实老师试用验证（见 `design/growth-planet-老师试用验证包.md`）

## 本地预览（不装任何东西）

直接双击 `frontend/growth-planet-老师大屏原型.html`，F11 全屏。
此时数据只存浏览器 localStorage，换电脑不同步——适合演示与验证。

## 后端本地启动

前置：一个 Postgres 实例（推荐用 `deploy/` 的 compose 起 gp-db），Node 20+。

```bash
docker compose -f deploy/growth-planet-docker-compose.yml up -d gp-db
docker exec -i gp-db psql -U gp_app -d growth_planet < deploy/growth-planet-init.sql

cd server
cp ../deploy/.env.example .env      # 改 DB_PASSWORD / JWT_SECRET
npm install
npm run dev                          # http://127.0.0.1:3100/api/health
```

首位老师账号（生产环境 `ALLOW_REGISTER=false`，只能这样建号）：

```bash
node scripts/create-teacher.js teacher@school.edu 初始密码 科学老师
```

## 前端接后端

源码用占位符 `__GP_API_BASE__` 标记 API 地址，**部署时用构建脚本注入**，不要手改源码：

```bash
bash deploy/build-frontend.sh            # 同域模式（Nginx 反代 /api，推荐，免跨域）
bash deploy/build-frontend.sh https://gp.example.com   # 或显式跨域地址
```

构建产物在 `deploy/frontend-built/`。未构建的源文件双击仍走纯本地 localStorage。
刷新后右下角出现「☁ 登录同步」，登录后班级数据从服务端加载、点评实时写库，多设备一致；
不登录或服务端不可达时自动退回本地 localStorage，课堂弱网也能继续用。

## API 一览

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/register` | 注册（`ALLOW_REGISTER=false` 时关闭） |
| POST | `/api/auth/login` | 登录，返回 JWT |
| GET | `/api/me` | 当前老师 |
| GET/POST | `/api/classes` | 班级列表 / 建班 |
| PUT/DELETE | `/api/classes/:id` | 改班 / 删班 |
| GET/POST | `/api/classes/:id/students` | 花名册 / 批量导入 |
| PUT/DELETE | `/api/students/:id` | 改名换伙伴 · `care:true` 照料恢复 / 删除 |
| GET | `/api/labels` | 12 条科学标签字典 |
| POST | `/api/events` | 提交点评（分值由服务端决定，前端不可传分） |
| DELETE | `/api/events/:id` | 撤销点评（课堂点错刚需） |
| GET | `/api/classes/:id/state` | 全班实时状态：伙伴墙 + 光荣榜 + 进度环 |
| GET | `/api/health` | 健康检查 |

## 部署到服务器（Docker 一键）

前置：服务器装好 Docker + compose 插件；域名 A 记录指向本机公网 IP；80/443 端口空闲。

```bash
# 在仓库根目录执行，自动完成：生成随机密钥 .env → 构建前端 → 自签证书 → 起 gp-db+gp-api+gp-web
bash deploy/deploy.sh

# 创建首位老师账号（生产 ALLOW_REGISTER=false，只能这样建号）
docker exec -it gp-api node scripts/create-teacher.js 老师邮箱 密码 姓名
```

部署后访问 `https://<你的域名>`。首次用自签证书浏览器会提示“不安全”，属正常；
按 `deploy/deploy.sh` 末尾指引用 certbot 换 Let's Encrypt 正式证书即可消除。
常用命令：

```bash
docker compose -f deploy/growth-planet-docker-compose.yml logs -f   # 看日志
docker compose -f deploy/growth-planet-docker-compose.yml down       # 停止
```

## 安全与合规红线（上线前必读）

- **密钥绝不进 Git**：`.env`、`deploy/certs/`、`deploy/frontend-built/` 已在 `.gitignore`。
- **数据最小化**：当前只存学生姓名 + 课堂行为，不采集手机号等隐私；涉及未成年，正式面向学校使用前建议补一份《隐私政策》并在 `deploy/growth-planet-nginx.conf` 加 Cookie/隐私提示。
- **登录鉴权**：所有写接口需 JWT；公开注册默认关闭，账号只经 `create-teacher.js` 创建。
- **生产操作先备份**：`deploy/data/postgres` 是数据库卷，定期备份；误删容器数据不回滚。
- 详细架构与备份/监控/扩容见 `deploy/growth-planet-backend-架构与部署方案.md`。
