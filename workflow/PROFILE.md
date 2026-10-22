# 开发者画像（PROFILE.md）

> 记录开发者的编码习惯与偏好。父 Agent 派发任何任务简报时必须附上本文件关键内容，保证所有角色 Agent 的产出贴合个人风格。
>
> **维护规则**：本文件不直接由 Agent 修改。执行需求过程中观察到的「习惯候选」先记入 [EVOLUTION.md](./EVOLUTION.md) 候选区，经用户确认后才合并到本文件。

## 一、技术偏好

<!-- 例：常用语言/框架、偏好库、避免的方案 -->

| 维度 | 偏好 | 备注 |
|---|---|---|
| （待积累） | | |

## 二、编码风格

<!-- 例：命名风格、注释习惯、函数粒度、错误处理方式 -->

| 维度 | 偏好 | 示例/反例 |
|---|---|---|
| 空值判断 | 用 `Objects.isNull()` / `Objects.nonNull()`，禁止 `== null` / `!= null` 裸判 | `if (Objects.isNull(param.getTenantId()))` |
| 工具类 | 尽量使用 apache 工具类（commons-lang3 等），不手写字符串/集合判空等 | `StringUtils.isBlank`、`CollectionUtils.isEmpty` |
| 入参判空 | 入参含 tenantId 必须判空（不能为 null） | 门面/入口第一道口子校验 |
| 配置化 | 分界判据=**变动概率**：业务初期不确定 / 需运行期调整的（上限、阈值、运营参数）一律 **ducc**；稳定不变的（JSF 超时/重试、租户 id、别名、sendpay 位次等）才放 **properties**。禁止把初期易变的配置放 properties（改一次要发版重启），也不要把稳定配置挂 ducc | 正例：券码数量上限、试算抵扣上限、转券开关→ducc；JSF 超时/租户 id/别名→properties。反例：把券数量上限 297/50 放 properties（业务初期频繁调整） |
| 日志规范 | 中文日志，格式【XXX 层】XXX 服务-入参/出参/异常 | `log.info("【JSF PROVIDER】校验卡有效性-入参param={}", ...)` |
| 对外接口注释 | 对外接口 javadoc 只写接口功能+出入参契约（字段含义/错误码/重试语义）；内部实现逻辑（开关降级/租户分发/底层调用/映射机制）不写，外部系统无需感知 | 反例：在对外接口注释里写"功能总开关降级返回…不打到卡系统" |
| 类命名后缀 | 实现类用 `XxxFacadeImpl`/`XxxServiceImpl`/`XxxWrapperImpl` 等 Impl 后缀；`Controller` 只用于对外 web 层（HTTP 接口）；禁止用 Controller 命名 JSF/内部服务实现 | 反例：JSF 门面实现命名 XxxController（存量 CardController 等按 HC-04 不动，新代码不再沿用） |
| 方法入参数量 | 入参**超过 3 个**必须封装为参数对象（Query/Command/Param）传递，禁止长参数列表 | 反例：`checkVoucherSaleable(Long, List, String, String)` → 改 `checkVoucherSaleable(CashVoucherSaleableQuery)` |
| RPC 调用方式 | RPC 层禁止泛化/类泛化调用：不得用「统一入口 + 字符串方法名 / 传 lambda（函数式接口）+ Map 参数」的模板形态，**每个方法内必须直接出现远端调用语句**（如 `cashVouchers.search(param)`）。允许抽取**不接收 lambda/方法名**的通用处理方法（异常分类、超时设置与清理、空返回判定）。第三方 SDK 若本身是 Map 弱类型出入参，Map 只允许出现在 wrapper 边界内 | 反例：`invokeCashVouchers(cashVouchers::search, "购券可售卖校验", param)`；正例：方法内直接 `cashVouchers.search(param)` + `throw mapRpcException(e, scene, param)` |
| 日志完整性（全链路） | **新代码/新链路写完后，全链路日志必须齐全**：入口入参、外部调用请求/响应、关键分支走向（降级/跳过/拒绝/幂等命中）、写库动作与结果、异常与兜底、出参，每一环都要有日志（中文【XXX层】格式），确保**仅凭日志即可还原一次调用的完整执行路径**，便于初期排查与联调；上线前联调发现"日志缺环"按缺陷回补 | 反例：冻结成功但本地落库失败时，日志看不出锁获取返回的原始值，只能靠猜（2026-10-07 冻卡流水缺失定位受阻的教训）；正例：冻结链路入参→卡系统请求/响应→锁获取结果→落库/跳过→出参逐环可查 |
| 方法简洁与单一职责 | 每个方法尽可能简洁：主方法只负责流程编排（每步一行调用，不做细节），对象转化/组装/校验等拆为独立方法；遵守单一职责（一个方法一件事）与开闭原则（扩展点用 SPI/策略/分发表，不硬编码 if-else 分支堆砌） | 反例：主方法里内联 Map→模型转换、循环组装 DTO、多段 if 分支 |
| 中间件参数配置 | JSF/HTTP/RPC 等中间件的参数（超时、重试次数、校验开关、别名等**全部参数**，不止超时）必须在配置文件（如 bootstrap 的 `META-INF/spring/spring-jsf-consumer.xml`，值一律走 properties 占位符，不硬编码）中配置；禁止在代码里通过 RpcContext/attachment 等运行时 API 动态设置调参 | 反例：`timeout="3000"` / `retries="0"` 硬编码；`RpcContext.getContext().setAttachment(Constants.HIDDEN_KEY_REQUEST_TIMEOUT, timeout)` |

