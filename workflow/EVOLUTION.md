# 流程进化记录（EVOLUTION.md）

> 本文件驱动整套工作流的自我进化。两个来源：
> 1. **习惯候选**：执行需求过程中，用户纠正角色 Agent 产出时，父 Agent 记录于此 → 用户确认后合并入 [PROFILE.md](./PROFILE.md)
> 2. **流程优化提案**：`/retro` 复盘时由复盘主持产出 → 用户审批后由父 Agent 落实到模板/角色/门禁规则
>
> **铁律：所有候选与提案都不自动生效，必须经用户明确确认。**

## 一、习惯候选区（待确认 → PROFILE.md）

| 编号 | 日期 | 来源需求 | 观察到的习惯 | 用户确认 |
|---|---|---|---|---|
| HC-01 | 2026-09-24 | REQ-20260922-jiabao-cash-coupon | 对外能力通用化：所有平台及领域层的能力建设（不限卡网关），对外契约必须通用化、按租户/业务类型分发，禁止业务线专属命名；业务线命名只允许在内部实现层（用户确认时由卡网关扩展为全局适用） | 已确认 2026-09-24 |
| HC-02 | 2026-09-24 | REQ-20260922-jiabao-cash-coupon | 对外命名与类型统一：对外契约同名字段命名与类型全局统一（tenantId/storeId/skuId Long、voucherCode、BigDecimal 元等），外部系统异名异型在防腐层转换不泄漏 | 已确认 2026-09-24（用户直接陈述即确认） |
| HC-03 | 2026-09-24 | REQ-20260922-jiabao-cash-coupon | 语义归一化：平台网关除透传外必须具备归一化能力，下游各系统的语义差异（错误码/状态码/枚举口径）由网关在防腐层归一化为统一语义后对外，防止下游语义差异扩散；原始值作为 raw 明细保留透传不丢信息 | 已确认 2026-09-24（用户直接陈述即确认） |
| HC-04 | 2026-09-24 | REQ-20260922-jiabao-cash-coupon | 已有接口影响范围控制：已有对外接口命名/类型不规范也保持不动（新规范只管新建契约）；已有接口内部逻辑改动要控影响范围——历史逻辑兼容+可降级；对外接口契约变动必须升级对应 jar 包版本并记录发布日志 | 已确认 2026-09-24（用户直接陈述即确认） |
| HC-05 | 2026-09-25 | REQ-20260922-jiabao-cash-coupon | 编码风格 5 条：空值判断用 Objects.isNull/nonNull；尽量用 apache 工具类；入参 tenantId 必判空；上限/阈值配置化（properties，常变动走 ducc）；日志中文格式【XXX 层】XXX 服务-入参 | 已确认 2026-09-25（用户直接陈述即确认） |
| HC-06 | 2026-09-25 | REQ-20260922-jiabao-cash-coupon | 测试验证口径：子代理验证单测必须用项目 pom 真实依赖版本（mvn test，worker 仓库），禁止用 scratch 高版本库（如 mockito 3.x）代替验证——曾导致 verifyNoInteractions（3.x API）在项目 2.19.0 下编译失败 | 已确认 2026-09-25 |
| HC-07 | 2026-09-26 | REQ-20260922-jiabao-cash-coupon | 对外接口注释：javadoc 只写接口功能+出入参契约，内部实现逻辑（开关降级/租户分发/底层调用/映射机制）不写，外部系统无需感知 | 已确认 2026-09-26（用户直接陈述即确认） |
| HC-08 | 2026-09-26 | REQ-20260922-jiabao-cash-coupon | 类命名规范：实现类用 Impl 后缀（XxxFacadeImpl/ServiceImpl/WrapperImpl）；Controller 仅用于对外 web 层，禁止用于 JSF/内部服务实现 | 已确认 2026-09-26（用户直接陈述即确认） |
| HC-09 | 2026-09-26 | REQ-20260922-jiabao-cash-coupon | 方法入参规范：入参超过 3 个必须封装为参数对象（Query/Command/Param）传递 | 已确认 2026-09-26（用户直接陈述即确认） |
| HC-10 | 2026-09-26 | REQ-20260922-jiabao-cash-coupon | RPC 层禁止泛化调用：不得用「统一 invoke 入口 + 字符串方法名 + Map 参数」模板；第三方弱类型 Map SDK 须逐方法显式调用+强类型转换，Map 仅限 wrapper 边界内 | 已确认 2026-09-26（用户直接陈述即确认） |
| HC-11 | 2026-09-26 | REQ-20260922-jiabao-cash-coupon | 方法简洁与单一职责：主方法只做流程编排，对象转化/组装/校验拆独立方法；单一职责 + 开闭原则（扩展点用 SPI/策略，不堆 if-else） | 已确认 2026-09-26（用户直接陈述即确认） |
| HC-12 | 2026-09-26 | REQ-20260922-jiabao-cash-coupon | 中间件参数配置：JSF/RPC 超时重试等参数在 spring-jsf-consumer.xml 等配置文件（properties 占位符）中配置，禁止代码里用 RpcContext/attachment 动态设置 | 已确认 2026-09-26（用户直接陈述即确认） |
| HC-13 | 2026-09-28 | REQ-20260922-jiabao-cash-coupon | 角色模型指定：架构师CR（/cr）统一使用 gpt-6-sol 模型（派发 Task 时显式指定 model） | 已确认 2026-09-28（用户直接指令） |
| HC-14 | 2026-09-28 | REQ-20260922-jiabao-cash-coupon | 配置分界判据修正（按变动概率）：业务初期不确定/需运行期调整的阈值一律 ducc（如券码数量上限、试算抵扣上限），稳定不变的（JSF 超时/租户 id/别名/sendpay 位次）才放 properties——修正 HC-05 中「上限/阈值一律 properties」的表述 | 已确认 2026-09-28（用户直接陈述即确认） |
| HC-15 | 2026-09-29 | REQ-20260922-jiabao-cash-coupon | 环境配置口径：测试/预发/线上环境的配置（properties 与 ducc 项）统一在各环境 **JDOS 配置文件**中单独抽取维护，仓库 properties 仅本地/默认兜底；设计与部署文档的"配置放哪里"应落到 JDOS 配置文件（按环境）；不得因 `@LafValue` 未带 `name`（命名空间写法）判为缺陷 | 已确认 2026-09-29（用户直接陈述即确认） |

