# 成长星球·科学班生态 —— 后端架构与部署方案

> 面向场景：小学科学老师，任教多个班级，需在**多台设备 / 多个教室共用同一份数据**。
> 方案目标：**轻量、低成本、可托管到现有阿里云服务器、独立 Postgres 实例（不污染 umami-db / eat-what）、为后续学生端预留 API**。
>
> ⚠️ **重要修订（2026-08-24）**：原方案建议"复用 umami-db 容器新建库"，经核对服务器实际环境（`/opt` 下已有 umami、eat-what 等运行服务），**改为独立 Postgres 容器**。原因：umami-db 是 umami 专用镜像、且 eat-what 业务已在使用数据库；共用实例会扩大故障域、污染备份边界。独立 `postgres:14-alpine` 实例空闲仅 ~30–50MB，资源可控且隔离干净。
> 当前阶段：**先做老师端（账号登录 + 班级/花名册/点评同步）**；学生端（扫码认领、答题饲养）预留接口，暂不实现。

---

## 一、架构总览

```
┌──────────────────────────────────────────────────────────────┐
│  老师设备 A（教室大屏）   老师设备 B（办公室电脑）   ……          │
│  自包含 HTML（前端）  ←fetch→                                   │
└───────────────────────────┬──────────────────────────────────┘
                              │ HTTPS  /api/*
                              ▼
                    ┌─────────────────────┐
                    │  Nginx (443/80)      │  反向代理 + SSL + 静态文件
                    │  growth-planet.site  │
                    └─────────┬───────────┘
                              │ 代理 /api 到后端
                              ▼
                    ┌─────────────────────┐
                    │  growth-api 容器     │  Node.js (Fastify/Express)
                    │  (Alpine, 轻量)      │  端口 127.0.0.1:3100
                    └─────────┬───────────┘
                              │ 连接（同内网/同容器网络）
                              ▼
                    ┌─────────────────────┐
                    │  独立 Postgres       │  gp-db 容器 (127.0.0.1:5434)
                    │  专库 growth_planet  │  专用用户 gp_app（与 umami-db 隔离）
                    └─────────────────────┘
```

**内存预算（你的服务器 2GB RAM 已跑 umami+postgres+eat-what，约占用 700–900MB）**
| 组件 | 估算常驻内存 | 说明 |
|---|---|---|
| 独立 Postgres(gp-db) | ~30–50MB | 轻量 alpine，仅存本服务数据 |
| growth-api 容器 | ~80–150MB | Node Alpine，单进程 |
| Nginx | 复用宿主机现有 | 或并入 ecs-deploy 的 nginx |
| **新增总开销** | **~120–200MB** | 余量充足（剩 ~700MB+） |

> 不复用 umami-db 的原因：umami-db 是 umami 专用镜像、eat-what 业务已在用数据库；共用实例会让 umami / eat-what / growth 三者共用同一故障域与备份边界，风险高于省下的 30MB 内存。**独立实例隔离更干净。**

**结论**：独立 Postgres 实例 + 单 Node 后端 + 复用现有 Nginx，整体新增内存 < 200MB，你的 2GB 服务器完全够用，且与现有服务零耦合。

---

## 二、技术选型与理由

| 层 | 选型 | 理由 |
|---|---|---|
| 后端语言 | **Node.js (Fastify 或 Express)** | 你运维熟悉；和你前端 JS 同语言；Alpine 镜像小；单进程内存低 |
| 数据库 | **复用现有 Postgres 14**（新建 `growth_planet` 库 + 独立用户） | 零额外内存；已有容器；避免再跑一个 DB |
| 认证 | **JWT（access + refresh）+ bcrypt 密码哈希** | 老师账号少，JWT 无状态、易多设备；无需 Redis |
| 静态托管 | **Nginx（宿主机或容器）** | 反向代理 + SSL + 直接 serve 前端 HTML |
| 部署 | **Docker Compose** | 与现有 umami/docker 习惯一致；一条命令起停 |
| 备份 | **pg_dump 定时 + 对象存储/本地** | 数据轻，每天一次即可 |

> 备选：若你更熟 Python，FastAPI 同样合适，内存相近。本文以 Node 为例。

---

## 三、数据模型（Postgres · growth_planet）

