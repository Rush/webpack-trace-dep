#!/usr/bin/env node
import { readFile } from 'fs/promises';
import { set } from 'lodash';
import { StatsCompilation } from 'webpack';
import chalk from 'chalk';
import { asTree } from 'treeify';
import yargs from 'yargs/yargs';

const argvPromise = yargs(process.argv.slice(2)).command('* <statsFile> <module>', 'Some descirption', args => {
}).positional('statsFile', {
  describe: 'location of the webpack stats json file (generate with "webpack --stats")',
  demandOption: true,
  type: 'string',
}).positional('module', {
  describe: 'substring of module name to show the dependency tree for - this is usually a filename',
  demandOption: true,
  type: 'string',
}).options({
  chunk: { alias: 'c', description: 'limit to a specific chunk or chunks (regex)', type: 'string', demandOption: false },
  depth: { alias: 'd', description: 'how deep to look in the tree', type: 'number', demandOption: true  },
  highlight: { alias: 'h', description: 'highlight specific module patterns', type: 'string' },
  highlightChunk: { alias: 'H', description: 'highlight specific chunk patterns', type: 'string' },
  trimTree: { alias: 't', description: 'trim leaves of the tree matching specific pattern', type: 'string' },
  skipModules: { alias: 's', description: 'skip modules from specific chunk', type: 'string' },
  showRequest: { alias: 'i', description: 'show user request for each import', type: 'boolean' },
}).argv;


type Mod = { name: string, userRequest: string, chunkName: string };

async function main() {
  const argv = await argvPromise;
  const parsed: StatsCompilation = JSON.parse(await readFile(argv.statsFile, 'utf-8'));
  const cache: { [id: string]: { [key: string]: Mod } } = {};

  if (!parsed || !parsed.chunks) {
    return;
  }
  const limitToChunk = argv.chunk;

  if (limitToChunk) {
    for (const chunk of parsed.chunks) {
      if (!chunk.files?.[0]) {
        continue;
      }
      if (limitToChunk && chunk.files.find(f => f.includes('.js')) && !chunk.files.find(f => f.includes('.js'))?.match(new RegExp(limitToChunk))) {
        continue;
      }
      console.log(`Searching in chunk: ${chalk.bold(chunk.files[0])}`, chalk.gray(`(regex: ${limitToChunk})`));
    }
  }

  const moduleToChunk: { [id: string]: string } = {};

  for (const chunk of parsed.chunks) {
    if (!chunk.files?.[0]) {
      continue;
    }

    if (!chunk.modules) {
      continue;
    }

    const chunkName = chunk.files.find(f => f.includes('.js')) || chunk.id?.toString()!;;
    for (const module of chunk.modules) {
      if (module.name) {
        moduleToChunk[module.name] = chunkName;
      }
    }

    if (limitToChunk && chunk.files.find(f => f.includes('.js')) && !chunk.files.find(f => f.includes('.js'))?.match(new RegExp(limitToChunk))) {
      continue;
    }

    for (const module of chunk.modules) {
      if (!module.name) {
        continue;
      }

      if (!module.reasons) {
        continue;
      }

      cache[module.name] = module.reasons.map(reason => {
          return { name: reason.moduleName!, userRequest: reason.userRequest!, chunkName };
      }).reduce((acc, { name, ...rest }) => {
        acc[name] = { name, ...rest };
        return acc;
      }, {} as { [key: string]: Mod });
    }
  }
  const moduleToTrace = Object.keys(cache).find(key => key.includes(argv.module));
  if (!cache[moduleToTrace!]) {
    console.log(`Cannot find any module matching substring '${moduleToTrace}' (out of ${Object.keys(cache).length} available)`)
    process.exit(1);
  }

  console.log('Searching for module', chalk.bold(moduleToTrace), chalk.gray(`(query: ${argv.module})`));

  if (!moduleToTrace) {
    return;
  }

  const tree: any = {};
  const highlightRegex = argv.highlight ? new RegExp(argv.highlight!) : undefined;
  const highlightIfNeeded = (name: string) => {
    if (name === moduleToTrace) {
      return chalk.bold(name);
    } if (highlightRegex?.test(name)) {
      return chalk.yellowBright(name);
    } else {
      return name;
    }
  };

  const highlightChunkRegex = argv.highlightChunk ? new RegExp(argv.highlightChunk!) : undefined;
  const highlightChunkIfNeeded = (name: string) => {
    if (highlightChunkRegex?.test(name)) {
      return chalk.redBright(name);
    } else {
      return chalk.gray(name);
    }
  };

  const trimTreeRegex = argv.trimTree ? new RegExp(argv.trimTree!) : undefined;

  const skipModulesRegex = argv.skipModules ? new RegExp(argv.skipModules!) : undefined;

  function resolveMods(key: string, depth: number, source: string[] = [ key ]) {
    depth--;
    if (depth < 0) {
      return;
    }

    const mods = cache[key];
    if (!mods) {
      return;
    }

    for (const mod of Object.values(mods)) {
      if (!cache[mod.name]) {
        continue;
      }
      if (source.includes(mod.name)) {
        continue;
      }
      if (skipModulesRegex && skipModulesRegex.test(moduleToChunk[mod.name])) {
        continue;
      }

      const modSource = [ ...source, mod.name ];
      set(tree, modSource, `${moduleToChunk[mod.name]}`);

      Object.values(cache[mod.name])
        .forEach(({ name }) => {
          if (source.includes(name)) {
            return;
          }

          resolveMods(name, depth, [...modSource, name]);
        });
    }
    return;
  }
  resolveMods(moduleToTrace, argv.depth);

  type TreeBranch = {[id: string]: TreeBranch | string };
  const trimTreeBranch = (treeBranch: TreeBranch) => {
    for (const [key, value] of Object.entries(treeBranch)) {
      if (typeof value === 'string') {
          if (trimTreeRegex?.test(key)) {
            delete treeBranch[key];
          }
      } else {
        trimTreeBranch(value);
        if (Object.keys(treeBranch[key]).length === 0) {
          treeBranch[key] = moduleToChunk[key];
        }
      }
    };
  };
  for (let i = 0; i <= argv.depth;++i) {
    trimTreeBranch(tree);
  }

  const highlightTreeBranch = (treeBranch: TreeBranch, parentName?: string) => {
    return Object.entries(treeBranch).reduce((acc, [key, value]) => {
      const chunkKeyDecoration = (typeof value === 'string' || !parentName) ? '' : `: ${highlightChunkIfNeeded(cache[parentName][key].chunkName)}`;
      const decoratedKey = `${highlightIfNeeded(key)}${(parentName && argv.showRequest) ? `: ${chalk.gray(cache[parentName][key].userRequest)}` : ''}${chunkKeyDecoration}`;
      acc[decoratedKey] = typeof value === 'string' ? highlightChunkIfNeeded(value) : highlightTreeBranch(value, key);
      return acc;
    }, {} as TreeBranch);
  };
  const highlightedTree = highlightTreeBranch(tree);
  console.log(asTree(highlightedTree, true, true));
}

main();
