import { parseProject } from '../src/index.js';

// examples/ lives at the repo root, one level up from builder/.
const project = parseProject('../examples');
console.dir(project, { depth: null });
