
# webpack-trace-dep

**Webpack Dependency Explorer CLI**  
Trace and visualize module dependencies in your Webpack project—find full dependency trees or show chains from any file A to file B. Supports filtering by chunks, highlights, depth, and can skip async (`import()`) dependencies.


## Features

- **Show dependency trees** for any file/module in your bundle.
- **Find chains of dependencies**: “How can module X possibly require module Y?”
- **Chunk filtering**: Restrict to specific chunks via regex.
- **Depth limiting**: Limit tree/chain depth for clarity.
- **Highlights**: Colorize specific modules and chunks.
- **Skip async**: Optionally ignore async (`import()`) edges.
- **Flexible substring matching** for fuzzy module lookups.


## Installation

```sh
git clone https://github.com/YOUR_USERNAME/webpack-trace-dep.git
cd webpack-trace-dep
npm install
npm run build
```

Or run directly with `ts-node`:

```sh
npm install
npx ts-node src/index.ts ...
```


## Usage

### Generate Webpack Stats

First, generate your stats file:

```sh
webpack --config webpack.config.js --stats > stats.json
```

### Show Dependency Tree

```sh
node dist/index.js tree <statsFile> <module> [options]
```

**Example:**

```sh
node dist/index.js tree build/stats.app.json src/main.ts -d 5
```

### Find Dependency Chains (from A to B)

```sh
node dist/index.js find-chain <statsFile> <from> <to> [options]
```

**Example:**

```sh
node dist/index.js find-chain build/stats.app.json src/foo.ts src/bar.ts -d 10
```

## CLI Options

| Option             | Alias | Description                                                | Example                        |
|--------------------|-------|------------------------------------------------------------|--------------------------------|
| `--chunk`          | `-c`  | Regex: limit to specific chunk(s)                          | `-c "main"`                    |
| `--depth`          | `-d`  | Max depth for tree/chain                                   | `-d 6`                         |
| `--highlight`      | `-h`  | Regex: highlight module(s) in tree                         | `-h "utils"`                   |
| `--highlightChunk` | `-H`  | Regex: highlight chunk(s) in tree                          | `-H "vendor"`                  |
| `--trimTree`       | `-t`  | Regex: trim leaves matching pattern                        | `-t "polyfill"`                |
| `--skipModules`    | `-s`  | Regex: skip modules from chunks matching this pattern      | `-s "legacy"`                  |
| `--showRequest`    | `-i`  | Show user request for each import (tree only)              | `-i`                           |
| `--skipAsync`      | `-a`  | Skip async (`import()`) dependencies                       | `-a`                           |
| `--help`           |       | Show help                                                  |                                |


## Examples

### Show Tree for a File, Highlight "utils", Depth 4

```sh
node dist/index.js tree stats.json src/components/App.tsx -d 4 -h "utils"
```

### Find All Chains from `a.js` to `b.js` (skipping async imports, up to depth 12)

```sh
node dist/index.js find-chain stats.json src/a.js src/b.js -d 12 -a
```

### Restrict Analysis to "main" Chunk Only

```sh
node dist/index.js tree stats.json src/index.js -d 5 -c "main"
```


## Development

- Written in TypeScript, using yargs for CLI.
- Edit `src/index.ts`, then run `npm run build` to produce the CLI.
- Works on any Webpack JSON stats file (`webpack --stats`).

### Run with `ts-node` (for development):

```sh
npx ts-node src/index.ts tree stats.json src/main.ts -d 5
```


## Contributing

Issues and PRs are welcome!  
Please file a bug if you find a case where dependencies or chains are not found as expected.


## License

MIT


## Credits

Created by Damian Kaczmarek, inspired by real-world pain exploring deep Webpack dependency graphs.
