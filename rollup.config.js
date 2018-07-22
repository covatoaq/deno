import path from "path";
import alias from "rollup-plugin-alias";
import { plugin as analyze } from "rollup-plugin-analyzer";
import commonjs from "rollup-plugin-commonjs";
import globals from "rollup-plugin-node-globals";
import nodeResolve from "rollup-plugin-node-resolve";
import typescript from "rollup-plugin-typescript2";
import { createFilter } from "rollup-pluginutils";

const mockPath = path.join(__dirname, "js", "mock_builtin");
const tsconfig = path.join(__dirname, "tsconfig.json");
const typescriptPath = `${
  process.env.BASEPATH
}/third_party/node_modules/typescript/lib/typescript.js`;

// this is a rollup plugin which will look for imports ending with `!string` and resolve
// them with a module that will inline the contents of the file as a string.  Needed to
// support `js/assets.ts`.
function strings({ include, exclude } = {}) {
  if (!include) {
    throw new Error("include option must be passed");
  }

  const filter = createFilter(include, exclude);

  return {
    name: "strings",

    resolveId(importee) {
      if (importee.endsWith("!string")) {
        return path.resolve(
          path.join(
            process.env.BASEPATH,
            importee.slice(0, importee.lastIndexOf("!string"))
          )
        );
      }
    },

    transform(code, id) {
      if (filter(id)) {
        return {
          code: `export default ${JSON.stringify(code)};`,
          map: { mappings: "" }
        };
      }
    }
  };
}

export default function makeConfig(commandOptions) {
  return {
    output: {
      format: "iife",
      name: "denoMain",
      sourcemap: true
    },

    plugins: [
      // would prefer to use `rollup-plugin-virtual` to inject the empty module, but there
      // is an issue with `rollup-plugin-commonjs` which causes errors when using the
      // virtual plugin (see: rollup/rollup-plugin-commonjs#315), this means we have to use
      // a physical module to substitute
      alias({
        fs: mockPath,
        path: mockPath,
        os: mockPath,
        crypto: mockPath,
        buffer: mockPath,
        module: mockPath
      }),

      // Allows rollup to resolve modules based on Node.js resolution
      nodeResolve({
        jsnext: true,
        main: true
      }),

      // Allows rollup to import CommonJS modules
      commonjs({
        namedExports: {
          // Static analysis of `typescript.js` does detect the exports properly, therefore
          // rollup requires them to be explicitly defined to avoid generating warnings
          [typescriptPath]: [
            "createLanguageService",
            "formatDiagnosticsWithColorAndContext",
            "ModuleKind",
            "ScriptSnapshot",
            "ScriptTarget",
            "version"
          ]
        }
      }),

      typescript({
        // The build script is invoked from `out/Target` and so config is located alongside this file
        tsconfig,

        // By default, the include path only includes the cwd and below, need to include the root of the project
        // to be passed to this plugin.  This is different front tsconfig.json include
        include: ["*.ts", `${__dirname}/**/*.ts`],

        // d.ts files are not bundled and by default like include, it only includes the cwd and below
        exclude: ["*.d.ts", `${__dirname}/**/*.d.ts`]
      }),

      // Provides inlining of file contents for `js/assets.ts`
      strings({
        include: ["*.d.ts", `${__dirname}/**/*.d.ts`]
      }),

      // Provide some concise information about the bundle
      analyze({
        skipFormatted: true,
        onAnalysis({
          bundleSize,
          bundleOrigSize,
          bundleReduction,
          moduleCount
        }) {
          if (!commandOptions.silent) {
            console.log(
              `Bundle size: ${Math.round((bundleSize / 1000000) * 100) / 100}Mb`
            );
            console.log(
              `Original size: ${Math.round((bundleOrigSize / 1000000) * 100) /
                100}Mb`
            );
            console.log(`Reduction: ${bundleReduction}%`);
            console.log(`Module count: ${moduleCount}`);
          }
        }
      }),

      // source-map-support, which is required by TypeScript to support source maps, requires Node.js Buffer
      // implementation.  This needs to come at the end of the plugins because of the impact it has on
      // the existing runtime environment, which breaks other plugins and features of the bundler.
      globals()
    ]
  };
}