```sql
-- 老师账号
CREATE TABLE teachers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 班级（归属某老师）
CREATE TABLE classes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id   UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,             -- 如 "三(1)班"
  grade        INT,                       -- 1-6
  theme        TEXT,                      -- 班级生态主题：蚕宝/小苗/小鱼…
  stage        TEXT DEFAULT 'wild',       -- wild/绿意/繁荣
  eco_value     INT DEFAULT 0,            -- 今日生态值
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- 学生 / 花名册（每班独立）
CREATE TABLE students (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id     UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  partner_kind TEXT,                      -- 自选伙伴种类（预留：学生端填）
  partner_stage INT DEFAULT 0,            -- 进化阶段 0..3
  vitality      INT DEFAULT 50,           -- 活力值（蔫了<阈值）
  loved         BOOLEAN DEFAULT false,
  hurt          BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- 点评行为事件（核心）
CREATE TABLE events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id     UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id   UUID REFERENCES students(id) ON DELETE SET NULL,
  teacher_id   UUID NOT NULL REFERENCES teachers(id),
  label_key    TEXT NOT NULL,             -- 科学标签 key：ask_question/observe/love_life…
  delta        INT NOT NULL,              -- +N / -N(负向可恢复)
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- 关系藤蔓（同学间正向连接，可后置）
CREATE TABLE vines (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id   UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  a_id       UUID REFERENCES students(id),
  b_id       UUID REFERENCES students(id()
);

-- 预留：学生端认领 / 作业（暂不实现，先建表占位）
CREATE TABLE partner_claims (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id),
  kind       TEXT NOT NULL,
  claimed_at TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE submissions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id),
  type       TEXT,                        -- homework/quiz/observation
  score      INT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

> 进化阶段 `partner_stage`、活力 `vitality`、`partner_claims`/`submissions` 均为学生端预埋，老师端原型阶段可先不用。

---

## 四、API 清单（REST / JSON）

**认证**
- `POST /api/auth/register` 注册老师（首启可脚本创建）
- `POST /api/auth/login` → 返回 access/refresh token
- `POST /api/auth/refresh`

**班级**
- `GET  /api/classes` 列出当前老师所有班级
- `POST /api/classes` 新建班级
- `PUT  /api/classes/:id` 改名称/主题/年级
- `DELETE /api/classes/:id`

**花名册**
- `GET  /api/classes/:id/students`
- `POST /api/classes/:id/students` 新增（支持批量数组）
- `PUT  /api/students/:id` 改名
- `DELETE /api/students/:id`

**点评**
- `POST /api/events` 提交一条点评 `{class_id, student_id, label_key, delta}`
- `GET  /api/classes/:id/state` 取全班实时状态（伙伴列表+活力+光荣榜+进度环）

**学生端预留（暂不实现，接口先定义）**
- `POST /api/students/:id/claim` 认领伙伴 `{kind}`
- `POST /api/submissions` 提交作业/答题 `{student_id, type, score}`
- `GET  /api/students/:id/growth` 成长记录

> 前端 HTML 通过 `fetch('/api/...')` 调用；本地原型阶段可保留 localStorage 分支，部署后切到远程 API（可用 `VITE_API_BASE`/编译期常量控制）。

---

## 五、部署文件

见同目录：
- `growth-planet-docker-compose.yml` —— 后端 + Nginx 服务
- `growth-planet-init.sql` —— 建库/用户/表
- `growth-planet-.env.example` —— 环境变量样例
- `growth-planet-nginx.conf` —— 反代 + SSL + 静态托管

### 部署步骤（在你服务器上）

```bash
# 1) 连上服务器，建项目目录
ssh root@<你的阿里云IP>
mkdir -p /opt/growth-planet && cd /opt/growth-planet

# 2) 克隆代码（已建好空仓库，后续 push 即可）
git clone https://github.com/kendra-KD/Primary-school-teaching-aids.git .

# 3) 在现有 Postgres 建库与用户（复用 umami-db 容器）
docker exec -i umami-db psql -U <postgres_superuser> <<'SQL'
CREATE DATABASE growth_planet;
CREATE USER gp_app WITH PASSWORD '强密码请改';
GRANT ALL PRIVILEGES ON DATABASE growth_planet TO gp_app;
SQL

# 4) 初始化表结构
docker exec -i umami-db psql -U gp_app -d growth_planet < growth-planet-init.sql

# 5) 配置 .env（照 .env.example 填 JWT 密钥、DB 连接串）
cp growth-planet-.env.example .env
nano .env   # 改 SECRET / DB_PASSWORD

# 6) 启动后端 + Nginx
docker compose -f growth-planet-docker-compose.yml up -d --build

# 7) 配域名 DNS → 服务器 IP，申请 SSL（可用 certbot 或阿里云免费证书）
# Nginx 已配好 443 反代 /api 与静态文件

