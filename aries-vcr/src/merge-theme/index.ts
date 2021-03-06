import * as ts from 'typescript';
import * as path from 'path';

import { Path } from '@angular-devkit/core';
import { Rule, SchematicContext, Tree, chain, SchematicsException } from '@angular-devkit/schematics';

/**
 * Utility functions are not necessarily public facing and are therefore
 * subject to change at any time. This could lead to schematics breaking.
 */
import * as ast from '@schematics/angular/utility/ast-utils';
// import * as change from '@schematics/angular/utility/change';
import * as config from '@schematics/angular/utility/config';
import * as models from '@schematics/angular/utility/workspace-models';

interface IComponentDescriptor {
  componentPath: string;
  templateUrl?: IComponentUrl;
  templateUrlPos?: number;
  styleUrls?: IComponentUrl[];
  styleUrlsPos?: number;
  componentUrls: IComponentUrl[];
}

interface IComponentUrl {
  text: string
}

interface ISharedComponentUrl {
  text: Set<string>;
  formatted: string;
}

const SRC_PATH = './src';
const ACTIVE_THEMES_PATH = 'themes/_active';
const ACTIVE_PREFIX = '(\\.*/*)*_active/';
const ACTIVE_SUFFIX = '.*/(.*\\..*)';
const ACTIVE_CUSTOM_SUFFIX = '.*/(.*\\.custom)';
const ACTIVE_THEMES_PREFIX = '(\\.*/*)*themes/_active/';
const APP_MODULE_PATH = path.join(SRC_PATH, 'app');
const SRC_STYLES_PATH = path.join(SRC_PATH, 'styles');
const SRC_ASSETS_PATH = path.join(SRC_PATH, 'assets');
const SRC_ACTIVE_THEMES_PATH = path.join(SRC_PATH, ACTIVE_THEMES_PATH);
const SRC_ACTIVE_THEMES_ASSETS_PATH = path.join(SRC_ACTIVE_THEMES_PATH, 'assets');
const SHARED_MODULE_PATH = path.join(APP_MODULE_PATH, 'shared');
const SHARED_STYLES_PATH = path.join(SHARED_MODULE_PATH, 'styles');

// You don't have to export the function as default. You can also have more than one rule factory
// per file.
export function mergeTheme(_options: any): Rule {
  return (tree: Tree, _context: SchematicContext) => {
    try {
      // Get all descrptiors that reference urls.
      // Skips components that use inline templates/styles
      const descriptors = buildPaths(tree, SRC_PATH)
        .map(tsPath => buildComponentDescriptor(tree, tsPath))
        .filter(descriptor => !!descriptor?.componentUrls.length) as IComponentDescriptor[];

      const sharedReferences = getSharedReferences(descriptors);

      const rule = chain([
        checkRootAngularProject(_options),
        moveShared(_options, sharedReferences),
        moveTheme(_options, descriptors, sharedReferences),
        updateThemeImports(_options, descriptors, sharedReferences),
        moveIndex(_options),
        moveOverrides(_options),
        updateAngularProject(_options),
      ]);
      return rule(tree, _context);
    } catch (error) {
      console.error(`Something went wrong:`);
      console.error(error);
    }
  };
}

export function checkRootAngularProject(_options: any): Rule {
  return (tree: Tree, _context: SchematicContext) => {
    const angularConfig = 'angular.json';
    if (!tree.exists(angularConfig)) {
      throw new SchematicsException('Not in a valid Angular workspace');
    }
    return tree;
  }
}

export function moveShared(_options: any, shared: ISharedComponentUrl[]): Rule {
  return (tree: Tree, _context: SchematicContext) => {
    shared
      .filter(url => path.parse(url.formatted).ext.match('\\.(s?c)ss'))
      .map(url => {
        const content = readPath(tree, path.join(SRC_PATH, ACTIVE_THEMES_PATH, url.formatted));
        return { text: url.formatted, content };
      })
      .filter(url => url.content !== undefined)
      .forEach(url => {
        const sharedPath = path.join(SHARED_STYLES_PATH, url.text);
        let sharedContent = url.content as string;
        sharedContent = moveCustomReferences(sharedContent);
        writeToTree(tree, sharedPath, sharedContent);
      });

    return tree;
  };
}

