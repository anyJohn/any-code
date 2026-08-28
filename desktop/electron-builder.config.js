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
    },
    win: {
        target: ["nsis"],
    },
    nsis: {
        oneClick: false,
        allowToChangeInstallationDirectory: true,
    },
};
