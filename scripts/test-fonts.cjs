const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fontkit = require('fontkit');
const files = [
  ['public/fonts/opendyslexic-regular.woff2', 'f007004af3cda5d8076e57c943f8cc8d00a0da25988b1ae1048683d60e7cac1a'],
  ['public/fonts/opendyslexic-bold.woff2', 'dd9fa9c7991113b0dddefe9506a30ad26b48e302b7a8fb91719a4726e8fde85b'],
];
const chars = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя0123456789';
for (const [path, hash] of files) {
  const buffer = fs.readFileSync(path);
  assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'), hash, `Unmodified upstream font: ${path}`);
  const font = fontkit.create(buffer);
  assert.match(font.familyName, /OpenDyslexic/i);
  for (const char of chars) assert.ok(font.hasGlyphForCodePoint(char.codePointAt(0)), `Missing ${char} in ${path}`);
}
assert.match(fs.readFileSync('public/licenses/opendyslexic-ofl.txt', 'utf8'), /SIL OPEN FONT LICENSE Version 1.1/);
console.log('OpenDyslexic: оригинальные файлы, русские буквы, цифры и лицензия проверены');
