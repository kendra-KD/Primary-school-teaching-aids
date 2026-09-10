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

-- 5) 学生自主活动（签到 / 课间答题 / 观察记录 / 作业），驱动伙伴成长
CREATE TABLE IF NOT EXISTS student_activities (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id   UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,            -- checkin | quiz | observe | homework
  detail     TEXT,                     -- 题目/观察内容摘要（可选）
  correct    BOOLEAN DEFAULT NULL,     -- 答题是否正确（仅 quiz 用）
  points     INT NOT NULL DEFAULT 0,   -- 本次获得生态值（服务端定分）
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activities_class ON student_activities(class_id);
CREATE INDEX IF NOT EXISTS idx_activities_student ON student_activities(student_id);
