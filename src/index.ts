#!/usr/bin/env node
import { readFile } from 'fs/promises';
import { set } from 'lodash';
import { StatsCompilation } from 'webpack';
import chalk from 'chalk';
import { asTree } from 'treeify';
import yargs from 'yargs/yargs';

type Mod = { name: string, userRequest: string, chunkName: string };

async function buildCache(
  parsed: StatsCompilation,
  argv: Record<string, any>
): Promise<{ cache: { [id: string]: { [key: string]: Mod } }, moduleToChunk: { [key: string]: string } }> {
  const cache: { [id: string]: { [key: string]: Mod } } = {};
  const moduleToChunk: { [key: string]: string } = {};

  const limitToChunk = argv.chunk;

  if (limitToChunk) {
    for (const chunk of parsed.chunks ?? []) {
      if (!chunk.files?.[0]) continue;
      if (limitToChunk && chunk.files.find(f => f.includes('.js')) && !chunk.files.find(f => f.includes('.js'))?.match(new RegExp(limitToChunk))) {
        continue;
      }
      console.log(`Searching in chunk: ${chalk.bold(chunk.files[0])}`, chalk.gray(`(regex: ${limitToChunk})`));
    }
  }

  for (const chunk of parsed.chunks ?? []) {
    if (!chunk.files?.[0]) continue;
    if (!chunk.modules) continue;

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
      if (!module.name) continue;
      if (!module.reasons) continue;

      cache[module.name] = module.reasons
        .filter(reason => !argv.skipAsync || reason.type !== "import()")
        .map(reason => {
          return { name: reason.moduleName!, userRequest: reason.userRequest!, chunkName };
        })
        .reduce((acc, { name, ...rest }) => {
          acc[name] = { name, ...rest };
          return acc;
        }, {} as { [key: string]: Mod });
    }
  }
  return { cache, moduleToChunk };
}

function getHighlightFns(
  argv: Record<string, any>,
  moduleToTrace: string,
  cache: { [id: string]: { [key: string]: Mod } }
): { highlightIfNeeded: (name: string) => string, highlightChunkIfNeeded: (name: string) => string } {
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

  return { highlightIfNeeded, highlightChunkIfNeeded };
}

function trimTreeBranch(
  treeBranch: Record<string, any>,
  trimTreeRegex: RegExp | undefined,
  moduleToChunk: { [key: string]: string }
): void {
  for (const [key, value] of Object.entries(treeBranch)) {
    if (typeof value === 'string') {
      if (trimTreeRegex?.test(key)) {
        delete treeBranch[key];
      }
    } else {
      trimTreeBranch(value, trimTreeRegex, moduleToChunk);
      if (Object.keys(treeBranch[key]).length === 0) {
        treeBranch[key] = moduleToChunk[key];
      }
    }
  }
};

