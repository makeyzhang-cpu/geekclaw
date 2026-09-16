-- 044: 会员套餐支持「每档自定义年价」
--
-- 背景（2026-09-16）：`subscription_plans` 原本只有一个月价 `price_fen`，周期折扣
-- 由 `nomifun-auth::period_multiplier` 的**全局系数**决定（年 = 月价 × 9）。
-- 但《GeekClawAI办公盒子各版本服务表》给出的年价折扣**不统一**
-- （9.4% ~ 17.2%，年价 ≈ 月价 × 9.87 ~ 10.87），全局系数算不出服务表上的数字。
--
-- 于是补一个「每档自定义年价」：`price_year_fen > 0` 时，`annual` 周期直接采用它；
-- 为 0 时回退到原有全局系数，保持既有三档（monthly / yearly / pro）行为完全不变。
--
-- 设计说明：
-- 1. 只是给已有表加一列**非 `_id` 列**，不触碰 id 契约的三处同步点
--    （本迁移 SQL / `id_schema_contract.rs` 的 PRODUCT_TABLES / tests），
--    对线上数据集零风险 —— 同 037 / 042 / 043 的做法。
-- 2. 默认值 0 的语义是「未配置年价」，**不是「年价免费」**。判定逻辑必须写成
--    `price_year_fen > 0` 才生效，否则会把所有档位的年付金额算成 0。
-- 3. `period_multiplier` 保留不动：它仍是季付（quarterly）以及所有未配置
--    年价的旧档位的唯一价格来源。

ALTER TABLE subscription_plans ADD COLUMN price_year_fen INTEGER NOT NULL DEFAULT 0;
