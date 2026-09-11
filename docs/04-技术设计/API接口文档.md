# API 接口文档

- **Base URL**：`https://gp.mealpick.me`（生产）｜ `http://127.0.0.1:3100`（本地）
- **数据格式**：全部 JSON，`Content-Type: application/json`
- **鉴权**：需鉴权的接口加请求头 `Authorization: Bearer <token>`；token 由登录接口返回，有效期 30 天
- **统一错误体**：`{ "error": "中文错误说明" }`
- **状态码约定**：`200` 成功 ｜ `201` 创建成功 ｜ `204` 删除成功（无 body） ｜ `400` 参数错误 ｜ `401` 未登录/凭据错误 ｜ `404` 资源不存在或无权访问 ｜ `500` 服务端错误

> 表结构说明见 [`数据库设计.md`](数据库设计.md)；标签字典见 [`../03-产品设计/课堂点评与学生互动闭环设计.md`](../03-产品设计/课堂点评与学生互动闭环设计.md#23-状态与特效映射)。

---

## 1. 接口总览

| 分组 | 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|---|
| 健康 | GET | `/api/health` | 免 | 服务与数据库状态 |
| 账号 | POST | `/api/auth/register` | 免 | 注册（生产默认关闭） |
| 账号 | POST | `/api/auth/login` | 免 | 登录，返回 JWT |
| 账号 | GET | `/api/me` | ✅ | 当前老师信息 |
| 班级 | GET | `/api/classes` | ✅ | 班级列表（带学生数） |
| 班级 | POST | `/api/classes` | ✅ | 建班 |
| 班级 | PUT | `/api/classes/:id` | ✅ | 改班 |
| 班级 | DELETE | `/api/classes/:id` | ✅ | 删班 |
| 班级 | POST | `/api/classes/:id/code` | ✅ | 重置入班码 |
| 学生端 | GET | `/api/join/:code` | 免 | 凭班级码取班级与学生名单 |
| 花名册 | GET | `/api/classes/:id/students` | ✅ | 花名册 |
| 花名册 | POST | `/api/classes/:id/students` | ✅ | 单个/批量新增学生 |
| 学生 | PUT | `/api/students/:id` | ✅ | 改名/换伙伴/排序/昵称主色/照料恢复 |
| 学生 | DELETE | `/api/students/:id` | ✅ | 删除学生 |
| 学生端 | POST | `/api/students/:id/claim` | 免 | 认领/更换伙伴 |
| 学生端 | POST | `/api/students/:id/activity` | 免 | 签到/答题/观察/作业 |
| 学生端 | GET | `/api/students/:id/activities` | 免 | 学生活动与成长值 |
| 点评 | GET | `/api/labels` | ✅ | 标签字典 |
| 点评 | POST | `/api/events` | ✅ | 提交点评 |
| 点评 | DELETE | `/api/events/:id` | ✅ | 撤销点评 |
| 大屏 | GET | `/api/classes/:id/state` | ✅ | 全班实时状态（核心） |

---

## 2. 详细定义

### 2.1 健康检查

`GET /api/health` → `200`

```json
{ "ok": true, "service": "growth-planet-api", "time": "2026-09-11T02:57:14.000Z" }
```
> `ok` 为 `false` 表示数据库不通。

---

### 2.2 账号

#### POST `/api/auth/login` — 登录

请求：
```json
{ "email": "luyulin@mealpick.me", "password": "yourPassword123" }
```
成功 `200`：
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....",
  "teacher": { "id": "7a8f97e3-...", "email": "luyulin@mealpick.me",
               "display_name": "李老师", "created_at": "2026-09-07T06:33:56.523Z" }
}
```
失败 `401`：`{ "error": "邮箱或密码不正确" }`
失败 `400`：`{ "error": "请输入邮箱和密码" }`

> 实现要点：对不存在的账号也执行一次 bcrypt 比较（恒定耗时），防账号枚举。

#### POST `/api/auth/register` — 注册

请求：`{ email, password(≥8位), display_name }` → `201 { token, teacher }`
当环境变量 `ALLOW_REGISTER=false` 时 → `400 { "error": "注册已关闭，请联系管理员开通账号" }`

#### GET `/api/me` — 当前老师

`200 { "teacher": {...} }`

---

### 2.3 班级

#### GET `/api/classes`

`200`：
```json
{ "classes": [
  { "id": "d9e1b6d8-...", "name": "三（1）班", "class_code": "d9e1b6",
    "grade": 3, "theme": null, "theme_pack": "life_obs", "stage": "wild",
    "eco_value": 0, "created_at": "...", "student_count": 42 }
] }
```

#### POST `/api/classes` — 建班

请求：
```json
{ "name": "三（1）班", "grade": 3, "theme": null, "theme_pack": "life_obs" }
```
- `name` 必填，≤30 字
- `grade` 可选，1–6
- `theme_pack` 可选；**不传且给了 grade 时自动匹配**：1–2 → `cute_nature`，3–4 → `life_obs`，5–6 → `anime_original`

成功 `201 { "class": {...含 class_code, student_count: 0} }`

#### PUT `/api/classes/:id`

请求（字段均可选，只传要改的）：`{ "name": "...", "grade": 4, "theme_pack": "anime_original" }`
`200 { "class": {...} }` ｜ `404` 非本人班级

#### POST `/api/classes/:id/code` — 重置入班码

`200 { "class_code": "a1b2c3" }` —— **原码立即失效**。

#### DELETE `/api/classes/:id` → `204`

---

### 2.4 学生端入班（免登录）

#### GET `/api/join/:code`

路径参数 `code` 大小写不敏感。

`200`：
```json
{ "class": { "id": "...", "name": "三（1）班", "class_code": "d9e1b6", "grade": 3 },
  "students": [ { "id": "...", "name": "孙少奇", "nickname": null,
                  "partner_kind": "bunny", "color": "#8FC7FF" } ] }
