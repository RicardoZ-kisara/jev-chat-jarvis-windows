# Third-party components

The Windows port retains the upstream Jev Chat Jarvis MIT license and attribution in `LICENSE`.

| Component | Version | Source | License metadata |
| --- | --- | --- | --- |
| Electron | 44.4.3 | https://github.com/electron/electron | MIT; bundled Chromium notices accompany Electron |
| Tesseract.js | 7.0.0 | https://github.com/naptha/tesseract.js | Apache-2.0 |
| Tesseract.js core | See package-lock.json | https://github.com/naptha/tesseract.js-core | Apache-2.0 |
| Simplified Chinese data package | 1.0.0 | https://github.com/naptha/tessdata | npm package declares MIT |
| English data package | 1.0.0 | https://github.com/naptha/tessdata | npm package declares MIT |

The exact dependency graph is locked in `package-lock.json`. Production dependency license files are retained under `resources/app/node_modules` in the installed application. The language packages' original package metadata and README are copied beside their offline model files in `resources/ocr`. Electron's `LICENSE` and `LICENSES.chromium.html` remain in the distribution.

Build-only tools (electron-builder, Playwright and transitive packages) are not shipped as application dependencies.

QQ NT reader: `native/ntqq/vendor/KeyDumper.cs` and `ReadOnlyFile.cs` are adapted/copied from [Kevin-2106/NTQlean](https://github.com/Kevin-2106/NTQlean) at `fabe409d5c9bee57710abe779baabbb4f3b9f61a`, Copyright (c) 2026 Kevin-2106, MIT with the original additional disclaimer. The full notice is shipped in `licenses/NTQlean-LICENSE.txt`. The page cipher follows NTQlean's documented SQLCipher layout; this port adds strict HMAC rejection, stable-copy checks and committed WAL merging. No cleanup/deletion components from NTQlean are included.

The self-contained QQ reader includes Microsoft .NET 8 runtime components under their accompanying licenses. `resources/ntqq` includes the runtime LICENSE and ThirdPartyNotices files copied from the build SDK. Message field identifiers were researched using QQBackup/nt_msg_db_util documentation; no GPL Python implementation or generated Protobuf code is bundled. The JavaScript wire parser is implemented independently.