# 8) 创建首位老师账号（脚本或 register 接口）
curl -X POST https://你的域名/api/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"teacher@school.edu","password":"初始密码","display_name":"科学老师"}'
```

### 安全建议
- DB 用户 `gp_app` 仅限 `growth_planet` 库，与 umami 库权限隔离。
- Nginx 仅暴露 80/443；后端容器只绑 `127.0.0.1:3100`，不对外。
- JWT 密钥用随机长串；密码 bcrypt 哈希（cost≥10）。
- 每日 `pg_dump growth_planet` 备份到 `/opt/backups` 或对象存储。
- 证书用 Let's Encrypt certbot 自动续期。

---

## 六、前端（老师大屏 HTML）如何对接

当前原型是纯前端 + localStorage。接入后端时建议：
1. 抽一个 `api.js`：判断 `API_BASE` 是否存在——有则 fetch 远程，无则走 localStorage（保留本地可用，弱网兜底）。
2. 顶部加「登录」入口：登录后 `GET /api/classes` 渲染班级卡片墙；点评走 `POST /api/events`。
3. 多设备同步：A 教室点评 → 写库 → B 办公室刷新即见最新状态（可加轮询或 WebSocket 后续优化）。

> 这样既保留「双击即用」的本地能力，又能在部署后无缝升级为多端同步。

---

## 七、后续学生端扩展（预埋，不阻塞老师端）

- 学生端 = 独立轻网页，扫「入班码」(班级 UUID 生成短码) 进对应班。
- 认领伙伴：`POST /api/students/:id/claim` 写 `partner_claims` + 更新 `students.partner_kind`。
- 答题/作业饲养：`POST /api/submissions` → 后端换算成 `vitality`/`partner_stage` 增量 → 老师大屏 `GET /api/classes/:id/state` 实时反映。
- 数据已在表里预留，届时只补接口实现 + 学生端前端，不动库结构。

---

## 八、与 GitHub / 自动部署

仓库：`https://github.com/kendra-KD/Primary-school-teaching-aids.git`
- 前端 HTML、后端代码、docker-compose、SQL 都进此仓库。
- 可选 GitHub Actions：push 到 main → 服务器 webhook / SSH 拉取 → `docker compose up -d --build` → 老师刷新即用（自动部署）。
- MVP 阶段手动 pull + up 即可，不必上 CI。

---

## 九、与现有服务器服务的集成（重要 · 据实际环境修订）

你的 `/opt` 下已有 `umami`（分析）、`eat-what`（已上线业务，用 pg）、`ecs-deploy`（部署脚手架，含多服务 docker + nginx 模板）。growth-planet 接入时**必须不污染现有服务**。

### 9.1 数据库隔离（已采用独立实例）
- 不复用 `umami-db`（端口 5433，umami 专用镜像，且 eat-what 业务已在用数据库）。
- 新增 `gp-db` 容器（端口 5434，独立 postgres:14-alpine，专库 `growth_planet` + 用户 `gp_app`）。
- 数据与 umami / eat-what **完全隔离**，故障域、备份边界各自独立。

### 9.2 Nginx 接入（复用现有，不新增容器）
- 优先用你现有的宿主机 Nginx（或 `ecs-deploy/multi-service-docker/nginx-svc.conf.example` 的套件），新增一个 server block：
  - 域名 `你的域名` → 反代 `/api/` 到 `127.0.0.1:3100`，`/` 指向前端静态目录。
- 不要另起 Nginx 容器，避免端口/配置冲突。可参考 `ecs-deploy` 里 eat-what / umami 的 nginx conf 写法保持一致。
- 前端静态文件放 `/opt/growth-planet/frontend/`（或软链到 Nginx root）。

### 9.3 备份（对齐 eat-what 的 backups/ 习惯）
- gp-db 数据卷 `./data/postgres` 加入每日 `pg_dump`：
  `docker exec gp-db pg_dump -U gp_app growth_planet > /opt/growth-planet/backups/backup_$(date +%Y%m%d_%H%M%S).sql`
- 保留最近 N 份（参考 eat-what 的 `backups/backup_*` 命名），可写个 cron 脚本。

### 9.4 部署目录约定
```
/opt/growth-planet/
├── docker-compose.yml
├── .env                  # 由 .env.example 复制，填真实密码/密钥（不入库）
├── package.json
├── server/               # 后端代码（server.js + 路由）
├── ecosystem.config.cjs  # 若用 pm2 托管 api（与 eat-what 一致）
├── frontend/             # 老师大屏 HTML（Nginx 服务）
├── data/postgres/        # gp-db 数据卷
└── backups/              # pg_dump 备份
```

### 9.5 端口占用核对（避免冲突）
| 服务 | 端口 | 状态 |
|---|---|---|
| umami | 3001 | 已占 |
| umami-db | 5433 | 已占 |
| gp-api | 3100 | 新 |
| gp-db | 5434 | 新 |
| eat-what | 见其配置 | 已占，不冲突 |

---

## 十、操作清单（服务器上执行）

```bash
# 1. 解决 GitHub clone 失败（GnuTLS）：用 SSH 或镜像，见对话中的方案 A/B/C
#    推荐：服务器生成 SSH 密钥并绑定 GitHub，再：
git clone git@github.com:kendra-KD/Primary-school-teaching-aids.git /opt/growth-planet
cd /opt/growth-planet/deploy

# 2. 配置环境变量
cp .env.example .env && vi .env   # 填 DB_PASSWORD / JWT_SECRET（openssl rand -hex 32）

# 3. 起数据库 + 后端
docker compose up -d
docker exec -i gp-db psql -U gp_app -d growth_planet < growth-planet-init.sql

# 4. 前端 + Nginx
#    把 frontend/ 软链或复制到 Nginx root，新增 server block 反代 /api → 127.0.0.1:3100
# 5. 验证：浏览器开域名 → 注册老师账号 → 建班 → 大屏点评 → 另一设备登录同一账号看同步
```