```
`404 { "error": "班级码无效，请向老师确认" }`

> 仅返回必要字段（不返回成长值、不返回其它班级信息）。

---

### 2.5 花名册

#### GET `/api/classes/:id/students` → `200 { "students": [ ...完整行 ] }`

#### POST `/api/classes/:id/students` — 新增（单个或批量）

请求（二选一）：
```json
{ "names": ["孙少奇", "陈定涛", "张卫良"] }
{ "name": "孙少奇" }
```
可选 `group_name`。

规则：
- 单次最多 80 人（超出 → `400 单次最多新增 80 人`）
- 姓名 ≤20 字，自动 trim；**不做服务端去重**（前端负责）
- `sort_order` 从当前最大值递增

成功 `201 { "students": [ ...新插入的行... ] }`

#### PUT `/api/students/:id`

请求（字段均可选）：
```json
{ "name": "孙少奇", "partner_kind": "bunny", "nickname": "小奇",
  "color": "#7FE3C0", "sort_order": 3, "group_name": "第一组",
  "care": true }
```
- `partner_kind` 必须在 38 种白名单内
- `color` 必须 `#RRGGBB`
- **`care: true`** = 照料动作：`hurt=false` 且 `vitality = max(当前, 50)`

`200 { "student": {...} }`

#### DELETE `/api/students/:id` → `204`（级联清理其藤蔓、活动、认领记录）

---

### 2.6 学生端认领（免登录）

#### POST `/api/students/:id/claim`

请求：
```json
{ "partner_kind": "shy_plant", "nickname": "小含羞", "color": "#7FE3C0" }
```
- `partner_kind` 必填且在白名单内
- `nickname` ≤20 字（不传则保留原昵称）
- `color` 必须 `#RRGGBB`

成功 `200 { "student": {...} }`，并写一条 `partner_claims` 审计记录
失败 `400 { "error": "partner_kind 非法" }` ｜ `404 { "error": "学生不存在" }`

---

### 2.7 学生活动（免登录）

#### POST `/api/students/:id/activity`

请求：
```json
{ "kind": "checkin" }
{ "kind": "quiz", "correct": true, "detail": "声音是由物体振动产生的" }
{ "kind": "observe", "detail": "绿豆第 3 天发芽了，芽长约 1cm" }
{ "kind": "homework", "detail": "观察日记已提交" }
```

**分值由服务端决定（前端不可传分）**：

| kind | points |
|---|---|
| `checkin` | 1（每日仅一次） |
| `quiz` | 答对 2 / 答错 0 |
| `observe` | 1 |
| `homework` | 3 |

成功 `201`：
```json
{ "student": { "id": "...", "name": "孙少奇", "nickname": "小奇",
               "partner_kind": "bunny", "color": "#8FC7FF" },
  "totalPoints": 14, "todayPoints": 3,
  "activities": [ { "kind": "checkin", "detail": null, "correct": null,
                    "points": 1, "created_at": "2026-09-11T02:00:00.000Z" } ] }
```

重复签到返回 `200 { ..., "already": true, "message": "今天已经签到啦" }`
失败 `400 { "error": "kind 非法" }` ｜ `404 { "error": "学生不存在" }`

#### GET `/api/students/:id/activities` → `200`（同上结构，`activities` 最多 50 条，倒序）

---

### 2.8 点评

#### GET `/api/labels` → `200 { "labels": { "ask_question": { "name": "...", "delta": 2, ... }, ... } }`

#### POST `/api/events` — 提交点评

请求：
```json
{ "class_id": "d9e1b6d8-...", "student_id": "aaaa-...",
  "label_key": "cooperate", "partner_id": "bbbb-..." }
```
- `partner_id` 可选（合作类标签需要），且**不得等于 `student_id`**
- `label_key` 必须在字典内
- **不接受 `delta` 字段**

