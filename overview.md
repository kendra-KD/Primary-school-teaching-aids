# v0.3.0 交付清单 — 安全加固 + 动效/穿戴/形象扩充（批次1+2）

## 本次完成

本轮围绕用户反馈的两个逻辑漏洞 + 批次2 六项需求，共实现 **8 条需求（R54–R61）**，全部通过构建体检，已提交 `d960d51`。

## 交付清单

| 编号 | 需求 | 状态 | 关键改动 |
|---|---|---|---|
| R54 | PIN 安全加固 | ✅ | 切班永远验证 + 顶栏隐藏 PIN + 右下角隐蔽查看 |
| R55 | 学生自选页双入口 | ✅ | 首次认领(fresh=1) vs 日常互动入口 |
| R56 | B2 动效强化 | ✅ | 粒子 5 个 + 2.5s + 随机偏移 + 花叶永久佩戴 |
| R57 | 计时全屏放大 | ✅ | ╌ 按钮 + position:fixed 超大数字 |
| R58 | 装扮穿戴 | ✅ | s.wearing 持久化 + wearSVG 叠加 + 成长卡穿戴按钮 |
| R59 | 题库批量导入 | ✅ | 粘贴多行 + CSV/TXT 上传 + 逐条 POST |
| R60 | 伙伴形象扩充 | ✅ | 恐龙 3 + 星际精灵 3 + Xiaolong人 3（共 9 种原创 SVG） |
| R61 | 精致解锁面板 | ✅ | GP.pinPrompt 暗色卡片式替换原生 prompt |

## 修改文件

- `frontend/teacher-dashboard.html` — PIN 安全/动效/全屏/穿戴/批量导入/新形象 CSS+JS
- `frontend/partner-demo.html` — 新增 9 种形象 SVG + LIB 配置
- `docs/02-需求/需求清单与实现状态.md` — 新增 R54–R61 + 统计更新
- `docs/03-产品设计/伙伴图鉴设计（38种）.md` — 扩充至 45 种
- `docs/08-项目历程/CHANGELOG.md` — v0.3.0 条目
- `docs/08-项目历程/需求来源原始记录.md` — §3.6 原话记录

## 部署方式

```bash
# 1. 本地已提交，推送到 GitHub
cd E:/WorkBuddy/Tool/growth-planet-repo
git push origin main

# 2. 服务器拉取并构建
ssh your-server
cd /path/to/growth-planet-repo
git pull origin main
bash deploy/build-frontend.sh

# 3. 验证（无需重启后端容器，前端是静态文件）
# 访问 https://gp.mealpick.me 检查
```

## 已知限制

- 装扮穿戴的 `wearing` 字段存 localStorage（离线模式）或随 students 数组同步云端，不单独建表
- 题库批量导入逐条 POST，大批量时较慢（>50 题建议分批）
- 新增 9 种形象后端 partner_kind 不校验枚举，无需改后端
