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
