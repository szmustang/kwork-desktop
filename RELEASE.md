# Kingdee KWork macOS Release 流程

## 前提条件

- 已导入 Developer ID Application 签名证书（cq.p12）到钥匙串
- 已导入 Apple 中间证书（DeveloperIDG2CA.cer）
- 已安装项目依赖：`npm install`

## 发布步骤

### 1. 打包签名

```bash
npm run dist:mac
```

生成签名的 DMG 文件到 `release/` 目录。

### 2. 公证

```bash
xcrun notarytool submit "release/Kingdee KWork-1.0.0-arm64.dmg" \
  --apple-id "szmustang@hotmail.com" \
  --password "zgrl-xmmk-pxtd-dbad" \
  --team-id "8M8Y7973D3" \
  --wait
```

等待 Apple 审核通过（通常 3-10 分钟）。

### 3. 钉合（Staple）

```bash
xcrun stapler staple "release/Kingdee KWork-1.0.0-arm64.dmg"
```

### 4. 分发

`release/` 目录下的 DMG 即可分发给用户使用。

## 签名信息

| 项目 | 值 |
|------|-----|
| 证书 | Developer ID Application: Kingdee International Software Group Company Limited (8M8Y7973D3) |
| Team ID | 8M8Y7973D3 |
| Bundle ID | com.kingdee.kwork |

## 注意事项

- 版本号在 `package.json` 的 `version` 字段中修改
- 如果公证失败（500 错误），等几分钟后重试即可
- 公证需要联网，DMG 会上传到 Apple 服务器扫描
- 可通过 `xcrun stapler validate "release/xxx.dmg"` 验证钉合状态
