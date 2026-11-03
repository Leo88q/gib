const fs = require('node:fs');
const { Compiler } = require('inkjs/full');
for (const name of ['garden', 'rumor']) {
  const source = fs.readFileSync(`content/ink/${name}.ink`, 'utf8');
  const compiler = new Compiler(source);
  const story = compiler.Compile();
  if (compiler.errors.length) throw new Error(compiler.errors.join('\n'));
  fs.writeFileSync(`lib/content/ink/${name}.json`, story.ToJson() + '\n');
  console.log('compiled', name);
}