## 二、流程优化提案区（待审批）

| 编号 | 日期 | 来源需求 | 提案内容 | 影响面（模板/角色/门禁） | 审批结论 |
|---|---|---|---|---|---|
| <!-- EP-01 | | REQ-xxx | | | 待审批 --> | |
| EP-01 | 2026-09-26 | REQ-20260922-jiabao-cash-coupon | 方案设计阶段新增固定产出「配置清单」：逐项列明配置项名/位置（properties vs ducc vs 中间件XML）/默认值/用途/是否需运行期动态调整/变更影响；评审阶段同步校验分界正确性 | templates/03-design.md、roles/architect.md、roles/reviewer.md、PROFILE.md | 已批准并落实 2026-09-26 |
| EP-02 | 2026-09-28 | REQ-20260922-jiabao-cash-coupon | CR 派发简报须写明判定纪律：只有导致功能错误/资损/数据不一致/幂等并发失效/违反架构硬性规则的才判 blocker 或 major；加固建议、更多测试、真实环境验证一律 minor 或登记为不阻塞项；用户已决策事项不得再判 blocker/major，只能记「接受风险 + 上线前置」。理由：本需求前 4 轮 CR 未写纪律导致标准逐步上移（每轮均出现「部分修复」），第 5 轮写明后一次收敛通过 | roles/cr-architect.md（检查清单/判定纪律）、.pi/commands/cr.md（任务简报要点） | 待审批 |
| EP-03 | 2026-09-28 | REQ-20260922-jiabao-cash-coupon | 方案评审门禁：任何方案产出（03-design.md 设计稿、changes/CHANGES.md 中的变更节）在进入开发前必须派发一次架构师评审（角色 cr-architect=架构师CR，模型 custom/gpt-6-sol），评审意见回写方案文件/变更节的「架构师评审意见」小节；不通过则先修订方案再复评（同一方案最多复评 2 轮，未收敛上报用户决策） | workflow/roles/cr-architect.md（新增方案评审职责与检查项）、workflow/roles/architect.md（产出后提交评审）、.pi/commands/design.md、.pi/commands/change.md、workflow/templates/03-design.md、workflow/templates/CHANGES.md、workflow/ORCHESTRATOR.md（门禁） | 已批准并落实 2026-09-28（用户直接指令） |
| EP-04 | 2026-09-28 | REQ-20260922-jiabao-cash-coupon | 文档精简与单文件变更台账：每个需求**只保留一个变更文件** `changes/CHANGES.md`，每次变更**追加一节**（CHG-01 起自增），禁止每次变更新建 `CHG-NN.md`；阶段文档不重复堆叠（实施细则并入所属阶段文档，如派发简报并入 `05-tasks.md`），同一需求档案控制在 10 个文档量级 | workflow/templates/CHANGES.md（替代 CHG-NN.md）、.pi/commands/change.md、workflow/roles/risk-officer.md、workflow/ORCHESTRATOR.md、workflow/WORKFLOW.md、workflow/PROFILE.md | 已批准并落实 2026-09-28（用户直接指令："纳入 不过要整理一下 不要有过多的文档 每次的 changes 只有一个 不要搞 N 个"） |
| EP-05 | 2026-09-29 | REQ-20260922-jiabao-cash-coupon | **任何改动必须过架构师CR**：需求内**所有**代码改动——含 /dev 常规任务产出、CR 修复、minor 加固、父 Agent 直接小修（哪怕 1 行）——在最终合入/进入下一阶段前都必须至少经过一轮架构师CR（model `custom/gpt-6-sol`）；未过 CR 的改动不得视为完成、不得推进状态、不得上线。允许"聚焦增量 CR"（只评审该增量 commit），但不得以"改动小"为由跳过 | .pi/commands/cr.md（前置校验+增量 CR 说明）、workflow/roles/cr-architect.md、workflow/ORCHESTRATOR.md（门禁）、workflow/PROFILE.md | 已批准并落实 2026-09-29（用户直接指令："任何改动都需要架构师 CR"） |

