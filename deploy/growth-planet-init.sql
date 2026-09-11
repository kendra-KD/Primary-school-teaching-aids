-- 成长星球·科学班生态 —— 初始化 SQL
-- 数据库与用户已由 docker-compose(gp-db) 创建，这里只建表。
-- 执行方式（gp-db 容器已起后）：
--   docker exec -i gp-db psql -U gp_app -d growth_planet < growth-planet-init.sql
-- 注意：不要往 umami-db 执行此文件；gp-db 是独立实例，端口 5434。

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS teachers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS classes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id  UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  grade       INT,
  theme       TEXT,
  theme_pack  TEXT,                     -- cute_nature / life_obs / anime_original
  stage       TEXT DEFAULT 'wild',
  eco_value   INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS students (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id     UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  group_name   TEXT,                    -- 小组名，用于"最繁荣小组"榜
  sort_order   INT,                     -- 花名册顺序
  partner_kind TEXT,
  partner_stage INT DEFAULT 0,
  vitality     INT DEFAULT 50,
  loved        BOOLEAN DEFAULT false,
  hurt         BOOLEAN DEFAULT false,
  device_token  TEXT,                   -- R45: 设备令牌，认领时签发
  device_token_at TIMESTAMPTZ,          -- 令牌签发时间
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id   UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  teacher_id UUID NOT NULL REFERENCES teachers(id),
  label_key  TEXT NOT NULL,
  delta      INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vines (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id   UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  a_id       UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  b_id       UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  label_key  TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (class_id, a_id, b_id)          -- 同一对同学之间只长一条藤蔓
);

CREATE TABLE IF NOT EXISTS partner_claims (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  claimed_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS submissions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type       TEXT,
  score      INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_activities (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id   UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,            -- checkin | quiz | observe | homework
  detail     TEXT,
  correct    BOOLEAN DEFAULT NULL,
  points     INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_students_class ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_events_class ON events(class_id);
CREATE INDEX IF NOT EXISTS idx_events_student ON events(student_id);
CREATE INDEX IF NOT EXISTS idx_vines_class ON vines(class_id);
CREATE INDEX IF NOT EXISTS idx_activities_class ON student_activities(class_id);
CREATE INDEX IF NOT EXISTS idx_activities_student ON student_activities(student_id);

-- ===== Phase 3: 授课会话 / 题库 / 换伙伴申请 =====
CREATE TABLE IF NOT EXISTS lesson_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id  UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  class_id    UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  pin         TEXT,
  started_at  TIMESTAMPTZ DEFAULT now(),
  expires_at  TIMESTAMPTZ DEFAULT now() + interval '90 minutes',
  ended_at    TIMESTAMPTZ,
  active      BOOLEAN DEFAULT true
);
CREATE INDEX IF NOT EXISTS idx_lesson_sessions_teacher ON lesson_sessions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_lesson_sessions_class ON lesson_sessions(class_id);
CREATE INDEX IF NOT EXISTS idx_lesson_sessions_active ON lesson_sessions(active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_lesson_sessions_expires ON lesson_sessions(expires_at);

CREATE TABLE IF NOT EXISTS questions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id    UUID REFERENCES classes(id) ON DELETE CASCADE,
  grade       INT,
  unit        TEXT,
  question    TEXT NOT NULL,
  options     JSONB NOT NULL,
  answer      INT NOT NULL,
  explanation  TEXT,
  created_by  UUID REFERENCES teachers(id),
  created_at  TIMESTAMPTZ DEFAULT now(),
  is_active   BOOLEAN DEFAULT true,
  recommended_labels JSONB DEFAULT '[]'::JSONB
);
CREATE INDEX IF NOT EXISTS idx_questions_class ON questions(class_id);
CREATE INDEX IF NOT EXISTS idx_questions_grade ON questions(grade);
CREATE INDEX IF NOT EXISTS idx_questions_active ON questions(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_questions_created_by ON questions(created_by);

CREATE TABLE IF NOT EXISTS partner_change_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id     UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id       UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  current_kind   TEXT,
  requested_kind TEXT,
  status         TEXT DEFAULT 'pending',
  created_at     TIMESTAMPTZ DEFAULT now(),
  resolved_at    TIMESTAMPTZ,
  resolved_by    UUID REFERENCES teachers(id)
);
CREATE INDEX IF NOT EXISTS idx_change_req_class ON partner_change_requests(class_id);
CREATE INDEX IF NOT EXISTS idx_change_req_status ON partner_change_requests(status);
