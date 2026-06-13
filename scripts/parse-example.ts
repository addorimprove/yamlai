import { parseProject } from '../src/index.js';

const project = parseProject('examples');
console.dir(project, { depth: null });