## 三、已生效变更日志

| 编号 | 生效日期 | 变更内容 | 落实的文件 |
|---|---|---|---|
| HC-01 | 2026-09-24 | 习惯候选 HC-01 生效：新增架构偏好「对外能力通用化」（全局适用） | workflow/PROFILE.md 三、架构偏好 |
| EP-01 | 2026-09-26 | 流程优化：设计阶段配置清单（ducc/properties 分界 + 配置项名 + 默认值） | workflow/templates/03-design.md、workflow/roles/architect.md、workflow/roles/reviewer.md、workflow/PROFILE.md |
| HC-02 | 2026-09-24 | 习惯候选 HC-02 生效：新增架构偏好「对外命名与类型统一」 | workflow/PROFILE.md 三、架构偏好 |
| HC-03 | 2026-09-24 | 习惯候选 HC-03 生效：新增架构偏好「语义归一化」 | workflow/PROFILE.md 三、架构偏好 |
| HC-04 | 2026-09-24 | 习惯候选 HC-04 生效：新增架构偏好「已有接口影响范围控制」 | workflow/PROFILE.md 三、架构偏好 |
| HC-05 | 2026-09-25 | 习惯候选 HC-05 生效：新增编码风格 5 条（空值判断/工具类/tenantId 判空/配置化/中文日志格式） | workflow/PROFILE.md 二、编码风格 |
| HC-06 | 2026-09-25 | 习惯候选 HC-06 生效：新增流程偏好「测试验证口径」（真实依赖 mvn test） | workflow/PROFILE.md 四、协作与流程偏好 |
| HC-07 | 2026-09-26 | 习惯候选 HC-07 生效：新增编码风格「对外接口注释」 | workflow/PROFILE.md 二、编码风格 |
| HC-08 | 2026-09-26 | 习惯候选 HC-08 生效：新增编码风格「类命名后缀」 | workflow/PROFILE.md 二、编码风格 |
| HC-09 | 2026-09-26 | 习惯候选 HC-09 生效：新增编码风格「方法入参数量」 | workflow/PROFILE.md 二、编码风格 |
| HC-10 | 2026-09-26 | 习惯候选 HC-10 生效：新增编码风格「RPC 调用方式」 | workflow/PROFILE.md 二、编码风格 |
| HC-11 | 2026-09-26 | 习惯候选 HC-11 生效：新增编码风格「方法简洁与单一职责」 | workflow/PROFILE.md 二、编码风格 |
| HC-12 | 2026-09-26 | 习惯候选 HC-12 生效：新增编码风格「中间件参数配置」 | workflow/PROFILE.md 二、编码风格 |
| HC-13 | 2026-09-28 | 习惯候选 HC-13 生效：架构师CR 使用 gpt-6-sol | workflow/PROFILE.md 四、协作与流程偏好 |
| EP-03 | 2026-09-28 | 流程优化：方案评审门禁（所有方案必须过架构师评审，意见回写方案文件） | workflow/roles/cr-architect.md、workflow/roles/architect.md、workflow/ORCHESTRATOR.md、.pi/commands/design.md、.pi/commands/change.md、workflow/templates/03-design.md、workflow/templates/CHANGES.md |
| HC-14 | 2026-09-28 | 习惯候选 HC-14 生效：配置分界判据=变动概率（修正 HC-05 表述） | workflow/PROFILE.md 二、编码风格「配置化」行 |
| EP-04 | 2026-09-28 | 流程优化：文档精简与单文件变更台账（changes/CHANGES.md 单文件，每次变更追加一节；阶段文档合并，档案控制在 10 个文档量级） | workflow/templates/CHANGES.md、.pi/commands/change.md、workflow/roles/risk-officer.md、workflow/ORCHESTRATOR.md、workflow/WORKFLOW.md、workflow/PROFILE.md |

