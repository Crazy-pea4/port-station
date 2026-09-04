# Port Station · 服务控制台

一个极简的本地服务控制台:自动发现本机正在监听的端口,**智能区分「本地启动的开发服务」和「第三方应用」**(QQ、微信、Clash 等,路径位于 macOS `.app` 包内的进程),默认只展示前者。无需注册,关闭的服务自动从列表消失,不留记录;系统进程(root/守护进程)不会出现。

设计语言遵循 PlayStation 设计规范(`npx getdesign@latest add playstation` 的浅色模式):白底、PS 蓝药丸按钮(#0070d1)、8px 圆角卡片、轻字重(300)标题。已加 `darkreader-lock`,Dark Reader 等插件不会改写本站配色。

## 使用

```bash
npm install
npm run dev        # 开发模式,默认 http://localhost:3000
# 或
npm run build && npm start
```

- 每 5 秒自动扫描一次本机 TCP 监听端口(仅当前用户启动的进程,Port Station 自身除外)
- **智能分类**:通过 `ps` 查进程完整命令,路径含 `.app/` 的归为「第三方应用」(灰色标签,默认不展示,可切换查看),其余为「本地服务」(蓝色标签)
- 卡片展示:进程名、PID、端口、HTTP 状态码与响应耗时;悬浮进程名可看完整启动命令
- **打开**:有 HTTP 响应的服务可在浏览器直接打开;非 HTTP 服务置灰
- **关闭**:确认后向进程发送 SIGTERM(1.5 秒后仍在则 SIGKILL)
- **卡片图标**:左上角展示服务图标 —— HTTP 服务抓取其 favicon(含解析 `<link rel=icon>`),第三方应用从 `.app` 包内提取 icns 并转换;无图标的显示占位图形
- **智能标题**:图标右侧显示服务名称 —— 优先取进程工作目录下 package.json 的项目名,其次网页 `<title>`,第三方应用取 `.app` 的显示名,兜底进程名
- **关闭后驻留**:刚关闭的服务以「已关闭」状态留在页面中(仅本次会话内存,刷新即消失),保留了启动信息的可直接点「重新启动」拉起;无法恢复启动参数的显示「无法自动重启」+ 问号图标,悬停可见具体原因。重启信息的可恢复性:
  - 直接以绝对路径启动的命令(python/java/go 等):`ps` 保留完整 argv,可精确重启
  - `npm/pnpm/yarn start` 启动的 node 服务:子进程参数被框架改写,但父进程命令 + 工作目录可恢复
  - 直接运行且被框架改写标题的(如裸 `next start`):无法恢复,不提供重启按钮
- 不关心的端口点卡片右上角 × 隐藏,记录在浏览器 localStorage,可随时恢复
- 支持按端口、进程名、PID 搜索

## 技术栈

- Next.js 16(App Router)+ React 19 + Tailwind CSS v4
- 端口扫描:`lsof -nP -iTCP -sTCP:LISTEN -F pcnL`,按登录用户过滤 + 系统进程黑名单
- 分类:`ps -o pid=,command=` 取完整命令路径,`.app/` 包内进程识别为 GUI 应用
- 重启信息:关闭前捕获 `ps`(argv / 父进程命令)+ `lsof -d cwd`(工作目录),重启时以 detached 方式拉起;`/api/services/start` 对配方做严格白名单校验
- 关闭进程:`process.kill`,内置自身保护(不会杀掉 Port Station 自己)
- 无数据库、无外部依赖服务,纯本地运行