## 三、架构偏好（已确认）

| 维度 | 偏好 |
|---|---|
| 设计方法论 | 设计层严格 DDD；实现层三层架构，不用纯血 DDD |
| 分层职责 | API 层=校验+防腐+转化；业务层=全部业务逻辑（可再拆子层）；外部依赖层=转化+防腐、无业务逻辑、足够通用 |
| 调用约束 | 单向调用，禁循环依赖 |
| 校验策略 | 下层信任上层，不做冗余参数校验，保持精简 |
| 部署形态 | 云端分布式部署，严禁单机假设（本地内存缓存/本地文件/单机锁/内存态跨请求），接口幂等 |
| 边界意识 | 上下文/接口/事务/数据四类边界先定义再动手 |
| 注释与日志 | 关键路径必打日志（带业务标识、异常带堆栈、敏感脱敏）；公共接口与复杂逻辑写 why 注释 |
| 对外能力通用化 | **所有平台及领域层的能力建设**（不限卡网关）：对外契约（接口门面/模型/别名/配置项）必须通用化、按租户/业务类型策略分发，禁止业务线专属命名与专属语义；业务线命名只允许在内部实现层（Service/Wrapper/Constant），新业务线接入=新增内部实现（如 Handler），不改对外契约 |
| 对外命名与类型统一 | 对外契约的同名字段命名与类型必须全局统一：租户=tenantId(Long)、门店=storeId(Long)、商品=skuId(Long)、券码=voucherCode、金额=BigDecimal(元) 等；外部系统/业务线的异名异型（如卡系统的 sku String）一律在防腐层转换，不泄漏到对外契约 |
| 语义归一化 | 平台网关除透传外必须具备归一化能力：下游各系统的语义差异（错误码/状态码/枚举口径）由网关在防腐层归一化为统一语义后对外，防止下游语义差异扩散到调用方；原始值作为 raw 明细保留透传（不丢信息、便于排查）；新业务线接入=在各自防腐层实现映射，对外统一语义不变 |
| 已有接口影响范围控制 | ①已有对外接口即使命名/类型不符合新规范也**保持不动**，新规范只约束新建契约，防止影响范围扩大、尽可能不让上游改动；②已有接口的内部逻辑改动要控制影响范围：历史逻辑必须兼容，且新逻辑可降级（开关/门控兜底）；③对外服务接口有任何契约变动（新增接口/字段），必须同步升级对应 jar 包版本并记录发布日志 |
| 屏蔽上游不合理设计 | **卡网关必须尽可能屏蔽掉上游卡系统的不合理设计**：对外契约以网关统一语义为准，**不把上游怪异暴露给调用方**。已知并已屏蔽的卡系统怪异：①`vouchers` 与 `errors` **可重叠**（同一券码同时出现在两侧）→ 对外**保证互斥**（按 `errors` 券码差集剔除）；②`total` 语义是「可用券数」而我方对外定义为「本批总数」→ 网关自算；③`reasonType` 粒度过粗（过期/已核销作废/状态不允许混为一谈）且有**错拼** `STATUS_INVAILD` → 逐类还原 + 拼写防御；④`過期` 不是独立状态、靠 `endDate`（字符串 `yyyy-MM-dd`）判定 → 网关透出 `endDate` 事实，不自造过期结论；⑤字段集与类型随接口漂移（`sku` 数组 vs 单值、`storeId` 字符串 vs 数字、`requestId` 回显不一致、`vouchers[]` 字段集按接口不同）→ 防腐层兼容并统一；⑥券码 key / assetType 无权威定义 → 引用上游枚举定源 + 守护单测。处置手段：语义归一化、防御性兼容（错拼/类型漂移/数组）、**明确对外保证**、必要时自算语义并补字段 |

