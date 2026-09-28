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
| 配置化 | **静态配置（上限/阈值/超时/租户/别名等不常变动的）一律 properties**；**仅需运行期动态调整的（降级开关、运营开关）才用 ducc**。禁止把不常变动的配置放 ducc | 正例：券数量上限 297/50、JSF 超时、抵扣上限→properties；开关→ducc。反例：把超时/上限挂 ducc（需重启的配置不用上 ducc） |
| 日志规范 | 中文日志，格式【XXX 层】XXX 服务-入参/出参/异常 | `log.info("【JSF PROVIDER】校验卡有效性-入参param={}", ...)` |
| 对外接口注释 | 对外接口 javadoc 只写接口功能+出入参契约（字段含义/错误码/重试语义）；内部实现逻辑（开关降级/租户分发/底层调用/映射机制）不写，外部系统无需感知 | 反例：在对外接口注释里写"功能总开关降级返回…不打到卡系统" |
| 类命名后缀 | 实现类用 `XxxFacadeImpl`/`XxxServiceImpl`/`XxxWrapperImpl` 等 Impl 后缀；`Controller` 只用于对外 web 层（HTTP 接口）；禁止用 Controller 命名 JSF/内部服务实现 | 反例：JSF 门面实现命名 XxxController（存量 CardController 等按 HC-04 不动，新代码不再沿用） |
| 方法入参数量 | 入参**超过 3 个**必须封装为参数对象（Query/Command/Param）传递，禁止长参数列表 | 反例：`checkVoucherSaleable(Long, List, String, String)` → 改 `checkVoucherSaleable(CashVoucherSaleableQuery)` |
| RPC 调用方式 | RPC 层禁止泛化/类泛化调用：不得用「统一入口 + 字符串方法名 / 传 lambda（函数式接口）+ Map 参数」的模板形态，**每个方法内必须直接出现远端调用语句**（如 `cashVouchers.search(param)`）。允许抽取**不接收 lambda/方法名**的通用处理方法（异常分类、超时设置与清理、空返回判定）。第三方 SDK 若本身是 Map 弱类型出入参，Map 只允许出现在 wrapper 边界内 | 反例：`invokeCashVouchers(cashVouchers::search, "购券可售卖校验", param)`；正例：方法内直接 `cashVouchers.search(param)` + `throw mapRpcException(e, scene, param)` |
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

## 四、协作与流程偏好

<!-- 例：提交信息格式细节、分支策略、评审偏好 -->

| 维度 | 偏好 | 备注 |
|---|---|---|
| 提交信息 | `REQ-xxx: <描述>` | 强制关联需求编号 |
| 测试验证口径 | 单测/编译验证必须用项目 pom 真实依赖版本（mvn test，IDEA 同环境：JDK8 + ~/devTools/apache-maven-3.9.2/bin/mvn，本地仓库 /Users/guanbwenbo/maven/worker）；禁止用 scratch 高版本库代替验证 | 教训：mockito 3.x API verifyNoInteractions 在项目 2.19.0 下编译失败 |
| 设计阶段配置清单 | 方案设计阶段必须产出**配置清单**：逐项写清「配置项名 / 放哪里（properties vs ducc vs 中间件 XML）/ 默认值 / 用途 / 是否需运行期动态调整 / 变更影响」，作为设计稿固定章节与评审检查项 | 落实：templates/03-design.md 配置清单章节 + architect/reviewer 角色检查清单 |
| 角色模型指定 | **架构师CR（/cr 阶段）统一使用模型 `custom/gpt-6-sol`**（provider：智增增/自定义，显示名 GPT-6 Sol）；派发 CR 任务简报时必须带该 model 覆盖，不得用默认模型或降级为其他模型 | 前置：需在 PI-Desktop 设置中把该模型加入委派目录（2026-09-28 已加入）；派发时 model 必须写全 `custom/gpt-6-sol`（缺 provider 前缀会被拒）；落实：/cr 派发时 Task(model="custom/gpt-6-sol") |

## 五、反模式（明确不想要的）

<!-- 记录用户明确否定过的做法，角色 Agent 必须避免 -->

| 反模式 | 记录来源（需求编号/日期） |
|---|---|
| 纯血 DDD 的重型实现（强制 Repository 模式、聚合工厂等） | 工作流设计确认 |