yargs(process.argv.slice(2))
  .command(
    'tree <statsFile> <module>',
    'Show dependency tree for a module',
    yargs => yargs
      .positional('statsFile', {
        describe: 'location of the webpack stats json file (generate with "webpack --stats")',
        demandOption: true,
        type: 'string',
      })
      .positional('module', {
        describe: 'substring of module name to show the dependency tree for - this is usually a filename',
        demandOption: true,
        type: 'string',
      })
      .options({
        chunk: { alias: 'c', description: 'limit to a specific chunk or chunks (regex)', type: 'string', demandOption: false },
        depth: { alias: 'd', description: 'how deep to look in the tree', type: 'number', demandOption: true },
        highlight: { alias: 'h', description: 'highlight specific module patterns', type: 'string' },
        highlightChunk: { alias: 'H', description: 'highlight specific chunk patterns', type: 'string' },
        trimTree: { alias: 't', description: 'trim leaves of the tree matching specific pattern', type: 'string' },
        skipModules: { alias: 's', description: 'skip modules from specific chunk', type: 'string' },
        showRequest: { alias: 'i', description: 'show user request for each import', type: 'boolean' },
        skipAsync: { alias: 'a', description: 'Skip async (import()) dependencies', type: 'boolean' },
        failOnSuccess: { alias: 'f', description: 'Throw non-zero code when chains are found', type: 'boolean' },
      }),
    async argv => {
      const parsed: StatsCompilation = JSON.parse(await readFile(argv.statsFile, 'utf-8'));
      const { cache, moduleToChunk } = await buildCache(parsed, argv);

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
      const { highlightIfNeeded, highlightChunkIfNeeded } = getHighlightFns(argv, moduleToTrace, cache);

      const trimTreeRegex = argv.trimTree ? new RegExp(argv.trimTree!) : undefined;
      const skipModulesRegex = argv.skipModules ? new RegExp(argv.skipModules!) : undefined;

      function resolveMods(key: string, depth: number, source: string[] = [key]) {
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

          const modSource = [...source, mod.name];
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

      type TreeBranch = { [id: string]: TreeBranch | string };
      for (let i = 0; i <= argv.depth; ++i) {
        trimTreeBranch(tree, trimTreeRegex, moduleToChunk);
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
  )
  .command(
    'find-chain <statsFile> <from> <to>',
    'Find chains of dependencies between two modules',
    yargs => yargs
      .positional('statsFile', {
        describe: 'location of the webpack stats json file (generate with "webpack --stats")',
        demandOption: true,
        type: 'string',
      })
      .positional('from', {
        describe: 'substring of the module name to start from',
        demandOption: true,
        type: 'string',
      })
      .positional('to', {
        describe: 'substring of the module name to reach',
        demandOption: true,
        type: 'string',
      })
      .options({
        chunk: { alias: 'c', description: 'limit to a specific chunk or chunks (regex)', type: 'string', demandOption: false },
        depth: { alias: 'd', description: 'how deep to look in the chain', type: 'number', demandOption: true },
        skipAsync: { alias: 'a', description: 'Skip async (import()) dependencies', type: 'boolean' },
        failOnSuccess: { alias: 'f', description: 'Throw non-zero code when chains are found', type: 'boolean' },
      }),
    async argv => {
      const parsed: StatsCompilation = JSON.parse(await readFile(argv.statsFile, 'utf-8'));
      const { cache } = await buildCache(parsed, argv);
      let exitCode = argv.failOnSuccess ? 1 : 0;

      // Fuzzy match: find first module that includes given substring
      const from = Object.keys(cache).find(k => k.includes(argv.from));
      const to = Object.keys(cache).find(k => k.includes(argv.to));
      if (!from || !to) {
        console.error('Could not find modules matching:', argv.from, argv.to);
        process.exit(1);
      }
      async function findChains(fromModule: string, toModule: string, maxDepth: number = 20) {
        const results: string[][] = [];
        const stack: [string, string[]][] = [[fromModule, [fromModule]]];
        while (stack.length) {
          const [current, path] = stack.pop()!;
          if (current === toModule) {
            results.push([...path]);
            continue;
          }
          if (path.length > maxDepth) continue;
          const nextMods = cache[current];
          if (!nextMods) continue;
          for (const dep of Object.values(nextMods)) {
            if (path.includes(dep.name)) continue;
            stack.push([dep.name, [...path, dep.name]]);
          }
        }
        return results;
      }
      console.log(chalk.bold(`Finding dependency chains from "${from}" to "${to}"...`));
      const chains = await findChains(from, to, argv.depth || 20);
      if (!chains.length) {
        console.log(chalk.red('No dependency chain found.'));
        exitCode = +(!exitCode);
      } else {
        for (const chain of chains) {
          console.log(chain.map((m, i) =>
            (i === 0 ? chalk.greenBright(m) : i === chain.length - 1 ? chalk.redBright(m) : m)
          ).join(chalk.gray(' -> ')));
        }
      }
      process.exit(exitCode);
    }
  )
  .demandCommand(1)
  .help()
  .argv;