export function moveTheme(_options: any, descriptors: IComponentDescriptor[], shared: ISharedComponentUrl[]): Rule {
  return (tree: Tree, _context: SchematicContext) => {
    for (const descriptor of descriptors) {
      const componentDir = path.parse(descriptor.componentPath).dir;
      for (const descriptorUrl of descriptor.componentUrls) {
        const { descriptorDir, descriptorBase } = urlPath(descriptorUrl);
        const { from, to } = srcDestPath(descriptorDir, componentDir, descriptorBase);

        const isShared = shared.find(url => url.text.has(descriptorUrl.text));
        if (isShared) {
          continue;
        }

        let content = readPath(tree, from);
        if (content === undefined) {
          continue;
        }

        if (path.parse(from).ext.match('\\.(s?c)ss')) {
          content = moveCustomReferences(content);
        }
        writeToTree(tree, to, content);
      }
    }

    return tree;
  }
}

export function moveIndex(_options: any) {
  return (tree: Tree, _context: SchematicContext) => {
    const indexDir = tree.getDir(SRC_ACTIVE_THEMES_PATH);
    const assetsDir = tree.getDir(SRC_ACTIVE_THEMES_ASSETS_PATH);

    // Move index files
    indexDir.subfiles
      .filter(file => !path.parse(file).ext.match('\\.(s?c)ss'))
      .map(file => ({ file, content: readPath(tree, path.join(indexDir.path, file)) }))
      .filter(fileContent => fileContent.content !== undefined)
      .forEach(fileContent => {
        const to = path.join(SRC_PATH, fileContent.file);
        writeToTree(tree, to, fileContent.content as string);
      });

    // Move global styles
    indexDir.subfiles
      .filter(file => path.parse(file).ext.match('\\.(s?c)ss'))
      .map(file => ({ file, content: readPath(tree, path.join(indexDir.path, file)) }))
      .filter(fileContent => fileContent.content !== undefined)
      .forEach(fileContent => {
        const to = path.join(SRC_STYLES_PATH, fileContent.file);
        writeToTree(tree, to, fileContent.content as string);
      });

    // Move assets
    assetsDir.subfiles
      .map(file => ({ file, content: readPath(tree, path.join(assetsDir.path, file)) }))
      .filter(fileContent => fileContent.content !== undefined)
      .forEach(fileContent => {
        const to = path.join(SRC_ASSETS_PATH, fileContent.file);
        writeToTree(tree, to, fileContent.content as string);
      });

    deepCopyDir(SRC_ACTIVE_THEMES_ASSETS_PATH, 'assets');

    function deepCopyDir(dirPath: string, dirName: string) {
      const dir = tree.getDir(dirPath);

      // Copy files over
      dir.subfiles
        .map(file => ({ file, content: readPath(tree, path.join(dir.path, file)) }))
        .filter(fileContent => fileContent.content !== undefined)
        .forEach(fileContent => {
          const to = path.join(SRC_ASSETS_PATH, dirName, fileContent.file);
          writeToTree(tree, to, fileContent.content as string);
        });

      if (!dir.subdirs.length) {
        return;
      }
      dir.subdirs.forEach(sub => deepCopyDir(path.join(dir.path, sub), sub));
    }

    return tree;
  };
}

export function moveOverrides(_options: any): Rule {
  return (tree: Tree, _context: SchematicContext) => {
    tree.getDir(SRC_PATH).visit((filePath: Path) => {
      if (filePath.includes('.custom.scss')) {
        const fileContent = readPath(tree, filePath);
        if (fileContent !== undefined) {
          const to = `${SHARED_STYLES_PATH}/custom/${path.parse(filePath).base}`;
          writeToTree(tree, to, fileContent as string);
        }
      }
    });
    return tree;
  }
}

export function updateAngularProject(_options: any): Rule {
  return (tree: Tree, _context: SchematicContext) => {
    const angularConfig = 'angular.json';
    if (!tree.exists(angularConfig)) {
      throw new SchematicsException('Not in a valid Angular workspace');
    }

    const workspaceConfig: models.WorkspaceSchema = config.getWorkspace(tree);
    const projects = workspaceConfig.projects;
    for (const project in projects) {
      if (Object.prototype.hasOwnProperty.call(projects, project)) {
        const projectConfig = projects[project];
        const architect = projectConfig.architect;
        const buildpotions: any = architect?.build?.options;
        const testOptions: any = architect?.test?.options;
        updateOptions(buildpotions, projects, project, projectConfig);
        updateOptions(testOptions, projects, project, projectConfig);
      }
    }
    writeToTree(tree, angularConfig, JSON.stringify(workspaceConfig, null, 2));
    return tree;
  }

  function updateOptions(options: any, projects: { [key: string]: models.WorkspaceProject<models.ProjectType>; }, project: string, projectConfig: models.WorkspaceProject<models.ProjectType>) {
    if (options?.index) {
      options.index = options.index.replace(`/${ACTIVE_THEMES_PATH}`, '');
    }
    if (options?.stylePreprocessorOptions?.includePaths) {
      const idx = options.stylePreprocessorOptions.includePaths.indexOf(SRC_ACTIVE_THEMES_PATH);
      options.stylePreprocessorOptions.includePaths.splice(idx, 1);
    }
    if (options?.assets) {
      options.assets = options.assets.map((asset: any) => {
        asset.input = asset.input.replace(`/${ACTIVE_THEMES_PATH}`, '');
        return asset;
      });
    }
    if (options?.styles) {
      options.styles = options.styles.map((style: any) => {
        style = style.replace(`/${ACTIVE_THEMES_PATH}`, '/styles');
        return style;
      });
    }
    projects[project] = projectConfig;
  }
}

