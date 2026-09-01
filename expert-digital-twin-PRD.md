# 专家数字分身市场 — PRD / 数据模型 / 页面结构（修订版 v2）

> 修订说明（2026-08-13）：初版把"专家 = 一个 conversation preset"是**错误**的。
> 经核查代码发现两处硬性事实：
> 1. `crates/nomifun-app/assets/builtin-presets/presets.json` 被契约测试
>    `load_embedded_manifest_is_intentionally_empty` **强制要求为空**
>    （注释：task workflows 走 Skill，不走 builtin preset）。往里塞专家会破契约、且语义不对。
> 2. 「数字分身伙伴」是 **Companion 子系统**（`pages/geekclaw` + `useNomi`/`useFigures`），
>    与 conversation preset 是两套体系。Companion 用**文件系统**存储
>    （`companions/{companion_id}/config.json`），带 `persona`/`character`/`appearance`/`model`/`skills`。
>
> 因此**正确映射：专家数字分身 = 一个带专家 persona 的 Companion 实例**；
> 市场只需在 Companion 之上加「目录 + 雇佣授权 + 扣费」两层，专家 twin 本身零新 schema。

---

## 1. 产品概述

在「数字分身伙伴」下新增【专家数字分身】市场。客户浏览顶尖专家（外贸 / 法律 / 财务 /
营销 / 编程 / 医疗等）的数字分身卡片，按 credits 雇佣；雇佣后该专家作为一个 **Companion
实例**出现在客户的数字分身伙伴列表里，可直接对话。平台与签约专家按约定分润（远期）。

法务：专家肖像/声音/姓名权由贵司与专家本人签约解决（用户已确认）。

## 2. 现有可复用资产（已确认）

| 能力 | 现状 | 复用方式 |
|---|---|---|
| 数字分身实例 | Companion 子系统，文件存储 `companions/{id}/config.json` | 专家 = 一个 Companion 实例 |
| 专家人格/系统提示 | `ICompanionPersona { preset: string; custom: string }` | 专家知识写进 `persona.custom` |
| 头像/形象 | 内置 `character`（SVG 角色，如 mochi/ink/…）或 `appearance.custom_figure`（上传抠图） | 市场卡用 `avatar` 图；雇佣后可绑 character 或自建 figure |
| 模型 | `ICompanionModelRef { provider_id, model }` | 专家默认模型写进 `model` |
| 创建实例 | `POST /api/companion/companions` `{name, character}` → `PATCH .../config` 填 persona/model/appearance | 雇佣 = create + patch |
| 积分/账本 | `users.credits` + `CreditTransaction`（追加式账本，多 tx_type） | 雇佣扣费新增 `tx_type = "hire_expert"` |
| 技能 | `ICompanionSkillConfig { enabled, disabled_auto }` | 专家默认启用的技能 |

**结论：人格/实例/计费全部现成，新增工作量集中在「市场壳 + 雇佣授权 + 目录种子」。

## 3. 数据模型

### 3.1 完全复用（不新建）
- **Companion 实例**：专家 twin 就是 Companion，存 `companions/{id}/config.json`，
  `persona.custom` = 专家系统提示，`model` = 默认模型，`character` = 内置角色或 `custom`。

