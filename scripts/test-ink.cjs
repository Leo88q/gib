const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Story, Compiler } = require('inkjs/full');
for (const name of ['garden', 'rumor']) {
  const content = fs.readFileSync(`lib/content/ink/${name}.json`, 'utf8');
  const compiled = new Compiler(fs.readFileSync(`content/ink/${name}.ink`, 'utf8')).Compile().ToJson();
  assert.deepEqual(JSON.parse(content), JSON.parse(compiled), `${name}: JSON не соответствует источнику`);
  let endings = 0;
  function visit(path) {
    assert.ok(path.length < 12, `${name}: возможное зацикливание`);
    const story = new Story(content);
    for (const selected of path) {
      while (story.canContinue) story.Continue();
      assert.ok(selected < story.currentChoices.length, `${name}: неверный выбор`);
      story.ChooseChoiceIndex(selected);
    }
    let text = '';
    while (story.canContinue) text += story.Continue();
    assert.ok(text.trim(), `${name}: пустая сцена`);
    if (!story.currentChoices.length) { endings++; return; }
    for (let i = 0; i < story.currentChoices.length; i++) visit([...path, i]);
  }
  visit([]);
  assert.ok(endings >= 3, `${name}: мало веток`);
  console.log(`  ok ${name}: ${endings} завершений, источник совпадает с JSON`);
}
