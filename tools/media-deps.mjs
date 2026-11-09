import {createRequire} from 'node:module';
// sharp is installed with the game's dev dependencies.
export default createRequire(new URL('../game/package.json',import.meta.url))('sharp');