### 3.2 新增 `expert_catalog`（市场目录，DB 表）
```sql
CREATE TABLE expert_catalog (
  expert_id         TEXT PRIMARY KEY,            -- CanonicalUuidV7
  slug              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  title             TEXT NOT NULL,               -- 头衔，如"资深跨境电商顾问"
  description       TEXT,                        -- 简介
  avatar            TEXT,                        -- 市场卡头像（相对资产路径或 URL）
  tags              TEXT NOT NULL DEFAULT '[]',  -- JSON 技能标签数组
  category          TEXT,                        -- 分类（外贸/法律/…）
  price_credits     INTEGER NOT NULL DEFAULT 0,  -- 雇佣价（credits）
  persona_custom    TEXT NOT NULL,               -- 专家系统提示（写入 companion.persona.custom）
  persona_preset    TEXT NOT NULL DEFAULT '',    -- companion.persona.preset
  default_character TEXT NOT NULL DEFAULT 'mochi',
  default_model_provider TEXT,                  -- 专家默认模型
  default_model     TEXT,
  default_skills    TEXT NOT NULL DEFAULT '[]',  -- JSON 启用技能数组
  is_builtin        INTEGER NOT NULL DEFAULT 1,  -- 1=平台内置 0=用户自建
  creator_id        TEXT,                        -- 自建专家作者（_id 后缀须登记 NON_REFERENCE_ID_COLUMNS）
  enabled           INTEGER NOT NULL DEFAULT 1,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL
);
```
- 头像 `avatar`：Phase1 市场卡先用 `avatar` 图（内置资产或远程 URL）；Phase4 声音/形象克隆
  再引入 `custom_figure` 真实分身形象。
- `expert_id` 带 `_id` 语义的列**只有 `creator_id`**（外键到 users）；按 migration 铁律，
  `creator_id` 若参与逻辑外键契约须登记 `LOGICAL_REFERENCES` 或加 `NON_REFERENCE_ID_COLUMNS`。

### 3.3 新增 `user_expert_licenses`（雇佣授权，DB 表）
```sql
CREATE TABLE user_expert_licenses (
  license_id   TEXT PRIMARY KEY,                 -- CanonicalUuidV7
  user_id      TEXT NOT NULL,                    -- 雇佣者（_id 须登记 NON_REFERENCE_ID_COLUMNS）
  expert_id    TEXT NOT NULL,                    -- 指向 expert_catalog.expert_id
  tx_id        TEXT,                             -- 对应 CreditTransaction 流水（审计）
  source       TEXT NOT NULL DEFAULT 'purchase',-- purchase / grant / invite_reward
  purchased_at INTEGER NOT NULL,
  expiry_at    INTEGER,                          -- 可选有效期；NULL=永久
  UNIQUE(user_id, expert_id)
);
CREATE INDEX idx_user_expert_licenses_user  ON user_expert_licenses(user_id);
CREATE INDEX idx_user_expert_licenses_expert ON user_expert_licenses(expert_id);
```

### 3.4 计费账本扩展
- `CreditTransaction.tx_type` 新增枚举值 `"hire_expert"`（消费类，与 `consume` 同级）。
- 雇佣端点：先 `add_credits(user, -price, tx_type="hire_expert", ref_value=expert_id)`，
  成功后再 create+patch Companion 并写 license；任一步失败回滚（先不扣费或退款）。

## 4. 后端 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/experts` | 列表（内置 + 用户自建），带 `is_owned`（当前用户是否已雇佣）、`category`/`tag`/`q` 过滤 |
| GET | `/api/experts/:id` | 详情（含完整 persona 模板，供前端预览/自建参照） |
| POST | `/api/experts` | 创建自建专家（落 `expert_catalog` is_builtin=0，creator_id=当前用户） |
| POST | `/api/experts/:id/hire` | **雇佣**：校验余额 → 扣 `hire_expert` → `createCompanion` → `patchCompanion`(persona/model/appearance/skills) → 写 `user_expert_licenses` → 返回新建 companion_id |
| GET | `/api/experts/mine` | 我雇佣的专家（及对应 companion_id） |

- `hire` 复用现有 `subscribe`/billing 校验模式（参考任务 D 的 `with_billing` + 余额预检）。
- Companion 创建走现有 HTTP 契约：`POST /api/companion/companions` `{name,character}`
  → `PATCH /api/companion/companions/{id}` 填 `persona.custom` / `model` / `appearance` / `skills`。
- 幂等：同一用户重复雇佣同一专家返回已有 license（不重复扣费）。

## 5. 前端页面结构（对齐用户截图）

入口：数字分身伙伴 → 新 tab【专家数字分身】（与现有「形象库 / 创建分身」并列）。