成功 `201`：
```json
{ "event": { "id": "...", "delta": 2, "label_key": "cooperate", "created_at": "..." },
  "student": { "id": "...", "growth": 26, "partner_stage": 1, "vitality": 56,
               "status": "active", "today_score": 2 },
  "fx": "vine", "label_name": "小组合作探究", "partner_name": "陈定涛",
  "class_stage": { "key": "wild", "name": "荒芜", "next": "绿意", "progress": 0.15 } }
```
失败 `400`（未知标签 / 协作对象不属于本班 / 协作对象是自己 / 参数非法）｜ `404`（班级或学生无权访问）

#### DELETE `/api/events/:id` → `204`

事务内回滚：成长值重算、`vitality -= delta*3`（钳制 0–100）、`stage` 重算、`eco_value = GREATEST(0, eco - delta)`。**只能撤销本人提交的点评**（否则 `404`）。

---

### 2.9 全班实时状态（大屏核心）

#### GET `/api/classes/:id/state`

`200`：
```json
{
  "class": { "id": "...", "name": "三（1）班", "grade": 3, "theme": null,
             "theme_pack": "life_obs", "eco_value": 18,
             "stage": { "key": "wild", "name": "荒芜", "next": "绿意", "progress": 0.15 } },
  "students": [
    { "id": "...", "name": "孙少奇", "group_name": "第一组",
      "partner_kind": "bunny", "partner_stage": 1, "growth": 26,
      "today_score": 2, "vitality": 56, "ask": 1, "love_count": 0,
      "loved": false, "hurt": false, "status": "active" }
  ],
  "board": {
    "top_growth":    [ { "id": "...", "name": "孙少奇", "growth": 26 } ],
    "top_ask":       [ { "id": "...", "name": "孙少奇", "count": 1 } ],
    "life_guardian": [ { "id": "...", "name": "张卫良", "count": 2 } ],
    "tidiness": 68
  },
  "vines": [ { "a_id": "...", "b_id": "...", "label_key": "cooperate" } ],
  "today_events": 12
}
```

**字段口径**：
- `growth` = `events.delta 之和` + `student_activities.points 之和`
- `status` = `hurt` → `'hurt'`；`vitality < 30` → `'droop'`；否则 `'active'`
- `board.top_growth` 取前 5；`top_ask` / `life_guardian` 仅收录 `count > 0` 的前 3
- `board.tidiness` = `clamp(60 + SUM(tidy_up/untidy 的 delta) * 4, 0, 100)`
- `today_events` 为今日点评条数

---

## 3. 客户端调用示例

### 3.1 老师端登录并拉取班级状态

```bash
TOKEN=$(curl -sS -X POST https://gp.mealpick.me/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"luyulin@mealpick.me","password":"yourPassword123"}' \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).token))")

curl -sS https://gp.mealpick.me/api/classes -H "Authorization: Bearer $TOKEN"
```
> ⚠️ 不要用 `sed 's/.*"token":"\([^"]*\)".*/\1/'` 这类写法在 shell 里抓 JSON，容易被引号转义坑到（历史踩坑：`sed: invalid reference \1`）。用 `node -e` 或 `python -c` 更稳。

### 3.2 学生端认领并签到

```bash
# 1) 凭码入班，拿到学生 id
curl -sS https://gp.mealpick.me/api/join/d9e1b6

# 2) 认领
curl -sS -X POST https://gp.mealpick.me/api/students/<sid>/claim \
  -H 'Content-Type: application/json' \
  -d '{"partner_kind":"bunny","nickname":"小奇","color":"#7FE3C0"}'

# 3) 签到
curl -sS -X POST https://gp.mealpick.me/api/students/<sid>/activity \
  -H 'Content-Type: application/json' -d '{"kind":"checkin"}'
```

---

## 4. 备注与已知限制

| 项 | 说明 |
|---|---|
| 速率限制 | **未实现**（无 @fastify/rate-limit）。学生端免登录接口理论上可被刷，缓解手段是服务端定分 + 签到按天去重 |
| 分页 | 花名册与活动列表均未分页；班级规模（≤ 60 人）下无问题 |
| 时区 | 所有「今日」统计用数据库时区（容器默认 UTC），与北京时间存在 8 小时偏差（已知待改进） |
| `/state` 复杂度 | 单次聚合 5 条查询（学生、榜单、藤蔓、整洁度、今日事件），随班级规模增长需关注；见 [`数据库设计.md §4.1`](数据库设计.md#41-全班状态聚合eventsjs124) 的聚合规则 |
| 接口版本 | 无 `/v1` 前缀；前端与后端同仓同发布，暂不需要版本化 |
