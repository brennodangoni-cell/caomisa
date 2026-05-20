const fs = require('fs');
const css = fs.readFileSync('styles.css', 'utf-8');
const lines = css.split('\n');
let depth = 0;
for (let i = 0; i < lines.length; i++) {
  const oldDepth = depth;
  for (let j = 0; j < lines[i].length; j++) {
    if (lines[i][j] === '{') depth++;
    if (lines[i][j] === '}') depth--;
  }
  if (depth === 1 && oldDepth === 0) {
    console.log('Opened block at line', i+1, lines[i]);
  }
  if (depth === 0 && oldDepth === 1) {
    console.log('Closed block at line', i+1);
  }
}
