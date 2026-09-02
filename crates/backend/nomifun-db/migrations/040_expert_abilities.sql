-- 040_expert_abilities.sql
-- 专家数字分身市场：为 `expert_catalog` 增加「四能力」字段 + 云端同步溯源。
--
-- 四能力（管理后台可配置，雇佣时注入到生成的数字分身 Companion）：
--   memory_seed         专属记忆（初始记忆种子，雇佣时经 add_memory 注入）
--   knowledge_markdown  专属知识库（初始知识文档，雇佣时创建并挂载 companion 知识库）
--   learn_enabled       自主进化 · 定时学习开关（映射 CompanionLearnConfig.enabled）
--   evolve_enabled      自主进化 · 技能进化开关（映射 CompanionEvolveConfig.enabled）
--   source              溯源：'local' = 本地内置种子；'cloud' = 云端管理后台同步而来
--
-- 均为普通列（不以 `_id` 结尾），不触发 v3 ID 契约登记；不新增表，无需登记
-- PRODUCT_TABLES。`slug` 本身已是 UNIQUE NOT NULL，直接作为云端同步去重键。

ALTER TABLE expert_catalog ADD COLUMN memory_seed TEXT NOT NULL DEFAULT '';
ALTER TABLE expert_catalog ADD COLUMN knowledge_markdown TEXT NOT NULL DEFAULT '';
ALTER TABLE expert_catalog ADD COLUMN learn_enabled INTEGER NOT NULL DEFAULT 1 CHECK (learn_enabled IN (0, 1));
ALTER TABLE expert_catalog ADD COLUMN evolve_enabled INTEGER NOT NULL DEFAULT 1 CHECK (evolve_enabled IN (0, 1));
ALTER TABLE expert_catalog ADD COLUMN source TEXT NOT NULL DEFAULT 'local';
