import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

export const ARCHITECTURE_RULES = Object.freeze({
  GAME_SESSION_CONSTRUCTION: "ARCH001",
  GAME_SESSION_VALUE_IMPORT: "ARCH002",
  PURE_LAYER_IMPORT: "ARCH003",
  CONCRETE_INPUT_ADAPTER_IMPORT: "ARCH004",
  PURE_LAYER_BROWSER_API: "ARCH005",
  MUTABLE_MODULE_STATE: "ARCH006",
  MODULE_SINGLETON: "ARCH007",
  MUTABLE_STATIC_FIELD: "ARCH008",
  IMPORT_CYCLE: "ARCH009",
  AUTOMATIC_REGISTRATION: "ARCH010",
  SERVICE_LOCATOR: "ARCH011",
  DIRECT_STORAGE: "ARCH012",
  DIRECT_DOM: "ARCH013",
  BOOTSTRAP_COMPOSITION: "ARCH014",
});

const guardDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(guardDirectory, "../..");
const browserRuntimeIdentifiers = new Set([
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "navigator",
  "performance",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "fetch",
  "WebSocket",
  "Worker",
  "THREE",
  "Capacitor",
]);
const storageIdentifiers = new Set([
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "caches",
]);
const automaticRegistrationNames = new Set([
  "register",
  "registerall",
  "registeradapter",
  "registerfeature",
  "registerservice",
  "autoregister",
  "discoverfeatures",
  "discoverservices",
  "autodiscover",
]);
const serviceLocatorIdentifiers = new Set([
  "Services",
  "ServiceLocator",
  "serviceLocator",
  "getService",
  "resolveService",
]);

const asPosixPath = (path) => path.split(sep).join("/");
const canonicalPath = (path) => asPosixPath(resolve(path));
const relativePath = (root, path) => asPosixPath(relative(root, path)) || ".";

const productionSourceFiles = (sourceRoot) => {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (path === join(sourceRoot, "tests")) continue;
        visit(path);
      } else if (
        entry.isFile() &&
        path.endsWith(".ts") &&
        !path.endsWith(".d.ts")
      ) {
        files.push(path);
      }
    }
  };
  visit(sourceRoot);
  return files.sort();
};

const compilerOptionsFor = (tsconfigPath) => {
  const parsed = ts.getParsedCommandLineOfConfigFile(tsconfigPath, {}, ts.sys);
  if (parsed === undefined)
    throw new Error(
      `could not parse TypeScript configuration: ${tsconfigPath}`,
    );
  return parsed.options;
};

const hasModifier = (node, modifier) =>
  ts.getModifiers(node)?.some((candidate) => candidate.kind === modifier) ??
  false;

const isPropertyName = (node) => {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node)
  );
};

const unwrapExpression = (expression) => {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  )
    current = current.expression;
  return current;
};

const callName = (expression) => {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
};

const isFrozenInitializer = (initializer) => {
  if (initializer === undefined) return false;
  const expression = unwrapExpression(initializer);
  if (!ts.isCallExpression(expression)) return false;
  if (
    ts.isPropertyAccessExpression(expression.expression) &&
    ts.isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text === "Object" &&
    expression.expression.name.text === "freeze"
  )
    return true;
  return (
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "deepFreeze"
  );
};

const isLikelySingletonInitializer = (initializer) => {
  if (initializer === undefined) return false;
  const expression = unwrapExpression(initializer);
  if (ts.isNewExpression(expression)) return true;
  if (!ts.isCallExpression(expression)) return false;
  if (
    ts.isPropertyAccessExpression(expression.expression) &&
    ts.isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text === "Object" &&
    expression.expression.name.text === "freeze"
  )
    return isLikelySingletonInitializer(expression.arguments[0]);
  const name = callName(expression.expression)?.toLowerCase();
  return (
    name === "createglobalstore" ||
    name === "createservicelocator" ||
    name === "createcontainer" ||
    name === "createregistry"
  );
};

const hasConstAssertion = (expression) => {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    if (
      ts.isAsExpression(current) &&
      ts.isTypeReferenceNode(current.type) &&
      current.type.typeName.getText() === "const"
    )
      return true;
    current = current.expression;
  }
  return false;
};

const isMutableExportedLiteral = (declaration) => {
  if (declaration.initializer === undefined) return false;
  if (isFrozenInitializer(declaration.initializer)) return false;
  if (hasConstAssertion(declaration.initializer)) return false;
  if (declaration.name.kind !== ts.SyntaxKind.Identifier) return false;
  const initializer = unwrapExpression(declaration.initializer);
  return (
    ts.isArrayLiteralExpression(initializer) ||
    ts.isObjectLiteralExpression(initializer)
  );
};