## 四、协作与流程偏好

<!-- 例：提交信息格式细节、分支策略、评审偏好 -->

| 维度 | 偏好 | 备注 |
|---|---|---|
| 提交信息 | `REQ-xxx: <描述>` | 强制关联需求编号 |
| 测试验证口径 | 单测/编译验证必须用项目 pom 真实依赖版本（mvn test，IDEA 同环境：JDK8 + ~/devTools/apache-maven-3.9.2/bin/mvn，本地仓库 /Users/guanbwenbo/maven/worker）；禁止用 scratch 高版本库代替验证 | 教训：mockito 3.x API verifyNoInteractions 在项目 2.19.0 下编译失败 |
| 设计阶段配置清单 | 方案设计阶段必须产出**配置清单**：逐项写清「配置项名 / 放哪里（properties vs ducc vs 中间件 XML）/ 默认值 / 用途 / 是否需运行期动态调整 / 变更影响」，作为设计稿固定章节与评审检查项 | 落实：templates/03-design.md 配置清单章节 + architect/reviewer 角色检查清单 |
| 角色模型指定 | **架构师CR（/cr 阶段）统一使用模型 `custom/gpt-6-sol`**（provider：智增增/自定义，显示名 GPT-6 Sol）；派发 CR 任务简报时必须带该 model 覆盖，不得用默认模型或降级为其他模型 | 前置：需在 PI-Desktop 设置中把该模型加入委派目录（2026-09-28 已加入）；派发时 model 必须写全 `custom/gpt-6-sol`（缺 provider 前缀会被拒）；落实：/cr 派发时 Task(model="custom/gpt-6-sol") |
| 计划工程师模型指定 | **计划工程师（/breakdown 阶段）统一使用模型 `custom/DeepSeek-V4.1-Flash-A-joybuilder`**（provider：oxygen-deepseek，显示名 DeepSeek-V4.1-Flash-A）；派发 WBS 拆解任务简报时必须带该 model 覆盖，不得用默认模型 | 2026-10-21 用户直接指令；派发时 model 必须写全 `custom/DeepSeek-V4.1-Flash-A-joybuilder`（缺 provider 前缀会被拒，且勿与智增增的 `custom/deepseek-v4.1-flash` 混淆）；落实：/breakdown 派发时 Task(model="custom/DeepSeek-V4.1-Flash-A-joybuilder") |
| 开发工程师模型指定 | **开发工程师（/dev 阶段）统一使用模型 `custom/DeepSeek-V4.1-Flash-A-joybuilder`**（provider：oxygen-deepseek，显示名 DeepSeek-V4.1-Flash-A）；派发编码实现任务简报时必须带该 model 覆盖，不得用默认模型 | 2026-10-21 用户直接指令；任务开发一律派 sub agent 执行，父 Agent 不直接写代码；派发时 model 必须写全 `custom/DeepSeek-V4.1-Flash-A-joybuilder`；落实：/dev 派发时 Task(agent="fixer", model="custom/DeepSeek-V4.1-Flash-A-joybuilder") |
| 方案评审门禁 | **任何方案产出（`03-design.md` 设计稿、`changes/CHANGES.md` 中的变更节）在进入开发前必须派发一次架构师评审**（角色 cr-architect=架构师CR，模型 `custom/gpt-6-sol`）；评审意见回写方案文件/变更节的「架构师评审意见」小节；不通过则先修订方案再复评（同一方案最多复评 2 轮，未收敛上报用户决策） | 落实：roles/cr-architect.md（方案评审职责/检查项）+ roles/architect.md（产出后提交评审）+ ORCHESTRATOR.md（门禁）+ .pi/commands/design.md、change.md + templates/03-design.md、CHANGES.md |
| 任何改动必须过架构师CR | 需求内**所有**代码改动（含 /dev 产出、CR 修复、minor 加固、父 Agent 直接小修）合入前必须至少过一轮架构师CR（`custom/gpt-6-sol`）；允许聚焦增量 CR（只评审该增量 commit），不得以"改动小"为由跳过；未过 CR 的改动不得视为完成/推进状态/上线 | 落实：EP-05 + .pi/commands/cr.md（增量 CR 说明）+ roles/cr-architect.md + ORCHESTRATOR.md |
| 变更台账与文档精简 | **每个需求只保留一个变更文件**：`changes/CHANGES.md` 单文件台账，每次变更**追加一节**（CHG-01 起自增），**禁止**每次变更新建 `CHG-NN.md` 文件；阶段文档不重复堆叠（实施细则并入所属阶段文档，如派发简报并入 `05-tasks.md`），同一需求档案控制在 10 个文档量级 | 落实：templates/CHANGES.md（替换原 CHG-NN.md 模板）+ .pi/commands/change.md + roles/risk-officer.md + ORCHESTRATOR.md/WORKFLOW.md；2026-09-28 首个需求已按此整理（CHG-01~05 合并为单文件台账） |
| 环境配置口径 | 测试 / 预发 / 线上环境的配置（**properties 与 ducc 项**）统一在各环境 **JDOS 配置文件**中单独抽取维护；仓库内 `src/main/resources/*.properties` 仅作本地/默认兜底，**不是环境配置来源**。设计与部署文档写「配置放哪里」时应落到「JDOS 配置文件（按环境）」；评审**不得**因 `@LafValue` 是否带 `name`（命名空间写法）判缺陷——配置抽取方式由 JDOS 决定 | 2026-09-29 用户澄清（起因：误将 11 处未带 `name` 的 `@LafValue` 判为 ducc 落点缺陷）；落地：`DEPLOY-CONFIG.md` §0 + `07-cr-handoff.md` D-01 |
| 问题定位派发原则 | **bug/问题定位类任务（含派发架构师定位）的简报只给客观现象与已核实事实**（日志原文、操作步骤、环境状态、查询结果），**禁止夹带父 Agent 的主观猜测、方向预设或候选根因清单**；由子代理自行从证据出发定位，避免锚定效应导致误判 | 2026-10-07 用户明确（起因：冻卡流水缺失问题派发时简报预设了"锁获取失败"方向）；后续所有 bug 定位均按此原则 |
| 自测收尾：设计文档一致性对齐 + 一致性 CR | 需求**自测（预发/联调）全部完成后**，必须**以最新代码实现流程为基准**逐条核对设计文档（`03-design.md` 及受影响的 `08-test-plan.md`/`09-release.md`/`DEPLOY-CONFIG.md`），把**代码与设计稿有出入的地方重新补齐/更正**（链路图与时序、字段与类型、状态机、配置项与分界、错误码归一化口径、日志矩阵），然后**派架构师做一次「设计文档一致性 CR」**（`custom/gpt-6-sol`）；未通过不得进入 `ready-release` | 2026-10-09 用户直接指令；落实：EP-06 + `roles/cr-architect.md`（一致性 CR 检查项）+ `ORCHESTRATOR.md` 门禁；起因：本需求自测期累积 CHG-01~15，设计稿滞后于代码 |
| 账本口径（CR 轮次 / 返工次数） | `CR 轮次` = 同一提交内已落盘的**最高**轮次（须等于 `06-cr-report.md` 最后一条，**不是 +1**）；`返工次数` = 同一档案链每次「不通过」计 1（通过轮、限定范围收敛通过轮**不计**）；**EP-05 代码 CR（含代码/档案混合批）不计入档案链返工**，只推进轮次；两者与该轮记录**同批**落盘，并写成 `N = N-1 + 1` 形式可核（EP-07） |
| 纯档案批时态纪律 | 描述未实施代码一律用将来时并显式标「**（本批仅档案：代码待实施、不随本批提交）**」；门禁写「**基线（上一变更现状）**…实现后须复跑并登记新计数」，**禁止**把未跑的用例/门禁写成已通过；代码实施批须**同批**把「待实施」全部翻成事实并同步计数三件套（`08-test-plan` 用例总数/类型分布/执行状态 + `09-release` 测试执行行）（EP-07） |
| 收敛复核轮次 | 每轮 CR 的 **M（major）项修订后必须收敛复核**，不得自行宣布闭环；复核默认**限定范围**（只核上轮 M/m 是否闭环 + 有无新引入实质矛盾，不重开全案），轮次标题写「限定范围收敛复核」；评审明示「改字后可提交、不再开轮」时不额外加轮（EP-07） |
| 关键判据必须被用例钉住 + 变异验证 | 结论依赖的**日志字段位 / 报文键 / 常量 / 开关位**必须有断言钉住；该断言须做**变异验证**（临时摘掉字段位或改坏取值，用例必须变红；验证后恢复源码），并在 CR 记录中留证（EP-07） |

## 五、反模式（明确不想要的）

<!-- 记录用户明确否定过的做法，角色 Agent 必须避免 -->

| 反模式 | 记录来源（需求编号/日期） |
|---|---|
| 纯血 DDD 的重型实现（强制 Repository 模式、聚合工厂等） | 工作流设计确认 |
