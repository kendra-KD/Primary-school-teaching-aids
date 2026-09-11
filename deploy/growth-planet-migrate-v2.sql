-- 成长星球·科学班生态 —— Phase 3 迁移脚本
-- 新增：设备令牌(R45) / 授课会话(R49/R51) / 题库(R33) / 换伙伴申请(R46)
-- 执行方式：
--   docker exec -i gp-db psql -U gp_app -d growth_planet < growth-planet-migrate-v2.sql
-- 幂等：全部使用 IF NOT EXISTS，重复执行安全。

-- ===== R45: 学生设备令牌 =====
ALTER TABLE students ADD COLUMN IF NOT EXISTS device_token TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS device_token_at TIMESTAMPTZ;

-- ===== R49/R51: 授课会话 =====
CREATE TABLE IF NOT EXISTS lesson_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id  UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  class_id    UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  pin         TEXT,                          -- 4 位课堂 PIN（切换班级时验证）
  started_at  TIMESTAMPTZ DEFAULT now(),
  expires_at  TIMESTAMPTZ DEFAULT now() + interval '90 minutes',
  ended_at    TIMESTAMPTZ,                   -- 手动下课时写入
  active      BOOLEAN DEFAULT true           -- false = 已下课
);
CREATE INDEX IF NOT EXISTS idx_lesson_sessions_teacher ON lesson_sessions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_lesson_sessions_class ON lesson_sessions(class_id);
CREATE INDEX IF NOT EXISTS idx_lesson_sessions_active ON lesson_sessions(active) WHERE active = true;

-- ===== R33: 科学知识点题库 =====
CREATE TABLE IF NOT EXISTS questions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id    UUID REFERENCES classes(id) ON DELETE CASCADE,  -- NULL = 全局共享题
  grade       INT,
  unit        TEXT,                           -- 单元/主题
  question    TEXT NOT NULL,
  options     JSONB NOT NULL,                 -- ["选项A","选项B","选项C","选项D"]
  answer      INT NOT NULL,                   -- 正确答案索引（0-based）
  explanation TEXT,                            -- 解析
  created_by  UUID REFERENCES teachers(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  is_active   BOOLEAN DEFAULT true            -- 老师可停用旧题
);
CREATE INDEX IF NOT EXISTS idx_questions_class ON questions(class_id);
CREATE INDEX IF NOT EXISTS idx_questions_grade ON questions(grade);
CREATE INDEX IF NOT EXISTS idx_questions_active ON questions(is_active) WHERE is_active = true;

-- ===== R46: 换伙伴申请记录 =====
CREATE TABLE IF NOT EXISTS partner_change_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id       UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  current_kind   TEXT,
  requested_kind TEXT,
  status         TEXT DEFAULT 'pending',     -- pending | approved | denied
  created_at     TIMESTAMPTZ DEFAULT now(),
  resolved_at    TIMESTAMPTZ,
  resolved_by    UUID REFERENCES teachers(id)
);
CREATE INDEX IF NOT EXISTS idx_change_req_class ON partner_change_requests(class_id);
CREATE INDEX IF NOT EXISTS idx_change_req_status ON partner_change_requests(status);

-- ===== 补全 init.sql 缺失的索引 =====
CREATE INDEX IF NOT EXISTS idx_lesson_sessions_expires ON lesson_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_questions_created_by ON questions(created_by);
