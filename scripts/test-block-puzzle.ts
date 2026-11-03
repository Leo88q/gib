import { BLOCK_SOLUTION, BLOCK_STEPS, checkBlockOrder } from '../lib/content/block-puzzles.ts';
function check(value: boolean, reason: string) { if (!value) throw new Error(reason); }
check(new Set(BLOCK_STEPS.map(s => s.type)).size === BLOCK_STEPS.length, 'Блоки уникальны');
check(checkBlockOrder(BLOCK_SOLUTION), 'Правильный порядок принимается');
check(!checkBlockOrder([...BLOCK_SOLUTION].reverse()), 'Обратный порядок отклоняется');
check(!checkBlockOrder(BLOCK_SOLUTION.slice(1)), 'Неполный порядок отклоняется');
check(!checkBlockOrder([...BLOCK_SOLUTION, BLOCK_SOLUTION[0]]), 'Лишний блок отклоняется');
console.log('План команды: проверка порядка пройдена');

// Проверка настоящих соединений Blockly в headless workspace без генерации кода.
const Blockly = await import('blockly');
for (const step of BLOCK_STEPS) Blockly.defineBlocksWithJsonArray([{
  type: step.type, message0: step.label, previousStatement: null, nextStatement: null, colour: step.color,
}]);
const workspace = new Blockly.Workspace();
try {
  const blocks = BLOCK_STEPS.map(step => workspace.newBlock(step.type));
  blocks[0].nextConnection!.connect(blocks[1].previousConnection!);
  blocks[1].nextConnection!.connect(blocks[2].previousConnection!);
  const tops = workspace.getTopBlocks(false);
  check(tops.length === 1, 'Все блоки соединены');
  const connected: string[] = [];
  let block: import('blockly').Block | null = tops[0];
  while (block) { connected.push(block.type); block = block.getNextBlock(); }
  check(checkBlockOrder(connected), 'Соединённая цепочка проходит проверку');
  blocks[1].unplug();
  check(workspace.getTopBlocks(false).length === 2, 'Разъединённая цепочка не является одним планом');
  console.log('Blockly: реальные блоки соединяются и разъединяются');
} finally { workspace.dispose(); }
