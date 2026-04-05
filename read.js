const fs = require('fs');

const bStr = fs.readFileSync('baseline.txt', 'utf16le');
const cStr = fs.readFileSync('current.txt', 'utf16le');

console.clear();
console.log('--- BASELINE MODEL ---');
console.log(bStr);
console.log('--- ADVANCED MODEL ---');
console.log(cStr);