/**
 * 
 * @param content string
 */
function moveCustomReferences(content: string) {
  const regex = new RegExp(`('|")${ACTIVE_PREFIX}${ACTIVE_CUSTOM_SUFFIX}('|")`, 'g');
  if (content?.match(regex)) {
    content = content?.replace(regex, `"${SHARED_STYLES_PATH}/custom/$3"`);
  }
  return content;
}

/**
 * 
 * @param tree Tree
 * @param to string
 * @param content string
 */
function writeToTree(tree: Tree, to: string, content: string) {
  if (!tree.exists(to)) {
    tree.create(to, content as string);
  } else {
    tree.overwrite(to, content as string);
  }
}

/**
 * 
 * @param descriptorUrl IComponentUrl
 */
function urlPath(descriptorUrl: IComponentUrl) {
  const descriptorPath = path.parse(descriptorUrl.text);
  const descriptorDir = descriptorPath.dir;
  const descriptorBase = descriptorPath.base;
  return { descriptorDir, descriptorBase };
}

// Not the most ideal approach to use Regex
export function updateThemeImports(_options: any, descriptors: IComponentDescriptor[], shared: ISharedComponentUrl[]): Rule {
  return (tree: Tree, _context: SchematicContext) => {
    for (const descriptor of descriptors) {
      const componentPath = descriptor.componentPath;
      const componentDir = path.parse(componentPath).dir;
      let content = readPath(tree, componentPath);
      shared.forEach(url => {
        const relativePath = path.relative(componentDir, `/${APP_MODULE_PATH}`);
        const sharedRegex = new RegExp(`('|")${ACTIVE_THEMES_PREFIX}${url.formatted}('|")`);
        content = content?.replace(sharedRegex, `'${relativePath}/shared/styles/${url.formatted}'`);
      });
      const regex = new RegExp(`('|")${ACTIVE_THEMES_PREFIX}${ACTIVE_SUFFIX}('|")`, 'g');
      content = content?.replace(regex, `'./$3'`);

      if (content === undefined) {
        continue;
      }
      writeToTree(tree, componentPath, content);
    }

    return tree;
  }
}

// /**
//  * 
//  * @param tree Tree
//  * @param componentPath string
//  * @param pos number
//  * @param oldText string
//  * @param newText string
//  */
// function updateComponentImport(tree: Tree, componentPath: string, pos: number, oldText: string, newText: string) {
//   const updateRecorder = tree.beginUpdate(componentPath);
//   const update = new change.ReplaceChange(componentPath, pos, oldText, newText);
//   change.applyToUpdateRecorder(updateRecorder, [update]);
//   tree.commitUpdate(updateRecorder);
// }

/**
 * 
 * @param componentDir string
 * @param descriptorPath string
 * @param file string
 */
function srcDestPath(descriptorDir: string, componentDir: string, file: string) {
  const from = path.join(componentDir, descriptorDir, file);
  const to = path.join(componentDir, file);
  return { from, to };
}

/**
 * 
 * @param tree Tree
 * @param path string
 */
function buildComponentDescriptor(tree: Tree, path: string): IComponentDescriptor | undefined {
  const content = readPath(tree, path);
  if (!content) {
    return;
  }

  const source = getSource(content);
  if (!source) {
    return;
  }

  const decoratorNode = getDecorator(source);
  // Likely not a component
  if (!decoratorNode) {
    return;
  }

  const decoratorMetaDataNode = getDecoratorMetaData(source);
  if (!decoratorMetaDataNode) {
    return;
  }

  return getComponentDescriptors(decoratorMetaDataNode, path);
}