const layerFor = (sourceRoot, fileName) =>
  relativePath(sourceRoot, fileName).split("/")[0] ?? "";

const isApprovedGameSessionOwner = (sourceRoot, fileName) =>
  relativePath(sourceRoot, fileName) === "app/createGameApplication.ts";

const isConcreteInputAdapter = (sourceRoot, fileName) => {
  const path = relativePath(sourceRoot, fileName);
  return (
    path.startsWith("platform/input/") &&
    path.split("/").length === 3 &&
    basename(path).endsWith("Input.ts") &&
    basename(path) !== "inputContracts.ts"
  );
};

const isSharedPlatformModule = (sourceRoot, fileName) =>
  /(?:contracts?|types?|helpers?|utils?|policy)\.ts$/i.test(
    basename(relativePath(sourceRoot, fileName)),
  );

const isConcretePlatformAdapter = (sourceRoot, fileName) =>
  relativePath(sourceRoot, fileName).startsWith("platform/") &&
  !isSharedPlatformModule(sourceRoot, fileName);

const isApprovedStorageAdapter = (sourceRoot, fileName) =>
  relativePath(sourceRoot, fileName).startsWith("platform/storage/");

const isApprovedDomAdapter = (sourceRoot, fileName) => {
  const path = relativePath(sourceRoot, fileName);
  return (
    path === "main.ts" || path.startsWith("platform/") || path.startsWith("ui/")
  );
};

const importHasRuntimeBinding = (declaration) => {
  const clause = declaration.importClause;
  if (clause === undefined) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name !== undefined) return true;
  if (clause.namedBindings === undefined) return true;
  if (ts.isNamespaceImport(clause.namedBindings)) return true;
  return clause.namedBindings.elements.some((element) => !element.isTypeOnly);
};

const sourceLocation = (projectRoot, sourceFile, node) => {
  const position = node?.getStart(sourceFile) ?? 0;
  const lineAndCharacter = sourceFile.getLineAndCharacterOfPosition(position);
  return `${relativePath(projectRoot, sourceFile.fileName)}:${lineAndCharacter.line + 1}:${lineAndCharacter.character + 1}`;
};

const formatFailure = (failure) =>
  `${failure.location} [${failure.ruleId}] ${failure.message}`;

/**
 * Performs compiler-API architecture analysis over production TypeScript. Tests
 * may pass an isolated project root and tsconfig path to exercise violations.
 */