| EP-05 | 2026-09-29 | 流程优化：任何改动必须过架构师CR（含小修/加固/父 Agent 直接修改；允许聚焦增量 CR，不得以改动小为由跳过） | .pi/commands/cr.md、workflow/roles/cr-architect.md、workflow/ORCHESTRATOR.md、workflow/PROFILE.md |
| HC-15 | 2026-09-29 | 习惯候选 HC-15 生效：环境配置口径=各环境（测试/预发/线上）配置在 JDOS 配置文件中单独抽取，仓库 properties 仅本地兜底；不因 `@LafValue` 命名空间写法判缺陷 | workflow/PROFILE.md 四、协作与流程偏好 |
| HC-16 | 2026-10-07 | 习惯候选 HC-16 生效：问题定位派发原则——bug 定位类任务简报只给客观现象与已核实事实，禁止夹带父 Agent 主观猜测/方向预设/候选根因，子代理自行从证据出发定位 | workflow/PROFILE.md 四、协作与流程偏好 |
## 四、复盘数据总览（跨需求趋势）

> 每次 `/retro` 后追加一行，用于观察流程健康度趋势。

| 需求编号 | 总耗时 | 返工次数 | CR 轮次 | 人工打回次数 | 主要卡点 |
|---|---|---|---|---|---|
| <!-- REQ-xxx | | | | | --> | |
