-- 成长星球·科学班生态 —— Phase 5 迁移脚本
-- R98-v5: 伙伴形象体系重构（历史 52 种 SVG 图鉴 → 20 种 3D PNG 形象）
--
-- 背景：前端形象从「通用 SVG 豆形 + 52 种图鉴」重构为「20 种原创 3D 渲染 PNG，
--       每种含 10 个交互帧」。后端白名单 PARTNER_KINDS 同步收窄到这 20 种。
--       历史学生若绑定了旧 kind（tuan_tuan / ya_ya / dino_saurus …），需 remap，
--       否则认领/换伙伴校验会因 kind 不在白名单而报错。
--
-- ⚠️ 执行前务必先备份：
--     docker exec gp-db pg_dump -U gp_app growth_planet > /tmp/gp_backup_$(date +%F).sql
--
-- 执行方式：
--     docker exec -i gp-db psql -U gp_app -d growth_planet < growth-planet-migrate-v4.sql
--
-- 幂等：只更新 partner_kind 不在新 20 种内的已认领学生；可重复执行，二次执行影响行数为 0。
-- 安全性：remap 按 student id 的稳定哈希确定性分配，同一学生每次都落到同一种，
--         不会把大量学生瞬间变成同一个形象，也便于回滚时按 id 复算。

DO $$
DECLARE
  new_kinds TEXT[] := ARRAY[
    'kitty','puppy','bear','bunny','piggy','redpanda',
    'dino','car','train','plane','rocket',
    'lion','panda','tiger','frog','penguin','monkey',
    'robot','ghost','dragon'
  ];
  v_count INT;
BEGIN
  -- 未认领（partner_kind IS NULL）的学生保持 NULL，认领时再从新 20 种里选。
  UPDATE students s
  SET partner_kind = new_kinds[
        1 + ( (to_number(substr(md5(s.id::text), 1, 8), 'XXXXXXXX'))::bigint % 20 )::int
     ]
  WHERE s.partner_kind IS NOT NULL
    AND s.partner_kind <> ALL(new_kinds);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'R98-v5: 已将 % 名历史学生的 partner_kind 确定性 remap 到新 20 种形象', v_count;
END $$;

-- 校验：确认已无「不在新 20 种白名单」的 partner_kind（应返回 0 行）
-- SELECT DISTINCT partner_kind FROM students
-- WHERE partner_kind IS NOT NULL
--   AND partner_kind NOT IN ('kitty','puppy','bear','bunny','piggy','redpanda','dino','car','train','plane','rocket','lion','panda','tiger','frog','penguin','monkey','robot','ghost','dragon');

-- 查看 remap 后各形象人数分布（可选）
-- SELECT partner_kind, count(*) FROM students
-- WHERE partner_kind IS NOT NULL GROUP BY partner_kind ORDER BY count(*) DESC;
