# dsh-token-plan-monitor

DeepSeek Harness 插件，用于在侧边栏底部 API 余额或 Token Plan 用量。

目前支持：

- DeepSeek Platform 余额
- OpenCode Go

![cover](https://raw.githubusercontent.com/YOYOYOAKE/dsh-token-plan-monitor/main/docs/cover.png)

## 安装

```
dsh plugin --profile web add @yoyoyoake/dsh-token-plan-monitor
```

## 使用

### DeepSeek Platform

自动读取 DeepSeek API Key 查询余额。

### OpenCode Go

需要在 DeepSeek Harness 设置中额外配置用量查询参数：

- `WorkSpace ID`：从 URL 中复制；
- `Cookie`：从 DevTools 中获取。

## 开发

### 项目结构

```
├── package.json            # 插件 manifest：dsh.bundle / dsh.client；prepare 会自动构建 lib/
├── cordis.patch.yml        # 组合补丁层，声明插件行
├── tsconfig.host.json      # 宿主端 ESM 构建配置
├── tsconfig.client.json    # 客户端 CommonJS 构建配置
├── build.mjs               # 将编译后的客户端包装成浏览器 module-loader bundle
├── lib/                    # 构建产物，由 prepare 自动生成
├── docs/                   # 文档
└── src/
    ├── index.ts            # 宿主端：settings 持久化、自动检测、缓存、HTTP 端点
    ├── client.ts           # 客户端：侧边栏用量卡片 + 设置页
    ├── types.ts            # UsageProvider 契约与 wire 类型
    ├── shims.d.ts          # @deepseek-ai/dsh-settings 环境类型
    └── providers/          # 每个供应商一个文件
        ├── deepseek.ts     # DeepSeek Platform 余额查询
        └── opencode.ts     # OpenCode Go Token Plan 用量查询
```

### 添加新的提供商

1. 新建 `src/providers/my-vendor.ts`
2. 实现 `UsageProvider<T>`：
   - `id` / `name` / `description`
   - `configFields`：设置页需要填写的特殊参数
   - `credentialRefs`：候选凭据名
   - `usageConfigFields`：哪些参数填好后才能发起查询
   - `matchesModel()`：判断是否对应 DSH 中的某个 provider
   - `fetchUsage()`：调用供应商 API
   - `renderLines()`：把结果渲染成卡片行
3. 在 `src/index.ts` 的 `PROVIDERS` 数组中追加一行
4. 重新构建并安装：

```bash
npm run build
dsh plugin --profile web add .
```

### 常用开发命令

```bash
npm install          # 安装编译期依赖，并触发 prepare 构建 lib/
npm run typecheck    # 类型检查
npm run build        # 构建宿主端 + 客户端 bundle
```

开发时修改源码后重新执行 `npm run build`，刷新浏览器即可看到效果；`cordis.patch.yml` 会被 profile 的补丁监视器热重载。

## License

MIT.