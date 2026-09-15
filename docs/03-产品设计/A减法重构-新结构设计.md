# A 减法重构 · 新结构设计

> 版本：v1.0 | 日期：2026-09-15 | 关联任务：Task #113
> 前置：诊断报告见 `2026-09-15.md` 记忆日志"产品逻辑太乱诊断"章节

## 一、重构目标

解决"乱"的 3 个根因：
1. **入口爆炸**——单页 20+ 交互点，顶栏 7 按钮 + 花名册浮层 10 按钮
2. **浮层职责混杂**——花名册塞 5 类职责（学生管理/学生入口/教师工具/班级配置/展示）
3. **学生双入口语义模糊**——老师需记忆 `fresh=1`（首次认领）与日常（课间互动）区别

## 二、4 个决策点（已确认）

| 决策点 | 选择 | 说明 |
|---|---|---|
| 花名册入口 | 保留 ⚙ 按钮兜底 + 点 chip 可进 | 双入口保险，顶栏稍密但好点 |
| 工具箱形态 | 右侧抽屉滑出 | 不离开大屏，录题/审批时还能看到星球 |
| 班级设置入口 | 班级 chip 旁加 ⚙ 图标 | 显式入口，移动端/桌面端都好点 |
| 学生入口时机 | A 阶段只合并前端入口 | 后端自动重定向留 B 阶段 |

## 三、新结构总览

### 3.1 顶栏：7 按钮 → 3 区 5 按钮

| 区 | 内容 | 说明 |
|---|---|---|
| 区1 课堂操作 | ⏱ 计时 · ⛶ 全屏 · 📚 上课 | 课堂高频操作集中 |
| 区2 班级切换 | 班级 chip[⚙] · ➕ 建班 | 点 chip 开花名册；chip 旁 ⚙ 开班级设置 |
| 区3 工具箱 | 🧰 工具箱 | 右侧抽屉滑出 |
| 兜底 | ⚙ 花名册 · 📊 周报 | 兜底入口，保险 |

**取消**：原顶栏独立的 `gearBtn`（花名册）改为兜底区；`reportBtn`（周报）并入兜底区；`newClassBtn`（建班）并入区2。

### 3.2 花名册浮层瘦身：10 按钮 → 4 按钮

**保留**：
- ＋ 添加学生
- 批量导入
- 🔗 复制入班链接（**唯一按钮**，取代原双入口）
- 🔒 切班码

**保留展示**：班级名、人数、入班码、学生卡片列表

**移出**：
- 📝 录题/题库 → 工具箱抽屉
- 🔄 换伙伴审批 → 工具箱抽屉
- 📋 带班记录 → 工具箱抽屉
- 🎒 学生自选页（首次认领）→ **合并删除**
- 📱 学生互动入口（课间）→ **合并删除**

### 3.3 班级设置浮层（新独立）

**入口**：班级 chip 旁的 ⚙ 图标

**内容**：
- 班级名称/年级修改
- 删除班级
- 年级/学期切换
- 导出周报

**目的**：把"班级属性"与"学生名单"分层，老师不再在花名册里找班级级操作。

### 3.4 教师工具箱抽屉（新独立）

**形态**：右侧抽屉滑出，不离开大屏

**内容**：
| 工具 | 说明 |
|---|---|
| 📝 录题/题库 | 含批量导入（从花名册移入） |
| 🔄 换伙伴审批 | 含红点徽标（从花名册移入） |
| 📋 带班记录 | 历史班级（从花名册移入） |
| ✨ AI 出题 | **B 闭环预留**，虚线框，A 阶段不实现 |

### 3.5 学生入口合并：双入口 → 单入口

**A 阶段（前端）**：
- 花名册只保留"🔗 复制入班链接"一个按钮
- 学生打开链接 → 前端检测本地标记：
  - 未认领（无标记）→ 跳自选伙伴页
  - 已认领（有标记）→ 跳互动主页（答题/交作业/看伙伴）
- 老师不再记忆 `fresh=1` 与日常区别

**B 阶段（后端）**：
- 后端加自动重定向逻辑兜底
- 接口检测认领状态，返回对应页面

## 四、改动范围

### 4.1 HTML 结构改动

| 文件 | 改动 |
|---|---|
| `frontend/teacher-dashboard.html` | 顶栏重组 3 区；花名册浮层删 6 按钮；新增班级设置浮层；新增工具箱抽屉；学生双入口合并 |

### 4.2 JS 绑定改动

原绑定（行 1986-2004）：
```js
bind('gearBtn', openRoster);
bind('reportBtn', openReport);
bind('newClassBtn', openNewClass);
bind('copyLinkBtn', copyJoinLink);
bind('openStuBtn', openStudentPage);      // 删除
bind('openStuDailyBtn', openStudentDaily); // 删除
bind('setSwitchCodeBtn', setSwitchCode);
bind('quizBtn', openQuizPanel);            // 移到工具箱
bind('partnerReqBtn', openPartnerRequests); // 移到工具箱
bind('myClassesBtn', openMyClasses);       // 移到工具箱
```

新绑定：
```js
// 顶栏区2：班级 chip 点击开 roster，chip 旁 ⚙ 开 classSettings
// 顶栏兜底：gearBtn 开 roster，reportBtn 开 report
bind('toolboxBtn', openToolbox);     // 新增：开工具箱抽屉
bind('toolboxClose', closeToolbox);  // 新增
bind('classSettingsClose', closeClassSettings); // 新增
bind('classSettingsBtn', openClassSettings); // 新增：chip 旁 ⚙
// 工具箱内按钮（原花名册 3 按钮迁移）
bind('tbQuizBtn', openQuizPanel);
bind('tbPartnerReqBtn', openPartnerRequests);
bind('tbMyClassesBtn', openMyClasses);
// 学生入口合并：copyLinkBtn 保留，openStuBtn/openStuDailyBtn 删除
```

### 4.3 CSS 改动

- 新增 `.toolbox-drawer`（右侧抽屉样式）
- 新增 `.class-settings`（班级设置浮层样式）
- 班级 chip 增加 `.chip-settings`（⚙ 图标按钮）

### 4.4 不改动

- 右侧 aside（光荣榜/共生榜）
- 底部 dock（点评标签）
- 星球主区（planet-wrap）
- 所有后端接口

## 五、风险与回滚

### 风险
- **风险低**：纯前端结构调整，不接后端，不改数据流
- **风险中**：学生入口合并后，原 `fresh=1` 参数仍兼容（前端检测优先，无标记才看 URL 参数）
- **风险中**：工具箱抽屉与花名册浮层的 z-index 冲突，需测试

### 回滚
- Git 可一键回滚到 `4f336c3`（R98-v5 修复提交）
- 改动集中在 `teacher-dashboard.html` 单文件，回滚成本极低

## 六、验收清单

- [ ] 顶栏按钮数 7→5，分 3 区 + 兜底
- [ ] 花名册浮层按钮 10→4
- [ ] 班级设置浮层独立，入口为 chip 旁 ⚙
- [ ] 工具箱抽屉从右侧滑出，含 3 工具 + AI 出题预留位
- [ ] 学生入口合并为单按钮，前端检测认领状态跳转
- [ ] 原 `fresh=1` 参数仍兼容
- [ ] 切班、建班、录题、审批、带班记录功能全部正常
- [ ] 移动端 chip 旁 ⚙ 可点（≥44px 触摸目标）
