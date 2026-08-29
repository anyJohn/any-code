/**
 * electron-builder config（SPEC-029）。
 * Win = NSIS exe，Linux = AppImage。macOS 不做（本 RR 排除）。
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
