const fs = require('node:fs');
const path = require('node:path');
const out = path.join(__dirname, '../resources/ocr');
fs.mkdirSync(out, { recursive: true });
for (const lang of ['eng', 'chi_sim']) {
  const data = require(`@tesseract.js-data/${lang}`);
  fs.copyFileSync(path.join(data.langPath, `${lang}.traineddata.gz`), path.join(out, `${lang}.traineddata.gz`));
  const packageRoot = path.dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
  fs.copyFileSync(path.join(packageRoot, 'package.json'), path.join(out, `${lang}.package.json`));
  fs.copyFileSync(path.join(packageRoot, 'README.md'), path.join(out, `${lang}.README.md`));
}
console.log('Offline English and simplified Chinese OCR resources ready.');