- 顶栏：搜索框 / 分类筛选（外贸·法律·财务·营销·编程·医疗…）/ 内置·自定义切换 / 排序。
- 卡片网格：头像、名字 + 头衔、简介、技能标签、`price_credits` 或「已雇佣」徽章、雇佣按钮。
- 详情抽屉：大图、完整简介、技能标签、示例问答、「雇佣」按钮（未雇佣）/「打开对话」（已雇佣）。
- 雇佣弹窗：显示价格、确认扣 credits、成功后提示"已加入你的数字分身伙伴"，并自动跳到该 Companion。
- 「我的专家」视图：已雇佣专家 → 对应 Companion 列表。
- 「通过 GeekClaw 创建」按钮：打开自建专家向导（Phase2）。

## 6. 雇佣扣费链路（端到端）

```
用户点雇佣
  → POST /api/experts/:id/hire
  → 后端：读取 expert_catalog(price_credits, persona_custom, default_model…)
  → 校验 users.credits >= price（余额预检）
  → BEGIN
       CreditTransaction(consume/grant 类, tx_type="hire_expert", amount=-price, ref_value=expert_id)
       users.credits -= price
       user_expert_licenses INSERT (幂等: 已存在则跳过扣费)
       companion = POST /api/companion/companions {name, character=default_character}
       PATCH /api/companion/companions/{companion} {persona:{custom:persona_custom}, model, skills, appearance}
    COMMIT
  → 返回 companion_id（前端把它加入数字分身伙伴列表）
```

## 7. 分阶段路线

- **Phase0 填内置专家目录（= 原任务 C 的"货源"，但落点改为 `expert_catalog` 种子，不是 presets.json）**
  先种 6–8 个内置专家（外贸/法律/财务/营销/全栈/医疗/投资/产品），让市场有货。
- **Phase1 市场 MVP**：`expert_catalog` + `user_expert_licenses` 两表（migration 登记
  `NON_REFERENCE_ID_COLUMNS`）+ 上述 5 个 API + 前端市场页（搜索/筛选/卡片/详情/雇佣/我的专家）。
  风险最低，纯复用 Companion + billing。
- **Phase2 自建专家向导**：结构化表单（名称/头衔/简介/领域/语气/技能/知识/示例）→
  拼 `expert_catalog`(is_builtin=0) 落库。Phase3 可升级为对话式 LLM 生成。
- **Phase3 接声音克隆**：雇佣时可选绑定云端克隆音色（`persona` 扩展 voice，复用 E 阶段2 成果）。
- **Phase4 接形象克隆（照片说话）**：专家头像升级为 `custom_figure` 真实分身，复用 E 阶段3 成果。
- **Phase5 分成订阅**：平台与签约专家分润、订阅制、推荐奖励（运营层，非阻塞）。

## 8. 验收标准

- [ ] 市场页能列出内置专家，卡片含头像/头衔/简介/技能/价格。
- [ ] 未雇佣点「雇佣」→ 弹窗确认 → 扣对应 credits → 该专家作为 Companion 出现在数字分身伙伴列表。
- [ ] 已雇佣显示「已雇佣」徽章，点开直接对话，专家按 `persona.custom` 人设应答。
- [ ] 重复雇佣同一专家不重复扣费（幂等）。
- [ ] `CreditTransaction` 出现 `hire_expert` 记录，余额正确递减。
- [ ] 自建专家经向导落库并在市场"自定义"tab 可见、可被他人雇佣（Phase2）。

## 9. 与既有任务的关系

- **F（本需求）**：专家数字分身市场，按本 PRD 实现。
- **C（专家分身数据）**：原定义为"填 presets.json"，经核查该文件被契约强制空且专家≠preset，
  故 **C 的"货源"落点改为 `expert_catalog` 种子（Phase0）**，不再动 presets.json。
- **D（统一经济闭环）**：本需求的雇佣扣费直接复用 D 的 credits 账本，新增 `hire_expert` 一类。
- **E（数字分身语音对话）**：Phase3/Phase4 的声/像克隆与本需求共用 E 的成果。
- **A/B**：团队董事长改造 / Quako 登录激活，与本需求无耦合，按用户指示并入开发流随时收尾。
