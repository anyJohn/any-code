/**
 * electron-builder config（SPEC-029）。
 * Win = NSIS exe，Linux = AppImage；mac = zip/dir（交叉构建产物，dmg 需 macOS hdiutil 暂不做）。
 *
 * 自包含策略：
 * - files: dist/main/main.cjs（esbuild bundle，内联 server+domain）+ package.json
 * - extraResources: web-dist + rg + busybox-win（解压到 process.resourcesPath，main.ts 读它）
 */
module.exports = {
    appId: "ai.anycode.desktop",
    productName: "AnyCode",
    executableName: "anycode", // 避免 @any-code/desktop 派生出含 @ 的可执行名
    directories: {
        output: "dist-installer",
    },
    files: [
        "dist/main/**/*",
        "package.json",
    ],
    // 内置能力目录解包出 asar：MCP 连接器经子进程 spawn（asar 内文件不可被执行），
    // 技能 references/scripts 也需给外部 bash 真实路径（builtinRoot() 自动映射 app.asar.unpacked）
    asarUnpack: ["dist/main/builtin/**"],
    extraResources: [
        { from: "resources/web-dist", to: "web-dist" },
        { from: "resources/rg", to: "rg" },
        { from: "resources/busybox-win", to: "busybox-win", filter: ["**/*"] },
    ],
    linux: {
        target: ["AppImage"],
        category: "Development",
        icon: "assets/icon/icon-512.png",
    },
    win: {
        target: ["nsis"],
        icon: "assets/icon/icon.ico",
    },
    // macOS：zip（可直接运行/分发）+ dir（解包 .app 便于测试）。dmg 需 macOS 上 hdiutil，Linux 构建不出。
    // 未签名 → Gatekeeper 需右键→打开。icon 给 ≥512 png，electron-builder 内置转 icns。
    mac: {
        target: ["zip", "dir"],
        category: "public.app-category.developer-tools",
        icon: "assets/icon/icon-1024.png",
    },
    nsis: {
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        include: "installer.nsh", // 卸载时弹确认删 ~/.anycode
    },
};
