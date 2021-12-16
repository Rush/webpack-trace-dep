import { readFile } from 'fs/promises';
import { isEqual,  set,  uniqWith } from 'lodash';
import { StatsCompilation } from 'webpack';
import chalk from 'chalk';
import { asTree } from 'treeify';
import yargs from 'yargs/yargs';
import { isConstructSignatureDeclaration } from 'typescript';

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
}).argv;


type Mod = { name: string, userRequest: string };

async function main() {
  const argv = await argvPromise;
  const parsed: StatsCompilation = JSON.parse(await readFile(argv.statsFile, 'utf-8'));
  const cache: { [id: string]: Mod[] } = {};

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
      console.log(`Searching in chunk: ${chalk.bold(chunk.files[0])}`);
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

    for (const module of chunk.modules) {
      if (module.name) {
        moduleToChunk[module.name] = chunk.files.find(f => f.includes('.js')) || chunk.id?.toString()!;
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

      cache[module.name] = uniqWith(
        module.reasons.map(reason => ({ name: reason.moduleName!, userRequest: reason.userRequest! }))
      , isEqual);
    }
  }
  const key = Object.keys(cache).find(key => key.includes(argv.module));
  if (!cache[key!]) {
    console.log(`Cannot find any module matching substring '${key}' (out of ${Object.keys(cache).length} available)`)
    process.exit(1);
  }

  console.log('Searching for module', chalk.bold(key));

  if (!key) {
    return;
  }

  const tree: any = {};
  const highlightRegex = argv.highlight ? new RegExp(argv.highlight!) : undefined;
  const highlightIfNeeded = (name: string) => {
    if (highlightRegex?.test(name)) {
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

  function resolveMods(key: string, depth: number, source: string[] = [ chalk.bold(key) ]) {
    depth--;
    if (depth < 0) {
      return;
    }

    const mods = cache[key];
    if (!mods) {
      return;
    }

    for (const mod of mods) {
      if (!cache[mod.name]) {
        continue;
      }
      if (source.includes(mod.name)) {
        continue;
      }
      if (skipModulesRegex && skipModulesRegex.test(moduleToChunk[mod.name])) {
        continue;
      }


      const modSource = [ ...source, highlightIfNeeded(mod.name) ];
      set(tree, modSource, `${highlightChunkIfNeeded(moduleToChunk[mod.name])}`);

      cache[mod.name]
        .forEach(({ name }) => {
          if (source.includes(name)) {
            return;
          }

          resolveMods(name, depth, [...modSource, highlightIfNeeded(name)]);
        });
    }
    return;
  }
  resolveMods(key, argv.depth);

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
          treeBranch[key] = highlightChunkIfNeeded(moduleToChunk[key]);
        }
      }
    };
  };

  if (trimTreeRegex) {
    for (let i = 0; i < argv.depth;++i) {
      console.log('Trim tree');
      trimTreeBranch(tree);
    }
  }

  console.log(asTree(tree, true, true));
}

main();
