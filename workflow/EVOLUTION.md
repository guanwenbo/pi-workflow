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
| EP-06 | 2026-10-09 | REQ-20260922-jiabao-cash-coupon | **自测收尾必须回流设计文档并过「一致性 CR」**：需求**自测（预发/联调）全部完成后**，必须**以最新代码实现流程为基准**逐条核对设计文档（`03-design.md` 及受影响的 `08-test-plan.md`/`09-release.md`/`DEPLOY-CONFIG.md`），把**代码实现与设计稿有出入之处重新补齐/更正**（链路图与时序、字段与类型、状态机、配置项与分界、错误码与归一化口径、日志矩阵），然后**派架构师做一次「设计文档一致性 CR」**（`custom/gpt-6-sol`）——通过后设计文档方视为与实现一致。理由：自测/联调期会累积多轮变更（本需求 CHG-01~15），设计稿通常滞后于代码；不对齐会误导后续维护与发布评审 | workflow/roles/cr-architect.md（新增一致性 CR 检查项）、workflow/roles/architect.md、workflow/ORCHESTRATOR.md（门禁：`testing` → `ready-release` 前置）、workflow/PROFILE.md、`.pi/commands/cr.md`、templates/03-design.md | 已批准并落实 2026-10-09（用户直接指令：「自测全部完成后 要根据最新的代码流程 把设计文档上有出入的地方 重新补齐 并让架构师重新CR」） |
| EP-07 | 2026-10-20 | REQ-20260922-jiabao-cash-coupon | **需求承接过程纪律 5 条上收为流程级**（此前只落在单需求 `00-meta.md`/`requirements/README.md`，换项目即失效）：①**账本口径** —— `CR 轮次` = 同一提交内已落盘的**最高**轮次（不是 +1，须等于 `06-cr-report.md` 最后一条）；`返工次数` = 同档案链每次「不通过」计 1（通过轮与限定范围收敛通过轮不计）；EP-05 代码 CR（含代码/档案混合批）**不计**入档案链返工，只推进轮次；两者须同批落盘且写成 `N = N-1 + 1` 可核算式。②**纯档案批时态纪律** —— 描述未实施代码一律将来时并显式标「（本批仅档案：代码待实施、不随本批提交）」；门禁写「基线（上一变更现状）…实现后须复跑并登记新计数」，禁止把未跑的用例/门禁写成通过；代码批须**同批**把「待实施」翻成事实并同步计数三件套（`08-test-plan` 总数/类型分布/执行状态 + `09-release` 测试执行行）。③**收敛复核轮次** —— 每轮 CR 的 M 项修订后**必须**收敛复核，不得自行宣布闭环；复核默认**限定范围**（只核上轮 M/m 闭环 + 有无新引入实质矛盾，不重开全案），标题写「限定范围收敛复核」；评审明示「不再开轮」时不额外加轮。④**关键判据必须被用例钉住 + 变异验证** —— 结论依赖的日志字段位/报文键/常量/开关位必须有断言；须做「临时摘掉必 FAILURE」自证，验证后恢复源码并在 CR 记录留证。⑤**EP 编号体系对齐** —— 项目级 `requirements/README.md` 须列出 EP-01~EP-06 释义。理由：本需求 CHG-21~CHG-39 期间这 5 条被反复使用并多次因缺失而返工（轮次/返工口径核错、纯档案批把「待实施」写成已完成、M 项未复核、日志字段位无断言导致假绿），但当时只写进单需求档案，跨项目不可复用 | workflow/PROFILE.md（五、协作与流程偏好）、workflow/templates/00-meta.md（账本字段口径注释）、workflow/roles/cr-architect.md（检查清单）、.pi/commands/cr.md、.pi/commands/dev.md、.pi/commands/pre-release.md、requirements/README.md（模板） | 待审批 |
| EP-08 | 2026-10-26 | REQ-20260922-jiabao-cash-coupon | **外部口径「双证」准入**：外部枚举/状态位/必填性/金额单位/幂等键语义，接入期必须同时具备①书面确认（对接人+文档版本）②真实报文样本（正例+反例），并各落一条断言用例；缺任一项不得进入开发。理由：本需求 `yn` 凭「消息定义」间接描述推断（yn=1=取消）⇒ 线上误解冻（问题单 810463649477）；`requestId` 幂等语义（失败结果也被缓存）未先确认 ⇒ 改 3 次；`orderNo` 因卡系统文档 V5→V6 返工；券码取数 `realMoney`→只读 `oriMoney` 返工 2 次 | 工作流/PROFILE.md 五、协作与流程偏好；workflow/templates/02-clarification.md（口径矩阵）；.pi/commands/req-clarify.md | 待审批 |
| EP-09 | 2026-10-26 | REQ-20260922-jiabao-cash-coupon | **端到端可达性探针（开发中期）**：凡依赖上游位图/标识位/路由位的链路，必须在开发中期用真实样本跑通一次端到端，不可达即升级为阻塞项并当日反馈，不得等到自测尾。理由：用券单中台映射缺位号 1487（19 项 vs 购券单 20 项）⇒ 链路6/8「代码完成但永久不生效」被隐藏数周 | workflow/roles/developer.md；.pi/commands/dev.md；workflow/templates/05-tasks.md（T-xx 可达性任务） | 待审批 |
| EP-10 | 2026-10-26 | REQ-20260922-jiabao-cash-coupon | **可观测性进 DoD**：异步/定时/MQ 链路入口必须自带 traceId（或等价串联键）并有用例钉住，不接受「上线后再说」。理由：DongJob 补偿任务 `[%X{traceId}]` 恒空，一轮 16 条待办无法归因，直到用户抱怨才补（CHG-42） | workflow/roles/developer.md；workflow/roles/cr-architect.md（检查清单）；workflow/templates/05-tasks.md | 待审批 |
| EP-11 | 2026-10-26 | REQ-20260922-jiabao-cash-coupon | **联调副产物治理**：转发/旁路类联调必须①收尾清单含「清理补偿待办与脏数据」②补偿任务设 `attempt` 上限、超限转人工核查队列。理由：预发转发把线上消息投预发 ⇒ 任务 41237 执行日志（2026-10-26）显示登记 14 条「取消缺流水」待办，反查预发积理查不到线上单 ⇒ 确定性失败仍每 10 分钟无限重试+告警 | .pi/commands/pre-release.md；workflow/templates/09-release.md；workflow/roles/developer.md | 待审批 |
| EP-12 | 2026-10-26 | REQ-20260922-jiabao-cash-coupon | **开关-链路矩阵评审**：设计评审强制输出「开关 × 链路」矩阵（每个开关精确管哪几条链路、哪些链路无独立开关），灰度策略以此为输入。理由：起草灰度时才发现 `confirmVoucherFreeze`（链路5 写操作）只受总开关门控 ⇒「先只读联调」设想不成立 | workflow/roles/architect.md；workflow/roles/cr-architect.md；workflow/templates/03-design.md | 待审批 |

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
| HC-17 | 2026-10-07 | 习惯候选 HC-17 生效：全链路日志完整性——新代码/新链路必须入口入参/外部调用请求响应/关键分支/写库/异常兜底/出参逐环有日志，仅凭日志可还原完整执行路径；联调发现日志缺环按缺陷回补 | workflow/PROFILE.md 二、编码风格 |
| EP-06 | 2026-10-09 | 流程优化提案 EP-06 生效：自测（预发/联调）全部完成后，必须以**最新代码实现**为基准回流补齐设计文档（有出入处更正），并派架构师做一轮「设计文档一致性 CR」（`custom/gpt-6-sol`），通过后方可进入 `ready-release` | workflow/PROFILE.md 四、协作与流程偏好 + workflow/roles/cr-architect.md（一致性 CR 章节）+ workflow/ORCHESTRATOR.md（门禁） |
| HC-18 | 2026-10-09 | 习惯候选 HC-18 生效：**网关屏蔽上游不合理设计**——卡网关必须尽可能屏蔽掉上游卡系统的不合理设计，对外契约以网关统一语义为准、不暴露上游怪异；处置手段=语义归一化 + 防御性兼容（错拼/类型漂移/数组）+ **明确对外保证**（如 `vouchers` 与 `errors` 互斥，即便卡系统两侧可重叠）+ 必要时自算语义并补字段（如 `total` 自算、补 `endDate`） | workflow/PROFILE.md 三、架构偏好 |
## 四、复盘数据总览（跨需求趋势）

> 每次 `/retro` 后追加一行，用于观察流程健康度趋势。

| 需求编号 | 总耗时 | 返工次数 | CR 轮次 | 人工打回次数 | 主要卡点 |
|---|---|---|---|---|---|
| <!-- REQ-xxx | | | | | --> | |
| EP-07 | 2026-10-20 | 流程优化：需求承接过程纪律 5 条上收（账本口径 / 纯档案批时态 / 限定范围收敛复核 / 关键判据变异验证 / EP 编号对齐） | workflow/PROFILE.md 五、协作与流程偏好；workflow/templates/00-meta.md；workflow/roles/cr-architect.md；.pi/commands/cr.md、dev.md、pre-release.md；requirements/README.md |
