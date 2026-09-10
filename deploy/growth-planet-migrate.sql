-- 成长星球·科学班生态 —— 迁移脚本（学生端自主认领伙伴）
-- 在已有 gp-db 上执行（不影响 umami-db / eatdb）：
--   docker exec -i gp-db psql -U gp_app -d growth_planet < growth-planet-migrate.sql
-- 幂等：用 IF NOT EXISTS / WHERE class_code IS NULL，重复执行安全。

-- 1) 班级码（取班级 id 前 6 位十六进制，天然唯一）
ALTER TABLE classes ADD COLUMN IF NOT EXISTS class_code TEXT UNIQUE;

-- 2) 学生可自定义昵称与主色
ALTER TABLE students ADD COLUMN IF NOT EXISTS nickname TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS color TEXT;

-- 3) 为已存在的班级补上 class_code
UPDATE classes SET class_code = LEFT(REPLACE(id::text, '-', ''), 6)
 WHERE class_code IS NULL;

-- 4) 修复删除学生/班级被外键阻塞（删学生返回 500）
--    partner_claims / submissions 引用 students 时漏了 ON DELETE CASCADE
ALTER TABLE partner_claims DROP CONSTRAINT IF EXISTS partner_claims_student_id_fkey;
ALTER TABLE partner_claims ADD CONSTRAINT partner_claims_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

ALTER TABLE submissions DROP CONSTRAINT IF EXISTS submissions_student_id_fkey;
ALTER TABLE submissions ADD CONSTRAINT submissions_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;
