import { createRequire } from "node:module";
import { posix } from "node:path";

const COMPILER_CONFIG_ROOT = "/repository";

// node_modules is recorded by its separate complete dependency inventory. Its
// generated Vite cache, unlike locked dependency code, is output-only.
export const OUTPUT_ONLY_ROOTS = Object.freeze([
  ".agent",
  "dist",
  "test-results",
  "playwright-report",
  ".vite",
  "node_modules/.vite",
]);
const inside = (path, root) => path === root || path.startsWith(root + "/");
export const isOutputOnlyPath = (path) =>
  OUTPUT_ONLY_ROOTS.some((root) => inside(path, root));
export const isSourceSnapshotExcludedPath = (path) =>
  inside(path, "node_modules") || isOutputOnlyPath(path);
export const isDependencyOutputPath = (path) => inside(path, ".vite");
const require = createRequire(import.meta.url);
const reject = (path, detail) => {
  const error = new Error(
    "Excluded output/build reference in " + path + ": " + detail,
  );
  error.code = "OUTPUT_EXCLUSION_BYPASS";
  throw error;
};

const checkReference = (file, raw) => {
  if (typeof raw !== "string") return;
  // Vite expands this one built-in base-path token before parsing HTML URLs.
  // Other percent tokens remain unsupported, and the resolved suffix is checked.
  let reference = raw.trim().replace(/^%BASE_URL%/, "/");
  if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(reference)) {
    if (/^file:/i.test(reference))
      reject(file, "file URLs are not repository inputs");
    return;
  }
  reference = reference.split(/[?#]/, 1)[0];
  try {
    reference = decodeURIComponent(reference);
  } catch {
    reject(file, "unsupported encoded local reference");
  }
  if (/[\\&]/.test(reference))
    reject(file, "unsupported escaped local reference");
  const absolute = reference.startsWith("/");
  const resolved = posix.normalize(
    absolute ? reference.slice(1) : posix.join(posix.dirname(file), reference),
  );
  if (
    isOutputOnlyPath(resolved) ||
    isOutputOnlyPath(reference.replace(/^\.\//, ""))
  )
    reject(file, "output-only location cannot supply source inputs");
};

const reservedCommandPath = (text) =>
  OUTPUT_ONLY_ROOTS.some((root) => {
    const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      "(?:^|[\\s/\\\\='\"`(])" + escaped + "(?:[/\\\\]|$)",
    ).test(text);
  });

const compilerConfigPath = (file) =>
  posix.resolve(COMPILER_CONFIG_ROOT, file.replaceAll("\\", "/"));

const repositoryPath = (file) => {
  const relative = posix.relative(COMPILER_CONFIG_ROOT, file);
  if (relative === "" || (!relative.startsWith("../") && relative !== ".."))
    return relative;
  return undefined;
};

const rejectCompilerConfig = (file, detail) =>
  reject(file, "unsupported compiler configuration: " + detail);

const assertResolvedCompilerPath = (file, path) => {
  if (typeof path !== "string")
    rejectCompilerConfig(file, "path setting must be a string");
  const resolved = repositoryPath(path);
  if (resolved === undefined)
    rejectCompilerConfig(file, "path setting escapes the repository");
  if (isOutputOnlyPath(resolved))
    reject(file, "output-only location cannot supply source inputs");
};

const assertCompilerPathPattern = (file, pathsBase, path) => {
  if (typeof path !== "string")
    rejectCompilerConfig(file, "paths mappings must contain strings");
  const wildcard = path.indexOf("*");
  if (wildcard === -1) {
    assertResolvedCompilerPath(file, posix.resolve(pathsBase, path));
    return;
  }
  const prefix = posix.normalize(path.slice(0, wildcard));
  const resolvedPrefix = repositoryPath(posix.resolve(pathsBase, prefix));
  if (
    resolvedPrefix === undefined ||
    resolvedPrefix === "" ||
    isOutputOnlyPath(resolvedPrefix)
  )
    reject(file, "output-only location cannot supply source inputs");
};

const matchPathPattern = (pattern, specifier) => {
  const wildcard = pattern.indexOf("*");
  if (wildcard === -1) return specifier === pattern ? "" : undefined;
  const prefix = pattern.slice(0, wildcard);
  const suffix = pattern.slice(wildcard + 1);
  if (
    !specifier.startsWith(prefix) ||
    !specifier.endsWith(suffix) ||
    specifier.length < prefix.length + suffix.length
  )
    return undefined;
  return specifier.slice(prefix.length, specifier.length - suffix.length);
};

const sourceReferenceContext = (compiler, file, content) => {
  const source = compiler.createSourceFile(
    file,
    content,
    compiler.ScriptTarget.Latest,
    true,
  );
  const bindings = new Map();
  for (const statement of source.statements)
    if (
      compiler.isVariableStatement(statement) &&
      statement.declarationList.flags & compiler.NodeFlags.Const
    )
      for (const declaration of statement.declarationList.declarations)
        if (compiler.isIdentifier(declaration.name))
          bindings.set(declaration.name.text, declaration.initializer);
  const value = (node, seen = new Set()) => {
    if (!node) return undefined;
    if (compiler.isStringLiteralLike(node)) return node.text;
    if (compiler.isLiteralTypeNode(node)) return value(node.literal, seen);
    if (compiler.isParenthesizedExpression(node))
      return value(node.expression, seen);
    if (
      compiler.isBinaryExpression(node) &&
      node.operatorToken.kind === compiler.SyntaxKind.PlusToken
    ) {
      const left = value(node.left, seen),
        right = value(node.right, seen);
      return left !== undefined && right !== undefined
        ? left + right
        : undefined;
    }
    if (
      compiler.isIdentifier(node) &&
      !seen.has(node.text) &&
      bindings.has(node.text)
    ) {
      const next = new Set(seen);
      next.add(node.text);
      return value(bindings.get(node.text), next);
    }
    return undefined;
  };
  const inBrowserEvaluation = (node) => {
    if (!file.startsWith("src/tests/browser/")) return false;
    for (let current = node.parent; current; current = current.parent)
      if (
        compiler.isCallExpression(current) &&
        compiler.isPropertyAccessExpression(current.expression) &&
        current.expression.expression.getText(source) === "page" &&
        current.expression.name.text === "evaluate"
      )
        return true;
    return false;
  };
  const moduleSpecifiers = ({ failUnsupportedDynamic = false } = {}) => {
    const specifiers = [];
    const add = (node) => {
      const reference = value(node);
      if (reference !== undefined) specifiers.push(reference);
      return reference;
    };
    const visit = (node) => {
      if (
        (compiler.isImportDeclaration(node) ||
          compiler.isExportDeclaration(node)) &&
        node.moduleSpecifier
      )
        add(node.moduleSpecifier);
      if (
        compiler.isImportEqualsDeclaration(node) &&
        compiler.isExternalModuleReference(node.moduleReference)
      )
        add(node.moduleReference.expression);
      if (compiler.isImportTypeNode?.(node)) {
        const reference = add(node.argument);
        if (reference === undefined && failUnsupportedDynamic)
          reject(
            file,
            "dynamic host module reference requires explicit review",
          );
      }
      if (
        compiler.isCallExpression(node) &&
        (node.expression.kind === compiler.SyntaxKind.ImportKeyword ||
          (compiler.isIdentifier(node.expression) &&
            node.expression.text === "require") ||
          node.expression.getText(source) === "import.meta.resolve")
      ) {
        const reference = add(node.arguments[0]);
        if (
          reference === undefined &&
          failUnsupportedDynamic &&
          !inBrowserEvaluation(node)
        )
          reject(
            file,
            "dynamic host module reference requires explicit review",
          );
      }
      compiler.forEachChild(node, visit);
    };
    visit(source);
    return specifiers;
  };
  return { source, value, moduleSpecifiers };
};

const assertResolvedCompilerImports = (file, compiler, parsed, context) => {
  if (!Array.isArray(context?.sourceFiles)) return;
  const options = parsed.options;
  const paths = options.paths ?? {};
  const patterns = Object.entries(paths);
  if (!patterns.length) return;
  const pathsBase =
    options.baseUrl ??
    options.pathsBasePath ??
    posix.dirname(compilerConfigPath(file));
  for (const sourceFile of context.sourceFiles) {
    if (typeof sourceFile !== "string" || !/\.[cm]?[jt]sx?$/.test(sourceFile))
      continue;
    const content = context.readSource?.(sourceFile);
    if (typeof content !== "string")
      rejectCompilerConfig(file, "source import reader unavailable");
    for (const specifier of sourceReferenceContext(
      compiler,
      sourceFile,
      content,
    ).moduleSpecifiers({ failUnsupportedDynamic: true })) {
      if (
        compiler.isExternalModuleNameRelative(specifier) ||
        specifier.startsWith("/")
      )
        continue;
      for (const [pattern, references] of patterns) {
        const capture = matchPathPattern(pattern, specifier);
        if (capture === undefined) continue;
        for (const reference of references) {
          if (typeof reference !== "string")
            rejectCompilerConfig(file, "paths mappings must contain strings");
          const substituted = reference.includes("*")
            ? reference.replaceAll("*", capture)
            : reference;
          assertResolvedCompilerPath(
            file,
            posix.resolve(pathsBase, substituted),
          );
        }
      }
    }
  }
};

const compilerDiagnostics = (compiler, diagnostics) =>
  diagnostics
    .filter((diagnostic) => diagnostic.code !== 18003)
    .map((diagnostic) =>
      compiler.flattenDiagnosticMessageText(diagnostic.messageText, " "),
    );

const compilerReferences = (config) => {
  const options = config.compilerOptions ?? {};
  return [
    ...[config.extends ?? []].flat(),
    ...(config.files ?? []),
    ...(config.include ?? []),
    ...(config.references ?? []).map((entry) => entry?.path),
    options.baseUrl,
    options.rootDir,
    ...(options.rootDirs ?? []),
    ...(options.typeRoots ?? []),
  ];
};

const assertCompilerReferences = (file, content, context) => {
  let compiler;
  try {
    compiler = require("typescript");
  } catch {
    reject(
      file,
      "input parser unavailable; install locked dependencies with npm ci",
    );
  }
  const sources = new Map();
  const source = (path, text) => {
    const parsed = compiler.parseConfigFileTextToJson(path, text);
    if (parsed.error) rejectCompilerConfig(file, "malformed configuration");
    sources.set(path, parsed.config ?? {});
    return text;
  };
  const configPath = compilerConfigPath(file);
  source(configPath, content);
  const readConfig = (path) => {
    const relative = repositoryPath(path);
    if (
      relative === undefined ||
      relative === "" ||
      relative === file ||
      relative.startsWith("node_modules/")
    )
      return undefined;
    if (typeof context?.readConfig !== "function") return undefined;
    const text = context.readConfig(relative);
    return typeof text === "string" ? source(path, text) : undefined;
  };
  const host = {
    useCaseSensitiveFileNames: true,
    readDirectory: () => [],
    fileExists: (path) => sources.has(path) || readConfig(path) !== undefined,
    readFile: (path) =>
      sources.has(path)
        ? context?.readConfig && path !== configPath
          ? readConfig(path)
          : content
        : readConfig(path),
    directoryExists: (path) =>
      [...sources.keys()].some((sourcePath) =>
        sourcePath.startsWith(posix.normalize(path) + "/"),
      ),
    getCurrentDirectory: () => COMPILER_CONFIG_ROOT,
    onUnRecoverableConfigFileDiagnostic: () => {},
  };
  const parsed = compiler.parseJsonConfigFileContent(
    sources.get(configPath),
    host,
    posix.dirname(configPath),
    undefined,
    configPath,
  );
  const diagnostics = compilerDiagnostics(compiler, parsed.errors);
  if (diagnostics.length) rejectCompilerConfig(file, diagnostics.join("; "));
  for (const [path, config] of sources)
    for (const reference of compilerReferences(config))
      checkReference(repositoryPath(path) ?? file, reference);
  const options = parsed.options;
  for (const reference of [
    options.baseUrl,
    options.rootDir,
    ...(options.rootDirs ?? []),
    ...(options.typeRoots ?? []),
  ])
    if (reference !== undefined) assertResolvedCompilerPath(file, reference);
  const pathsBase =
    options.baseUrl ?? options.pathsBasePath ?? posix.dirname(configPath);
  for (const references of Object.values(options.paths ?? {})) {
    if (!Array.isArray(references))
      rejectCompilerConfig(file, "paths mappings must contain arrays");
    for (const reference of references)
      assertCompilerPathPattern(file, pathsBase, reference);
  }
  assertResolvedCompilerImports(file, compiler, parsed, context);
};

export const assertInputReferences = (file, content, context) => {
  if (file === "package.json") {
    const scripts = JSON.parse(content).scripts ?? {};
    if (
      Object.values(scripts).some(
        (value) => typeof value !== "string" || reservedCommandPath(value),
      )
    )
      reject(file, "package command references output-only locations");
    return;
  }
  if (/(?:^|\/)tsconfig[^/]*\.json$/.test(file)) {
    assertCompilerReferences(file, content, context);
    return;
  }
  if (/\.[cm]?[jt]sx?$/.test(file)) {
    let ts;
    try {
      ts = require("typescript");
    } catch {
      reject(
        file,
        "input parser unavailable; install locked dependencies with npm ci",
      );
    }
    const references = sourceReferenceContext(ts, file, content);
    const { source, value } = references;
    for (const reference of references.moduleSpecifiers({
      failUnsupportedDynamic: true,
    }))
      checkReference(file, reference);
    const visit = (node) => {
      if (ts.isNewExpression(node) && node.expression.getText(source) === "URL")
        checkReference(file, value(node.arguments?.[0]));
      if (
        /^(?:vite|vitest|playwright)\.config\./.test(file) &&
        ts.isStringLiteralLike(node) &&
        /[/\\]/.test(node.text)
      ) {
        const outputSetting =
          ts.isPropertyAssignment(node.parent) &&
          ["outDir", "cacheDir", "outputDir"].includes(
            node.parent.name.getText(source).replace(/["']/g, ""),
          );
        if (!outputSetting) checkReference(file, node.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return;
  }
  if (/\.html?$/.test(file)) {
    for (const match of content.matchAll(
      /<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/gi,
    ))
      assertInputReferences(file + ".mjs", match[1]);
    for (const match of content.matchAll(
      /\b(?:src|href|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    ))
      checkReference(file, match[1] ?? match[2] ?? match[3]);
    for (const match of content.matchAll(
      /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
    ))
      for (const item of (match[1] ?? match[2]).split(","))
        checkReference(file, item.trim().split(/\s+/, 1)[0]);
  }
  if (/\.(?:css|html?)$/.test(file)) {
    for (const match of content.matchAll(
      /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi,
    ))
      checkReference(file, match[1] ?? match[2] ?? match[3]);
    for (const match of content.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi))
      checkReference(file, match[1] ?? match[2]);
  }
};
