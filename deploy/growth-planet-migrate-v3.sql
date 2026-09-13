-- 成长星球·科学班生态 —— Phase 4 迁移脚本
-- R70: 切班码安全重构（老师自设固定切班码，改码需验证登录密码）
-- R60: 伙伴形象扩充同步（后端 PARTNER_KINDS 已在代码层同步，无需 DDL）
-- 执行方式：
--   docker exec -i gp-db psql -U gp_app -d growth_planet < growth-planet-migrate-v3.sql
-- 幂等：使用 IF NOT EXISTS，重复执行安全。

-- ===== R70: 切班码 =====
-- switch_code: 老师自设的固定切班码（与 class_code 区分）
--   class_code  = 学生入班码（系统生成 6 位，用于 partner-demo 入班）
--   switch_code = 老师切班码（老师自设，用于大屏切换班级验证）
-- switch_code 为 nullable：未设置时切班走老师登录态校验（已登录即可切）
ALTER TABLE classes ADD COLUMN IF NOT EXISTS switch_code TEXT;
-- 不加 UNIQUE 索引：不同班级可有相同 switch_code（老师统一设一个码的情况）

-- 切班码修改审计日志（可选，记录谁改了码、何时）
-- 暂不建表，改码事件走 events 表的 type='switch_code_change'