export const inspectArchitecture = ({
  projectRoot = repositoryRoot,
  sourceRoot = join(projectRoot, "src"),
  tsconfigPath = join(projectRoot, "tsconfig.json"),
} = {}) => {
  const canonicalProjectRoot = canonicalPath(projectRoot);
  const canonicalSourceRoot = canonicalPath(sourceRoot);
  if (!existsSync(canonicalSourceRoot))
    throw new Error(
      `production source root does not exist: ${canonicalSourceRoot}`,
    );
  if (!existsSync(tsconfigPath))
    throw new Error(`TypeScript configuration does not exist: ${tsconfigPath}`);

  const sourceFiles = productionSourceFiles(canonicalSourceRoot);
  const compilerOptions = compilerOptionsFor(tsconfigPath);
  const program = ts.createProgram({
    rootNames: sourceFiles,
    options: compilerOptions,
  });
  const checker = program.getTypeChecker();
  const productionFiles = new Set(sourceFiles.map(canonicalPath));
  const sourceFilesByPath = new Map(
    program
      .getSourceFiles()
      .filter((sourceFile) =>
        productionFiles.has(canonicalPath(sourceFile.fileName)),
      )
      .map((sourceFile) => [canonicalPath(sourceFile.fileName), sourceFile]),
  );
  const gameSessionPath = canonicalPath(
    join(canonicalSourceRoot, "domain/GameSession.ts"),
  );
  const failures = [];
  const failureKeys = new Set();
  const importsBySource = new Map(
    [...sourceFilesByPath.keys()].map((sourceFile) => [sourceFile, []]),
  );

  const addFailure = (ruleId, sourceFile, node, message) => {
    const location = sourceLocation(canonicalProjectRoot, sourceFile, node);
    const key = `${ruleId}|${location}|${message}`;
    if (failureKeys.has(key)) return;
    failureKeys.add(key);
    failures.push({ ruleId, location, message });
  };

  const resolveModule = (sourceFile, moduleSpecifier) => {
    const resolved = ts.resolveModuleName(
      moduleSpecifier.text,
      sourceFile.fileName,
      compilerOptions,
      ts.sys,
    ).resolvedModule;
    return resolved === undefined
      ? undefined
      : canonicalPath(resolved.resolvedFileName);
  };

  const symbolIsGameSession = (symbol) => {
    if (symbol === undefined) return false;
    const target =
      symbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(symbol)
        : symbol;
    return target.declarations?.some(
      (declaration) =>
        canonicalPath(declaration.getSourceFile().fileName) ===
          gameSessionPath &&
        ts.isClassDeclaration(declaration) &&
        declaration.name?.text === "GameSession",
    );
  };

  const isBrowserGlobalReference = (node) => {
    const symbol = checker.getSymbolAtLocation(node);
    if (symbol === undefined) return true;
    const target =
      symbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(symbol)
        : symbol;
    if (target.declarations === undefined || target.declarations.length === 0)
      return true;
    return target.declarations.every(
      (declaration) =>
        !productionFiles.has(
          canonicalPath(declaration.getSourceFile().fileName),
        ),
    );
  };

  const addImportEdge = (sourceFile, target, node) => {
    if (!productionFiles.has(target)) return;
    importsBySource
      .get(canonicalPath(sourceFile.fileName))
      ?.push({ target, node });
  };

  const inspectImport = (sourceFile, declaration, moduleSpecifier) => {
    const target = resolveModule(sourceFile, moduleSpecifier);
    const sourceLayer = layerFor(canonicalSourceRoot, sourceFile.fileName);
    if (target !== undefined) {
      addImportEdge(sourceFile, target, moduleSpecifier);
      const targetLayer = layerFor(canonicalSourceRoot, target);
      if (
        (sourceLayer === "domain" || sourceLayer === "data") &&
        ["app", "platform", "ui"].includes(targetLayer)
      )
        addFailure(
          ARCHITECTURE_RULES.PURE_LAYER_IMPORT,
          sourceFile,
          moduleSpecifier,
          `${sourceLayer} must not import ${targetLayer}`,
        );
      if (
        isConcretePlatformAdapter(canonicalSourceRoot, sourceFile.fileName) &&
        target !== canonicalPath(sourceFile.fileName) &&
        isConcretePlatformAdapter(canonicalSourceRoot, target)
      )
        addFailure(
          ARCHITECTURE_RULES.CONCRETE_INPUT_ADAPTER_IMPORT,
          sourceFile,
          moduleSpecifier,
          "platform adapters must share narrow contract/helper modules, never concrete sibling adapters",
        );
      if (
        target === gameSessionPath &&
        ts.isImportDeclaration(declaration) &&
        (isConcreteInputAdapter(canonicalSourceRoot, sourceFile.fileName) ||
          (importHasRuntimeBinding(declaration) &&
            !isApprovedGameSessionOwner(
              canonicalSourceRoot,
              sourceFile.fileName,
            )))
      )
        addFailure(
          ARCHITECTURE_RULES.GAME_SESSION_VALUE_IMPORT,
          sourceFile,
          moduleSpecifier,
          "input adapters must not import GameSession; other value imports belong only in app/createGameApplication.ts",
        );
    }
    if (
      (sourceLayer === "domain" || sourceLayer === "data") &&
      (moduleSpecifier.text === "three" ||
        moduleSpecifier.text.startsWith("@capacitor/"))
    )
      addFailure(
        ARCHITECTURE_RULES.PURE_LAYER_BROWSER_API,
        sourceFile,
        moduleSpecifier,
        "domain and authored data must not import browser frameworks",
      );
  };

  const inspectStaticFields = (sourceFile, declaration) => {
    for (const member of declaration.members) {
      if (!ts.isPropertyDeclaration(member)) continue;
      if (!hasModifier(member, ts.SyntaxKind.StaticKeyword)) continue;
      if (!hasModifier(member, ts.SyntaxKind.ReadonlyKeyword))
        addFailure(
          ARCHITECTURE_RULES.MUTABLE_STATIC_FIELD,
          sourceFile,
          member.name,
          "mutable static fields create process-wide runtime authority",
        );
      if (isLikelySingletonInitializer(member.initializer))
        addFailure(
          ARCHITECTURE_RULES.MODULE_SINGLETON,
          sourceFile,
          member.name,
          "static singleton instances are forbidden",
        );
    }
  };

  const inspectTopLevelState = (sourceFile, statement) => {
    if (ts.isVariableStatement(statement)) {
      const mutableBinding =
        (statement.declarationList.flags & ts.NodeFlags.Const) === 0;
      const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
      for (const declaration of statement.declarationList.declarations) {
        if (
          mutableBinding ||
          (exported && isMutableExportedLiteral(declaration))
        )
          addFailure(
            ARCHITECTURE_RULES.MUTABLE_MODULE_STATE,
            sourceFile,
            declaration.name,
            mutableBinding
              ? "module-level mutable state must be owned by an explicit instance"
              : `exported mutable literal ${declaration.name.getText(sourceFile)} must be frozen`,
          );
        if (isLikelySingletonInitializer(declaration.initializer))
          addFailure(
            ARCHITECTURE_RULES.MODULE_SINGLETON,
            sourceFile,
            declaration.name,
            "module-level singleton instances are forbidden",
          );
      }
    }
  };

  const inspectSourceFile = (sourceFile) => {
    const sourceLayer = layerFor(canonicalSourceRoot, sourceFile.fileName);
    for (const statement of sourceFile.statements)
      inspectTopLevelState(sourceFile, statement);

    const visit = (node) => {
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node))
        inspectStaticFields(sourceFile, node);
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        inspectImport(sourceFile, node, node.moduleSpecifier);
      if (
        ts.isExportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        inspectImport(sourceFile, node, node.moduleSpecifier);
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length === 1 &&
        ts.isStringLiteral(node.arguments[0])
      )
        inspectImport(sourceFile, node, node.arguments[0]);

      if (ts.isNewExpression(node)) {
        const symbol = checker.getSymbolAtLocation(node.expression);
        if (
          symbolIsGameSession(symbol) &&
          !isApprovedGameSessionOwner(canonicalSourceRoot, sourceFile.fileName)
        )
          addFailure(
            ARCHITECTURE_RULES.GAME_SESSION_CONSTRUCTION,
            sourceFile,
            node.expression,
            "GameSession construction belongs only in app/createGameApplication.ts",
          );
      }

      if (sourceLayer === "domain" || sourceLayer === "data") {
        if (
          ts.isPropertyAccessExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === "Math" &&
          node.name.text === "random"
        )
          addFailure(
            ARCHITECTURE_RULES.PURE_LAYER_BROWSER_API,
            sourceFile,
            node.name,
            "domain and authored data must not call Math.random()",
          );
        if (
          ts.isIdentifier(node) &&
          browserRuntimeIdentifiers.has(node.text) &&
          !isPropertyName(node) &&
          isBrowserGlobalReference(node)
        )
          addFailure(
            ARCHITECTURE_RULES.PURE_LAYER_BROWSER_API,
            sourceFile,
            node,
            "domain and authored data must not use browser or framework APIs",
          );
      }

      if (ts.isIdentifier(node) && serviceLocatorIdentifiers.has(node.text))
        addFailure(
          ARCHITECTURE_RULES.SERVICE_LOCATOR,
          sourceFile,
          node,
          "service locators and generic service access are forbidden",
        );
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.text;
        if (name === "ServiceLocator" || name === "Container")
          addFailure(
            ARCHITECTURE_RULES.SERVICE_LOCATOR,
            sourceFile,
            node.expression,
            "service locators and dependency containers are forbidden",
          );
      }
      if (ts.isCallExpression(node)) {
        const name = callName(node.expression)?.toLowerCase();
        if (name !== undefined && automaticRegistrationNames.has(name))
          addFailure(
            ARCHITECTURE_RULES.AUTOMATIC_REGISTRATION,
            sourceFile,
            node.expression,
            "automatic feature or service registration is forbidden",
          );
        if (
          ts.isPropertyAccessExpression(node.expression) &&
          ts.isIdentifier(node.expression.expression) &&
          ["services", "serviceLocator", "container"].includes(
            node.expression.expression.text,
          ) &&
          ["get", "resolve", "lookup"].includes(node.expression.name.text)
        )
          addFailure(
            ARCHITECTURE_RULES.SERVICE_LOCATOR,
            sourceFile,
            node.expression,
            "service locators and generic service access are forbidden",
          );
      }

      const directStorageIdentifier =
        ts.isIdentifier(node) &&
        storageIdentifiers.has(node.text) &&
        !isPropertyName(node) &&
        isBrowserGlobalReference(node);
      const storageProperty =
        ts.isPropertyAccessExpression(node) &&
        storageIdentifiers.has(node.name.text) &&
        ts.isIdentifier(node.expression) &&
        ["window", "globalThis"].includes(node.expression.text) &&
        isBrowserGlobalReference(node.expression);
      const cookieProperty =
        ts.isPropertyAccessExpression(node) &&
        node.name.text === "cookie" &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "document" &&
        isBrowserGlobalReference(node.expression);
      if (
        (directStorageIdentifier || storageProperty || cookieProperty) &&
        !isApprovedStorageAdapter(canonicalSourceRoot, sourceFile.fileName)
      )
        addFailure(
          ARCHITECTURE_RULES.DIRECT_STORAGE,
          sourceFile,
          ts.isPropertyAccessExpression(node) ? node.name : node,
          "browser storage belongs only in platform/storage adapters",
        );

      const directDomIdentifier =
        ts.isIdentifier(node) &&
        (node.text === "window" || node.text === "document") &&
        !isPropertyName(node) &&
        isBrowserGlobalReference(node);
      const domProperty =
        ts.isPropertyAccessExpression(node) &&
        (node.name.text === "window" || node.name.text === "document") &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "globalThis" &&
        isBrowserGlobalReference(node.expression);
      if (
        (directDomIdentifier || domProperty) &&
        !isApprovedDomAdapter(canonicalSourceRoot, sourceFile.fileName)
      )
        addFailure(
          ARCHITECTURE_RULES.DIRECT_DOM,
          sourceFile,
          ts.isPropertyAccessExpression(node) ? node.name : node,
          "direct DOM access belongs only in platform, UI, or main bootstrap code",
        );

      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  };

  for (const sourceFile of sourceFilesByPath.values())
    inspectSourceFile(sourceFile);

  const visited = new Set();
  const active = new Map();
  const stack = [];
  const reportedCycles = new Set();
  const visitCycle = (sourceFile) => {
    visited.add(sourceFile);
    active.set(sourceFile, stack.length);
    stack.push(sourceFile);
    for (const edge of importsBySource.get(sourceFile) ?? []) {
      if (active.has(edge.target)) {
        const cycle = [...stack.slice(active.get(edge.target)), edge.target];
        const signature = [...new Set(cycle.slice(0, -1))].sort().join("|");
        if (!reportedCycles.has(signature)) {
          reportedCycles.add(signature);
          addFailure(
            ARCHITECTURE_RULES.IMPORT_CYCLE,
            sourceFilesByPath.get(sourceFile),
            edge.node,
            `production import cycle: ${cycle
              .map((path) => relativePath(canonicalProjectRoot, path))
              .join(" -> ")}`,
          );
        }
      } else if (!visited.has(edge.target)) visitCycle(edge.target);
    }
    stack.pop();
    active.delete(sourceFile);
  };
  for (const sourceFile of sourceFilesByPath.keys())
    if (!visited.has(sourceFile)) visitCycle(sourceFile);

  const mainPath = canonicalPath(join(canonicalSourceRoot, "main.ts"));
  const mainSource = sourceFilesByPath.get(mainPath);
  if (mainSource !== undefined) {
    let createsApplication = false;
    const inspectBootstrap = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "createGameApplication"
      )
        createsApplication = true;
      ts.forEachChild(node, inspectBootstrap);
    };
    inspectBootstrap(mainSource);
    if (!createsApplication)
      addFailure(
        ARCHITECTURE_RULES.BOOTSTRAP_COMPOSITION,
        mainSource,
        mainSource,
        "src/main.ts must delegate application construction to createGameApplication",
      );
  }

  return {
    failures: failures.sort((left, right) =>
      formatFailure(left).localeCompare(formatFailure(right)),
    ),
    sourceFiles: [...sourceFilesByPath.keys()].sort(),
  };
};

export const runArchitectureGuard = (options = {}) => {
  const result = inspectArchitecture(options);
  return { ...result, ok: result.failures.length === 0 };
};

const cliOptions = (arguments_) => {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--project-root")
      options.projectRoot = arguments_[++index];
    else if (argument === "--tsconfig")
      options.tsconfigPath = arguments_[++index];
    else throw new Error(`unknown architecture guard option: ${argument}`);
  }
  return options;
};

const invokedAsScript =
  process.argv[1] !== undefined &&
  canonicalPath(process.argv[1]) ===
    canonicalPath(fileURLToPath(import.meta.url));

if (invokedAsScript) {
  const result = runArchitectureGuard(cliOptions(process.argv.slice(2)));
  if (!result.ok) {
    console.error(result.failures.map(formatFailure).join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      `architecture guard: PASS (${result.sourceFiles.length} production TypeScript files; compiler-API boundary analysis)`,
    );
}
