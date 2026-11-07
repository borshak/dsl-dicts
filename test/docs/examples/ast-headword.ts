import { parseHeadword } from 'dsl-dicts';

const headword = parseHeadword('{to }colo(u)r(s)', { positions: false });
console.log(headword.display); // [ { type: 'text', text: 'to colo(u)r(s)' } ]
console.log(headword.text); // 'to colo(u)r(s)'
console.log(headword.variants); // [ 'color', 'colors', 'colour', 'colours' ]
