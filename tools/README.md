# Build Automation Tools

### `yarn start` (`start.js`)

* Cleans up the output `/build` directory (`clean.js`)
* Copies static files to the output folder (`copy.js`)
* Launches [Webpack](https://webpack.github.io/) compiler in a watch mode (via
  [webpack-middleware](https://github.com/kriasoft/webpack-middleware))
* Serves the app and the in-memory bundles with Express, on
  `http://localhost:3000` unless `PORT` says otherwise
* Applies [Hot Module Replacement](https://webpack.github.io/docs/hot-module-replacement)
  through `webpack-hot-middleware`, which reloads the page for the updates
  that can't be hot-applied

### `yarn run build` (`build.js`)

* Cleans up the output `/build` folder (`clean.js`)
* Copies static files to the output folder (`copy.js`)
* Creates application bundles with Webpack (`bundle.js`, `webpack.config.js`)

## Options

| Flag        | Description                                                                         |
| ----------- | ----------------------------------------------------------------------------------- |
| `--release` | Minimizes and optimizes the compiled output                                         |
| `--verbose` | Prints detailed information to the console                                          |
| `--analyze` | Launches [Webpack Bundle Analyzer](https://github.com/th0r/webpack-bundle-analyzer) |
| `--silent`  | Do not open the default browser (what CI and the smoke tests pass)                   |

For example:

```sh
$ yarn run build --release --verbose      # Build the app in production mode
```

or

```sh
$ yarn start --release                    # Launch dev server in production mode
```

## Misc

* `webpack.config.js` - Webpack configuration for both client-side and
  server-side bundles
* `postcss.config.js` - PostCSS configuration for transforming styles with JS
  plugins
* `run.js` - Helps to launch other scripts with `babel-node` (e.g. `babel-node
  tools/run build`)
* `.eslintrc` - ESLint overrides for built automation scripts
