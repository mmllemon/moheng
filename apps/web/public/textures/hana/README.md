# Hana 1.1.35 原版纸纹

本目录的 PNG 来自本机安装的 **Hana 1.1.35-beta** renderer：

`C:\Users\leema\.hanako\artifacts\renderer\1.1.35-beta-win32-x64-...\assets\textures\`

- `rice-*`：宣纸（mottle / fiber）
- `cotton-*`：棉纸（mottle / fiber）
- `fine-*`：细纸（mottle / fiber）
- `grain-*`：三种纸纹共用的颗粒层

均为 Hana PaperTextureLayer 使用的 hi/lo 遮罩原图，按 1024 / 720 / 256px 平铺；
墨衡通过 `data-paper-texture` 和 `--paper-texture-strength` 使用。

**授权提醒：** 这些是 Hana 的原始素材，不是墨衡自绘资产。对外公开仓库或分发前，
请确认 Hana 的许可范围；若没有再分发授权，应替换为内部授权素材或重新生成的等价纸纹。
