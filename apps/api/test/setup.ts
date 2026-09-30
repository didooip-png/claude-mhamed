import 'reflect-metadata';
import { installBigIntJson } from '../src/common/json.js';
import { applyTestEnv } from './env.js';

applyTestEnv();
installBigIntJson();