/**
 * 
 * @param decoratorMetaDataNode Node
 * @param componentPath string
 */
function getComponentDescriptors(decoratorMetaDataNode: ts.Node, componentPath: string): IComponentDescriptor {
  const templateUrlInit = getMetaDataValue<ts.StringLiteral>(
    getMetaDataProperty(decoratorMetaDataNode, 'templateUrl'));
  const styleUrlsInint = getMetaDataValue<ts.ArrayLiteralExpression>(
    getMetaDataProperty(decoratorMetaDataNode, 'styleUrls'));

  const templateUrl = templateUrlInit && { text: templateUrlInit.text };
  const styleUrls = styleUrlsInint?.elements
    .map((element: ts.StringLiteral) => ({ text: element.text }));
  const componentUrls: IComponentUrl[] = [];

  if (templateUrl) {
    componentUrls.push(templateUrl);
  }
  if (styleUrls) {
    componentUrls.push(...styleUrls);
  }

  const imports: IComponentDescriptor = {
    componentPath,
    templateUrl,
    styleUrls,
    componentUrls
  };

  return imports;
}

/**
 * 
 * @param descriptors IComponentDescriptor[]
 */
function getSharedReferences(descriptors: IComponentDescriptor[] = []): ISharedComponentUrl[] {
  const allUrls = flattenComponentUrls(descriptors);

  const processedUrls = allUrls
    .map(url => {
      const urlMatch = url.text.match(`/${ACTIVE_THEMES_PATH}/(.*)`);
      return {
        text: url.text,
        formatted: urlMatch?.length && urlMatch[1] || ''
      };
    })
    .filter(url => !!url.formatted);

  const urlCounts = processedUrls
    .reduce((counts, url) => {
      let _count = counts[url.formatted];
      if (!_count) {
        _count = {
          text: new Set<string>(),
          formatted: url.formatted,
          count: 0
        }
      }
      _count.text.add(url.text);
      _count.count += 1;
      counts[_count.formatted] = _count;
      return counts;
    }, <any>{});

  return (Object.values(urlCounts) as any[])
    .filter(url => url.count > 1) as ISharedComponentUrl[];
}

/**
 * 
 * @param descriptors IComponentDescriptor[]
 */
function flattenComponentUrls(descriptors: IComponentDescriptor[]) {
  return descriptors
    .reduce((refs, descriptors) => {
      return refs.concat(descriptors.componentUrls);
    }, [] as IComponentUrl[]);
}

/**
 * 
 * @param tree Tree
 * @param source string
 */
function buildPaths(tree: Tree, source = '.'): string[] {
  const paths: string[] = [];
  tree.getDir(source).visit((path: Path) => {
    // Skip any files that aren't TypeScript and skip tests
    if (path.includes('.ts') && !path.includes('.spec.ts')) {
      paths.push(path);
    }
  });
  return paths;
}

/**
 * 
 * @param tree Tree
 * @param path string
 */
function readPath(tree: Tree, path: string): string | undefined {
  const tsBuffer = tree.read(path);
  const content = tsBuffer?.toString('utf-8');
  return content;
}

/**
 * 
 * @param content string
 */
function getSource(content: string, filepath = 'node.ts'): ts.SourceFile {
  return ts.createSourceFile(filepath, content, ts.ScriptTarget.Latest, true);
}

/**
 * 
 * @param source SourceFile
 */
function getDecorator(source: ts.SourceFile): ts.Node | undefined {
  const allNodes = ast.getSourceNodes(source);
  const decoratorNode = allNodes.find((node: ts.Node) => ts.isDecorator(node));
  return decoratorNode;
}

/**
 * 
 * @param source SourceFile
 */
function getDecoratorMetaData(source: ts.SourceFile): ts.Node {
  return ast.getDecoratorMetadata(source, 'Component', '@angular/core')[0];
}

/**
 * 
 * @param decoratorMetaDataNode Node
 * @param property string
 */
function getMetaDataProperty(decoratorMetaDataNode: ts.Node, property: string): ts.PropertyAssignment | undefined {
  if (!property) {
    return;
  }
  return ast.getMetadataField(decoratorMetaDataNode as ts.ObjectLiteralExpression, property)[0] as ts.PropertyAssignment;
}

/**
 * 
 * @param propertyAssignmentNode PropertyAssignment
 */
function getMetaDataValue<T>(propertyAssignmentNode?: ts.PropertyAssignment): T | undefined {
  if (!propertyAssignmentNode) {
    return;
  }
  return propertyAssignmentNode.initializer as unknown as T;
}