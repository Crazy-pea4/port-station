export function Footer() {
  return (
    <footer className="border-t border-ps-hairline-light bg-ps-canvas-light">
      <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-1 px-5 py-6 text-[12px] font-medium text-ps-mute md:flex-row md:px-8">
        <p>PORT STATION · 自动发现本机监听端口，已过滤系统进程与第三方应用</p>
        <p>关闭的服务会自动从列表移除，不保留记录</p>
      </div>
    </footer>
  );
}
