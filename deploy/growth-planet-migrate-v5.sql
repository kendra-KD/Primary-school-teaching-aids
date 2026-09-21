-- R62: 今日亮点手动标记持久化
-- 结构: {"d":"YYYY-MM-DD", "sid":"uuid"}  （sid 为 null / 整行 null 表示取消今日亮点）
-- 每日由前端按日期判断失效，后端只负责读写该字段。
ALTER TABLE classes ADD COLUMN IF NOT EXISTS highlight_today JSONB DEFAULT NULL;

-- 执行（服务器，已建库后运行一次，幂等）：
--   docker exec -i gp-db psql -U gp_app -d growth_planet < growth-planet-migrate-v5.sql
