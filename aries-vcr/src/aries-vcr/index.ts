import * as ts from 'typescript';
import * as path from 'path';

import { Path } from '@angular-devkit/core';
import { apply, move, url, Rule, SchematicContext, Tree, mergeWith, chain, MergeStrategy, filter } from '@angular-devkit/schematics';

/**
 * Utility functions are not necessarily public facing and are therefore
 * subject to change at any time. This could lead to schematics breaking.
 */
import * as ast from '@schematics/angular/utility/ast-utils';

interface IComponentPath {
  componentPath: string;
  templateUrl?: string;
  styleUrls?: string[];
  componentUrls: string[];
}

const PATH_MATCH = '/themes/_active/';

// You don't have to export the function as default. You can also have more than one rule factory
// per file.
export function ariesVcr(_options: any): Rule {
  return (tree: Tree, _context: SchematicContext) => {
    try {
      const cPaths = buildPaths(tree, './src')
        .map(tsPath => buildComponentPath(tree, tsPath))
        .filter(cPath => !!(cPath && cPath?.componentUrls.length)) as IComponentPath[];
      const sharedUrlRefs = getSharedUrlRefs(cPaths);

      console.log(sharedUrlRefs);

      const merges = [];
      for (const cPath of cPaths) {
        const cPathObj = path.parse(cPath.componentPath);
        for (const tUrl of cPath.componentUrls) {
          const tPathObj = path.parse(tUrl);
          const from = path.resolve(path.join(process.cwd(), cPathObj.dir, tPathObj.dir));
          const to = cPathObj.dir;
          merges.push(mergeWith(apply(url(from), [
            filter(treePath => {
              const treePathObj = path.parse(treePath);
              return treePathObj.base === tPathObj.base;
            }),
            move(to)
          ]), MergeStrategy.Overwrite));
        }
      }

      const rule = chain(merges);
      return rule(tree, _context);
    } catch (error) {
      console.error(`Something went wrong: ${error}`);
    }
  };
}

function getSharedUrlRefs(cPaths: IComponentPath[] = []): Set<string> {
  const urlCounts = cPaths
    .reduce((refs, cPath) => {
      return refs.concat(cPath.componentUrls);
    }, [] as string[])
    .map(url => {
      // Some urls are deeply nested but reference shared active theme files
      const urlMatch = url.match(`${PATH_MATCH}(.*)`);
      return urlMatch?.length && urlMatch[1];
    })
    .filter(url => !!url)
    .reduce((counts: any, url: string) => {
      return { ...counts, [url]: (counts[url] || 0) + 1 }
    }, {} as { [url: string]: number });

  return new Set<string>(Object.keys(urlCounts)
    .filter(url => urlCounts[url] > 1));
}

/**
 * 
 * @param tree Tree
 * @param path string
 */
function buildComponentPath(tree: Tree, path: string): IComponentPath | undefined {
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

  return getComponentImportPath(decoratorMetaDataNode, path);
}

/**
 * 
 * @param decoratorMetaDataNode Node
 * @param componentPath string
 */
function getComponentImportPath(decoratorMetaDataNode: ts.Node, componentPath: string): IComponentPath {
  const templateUrlInit = getMetaDataValue<ts.StringLiteral>(
    getMetaDataProperty(decoratorMetaDataNode, 'templateUrl'));
  const styleUrlsInint = getMetaDataValue<ts.ArrayLiteralExpression>(
    getMetaDataProperty(decoratorMetaDataNode, 'styleUrls'));

  const templateUrl = templateUrlInit?.text;
  const styleUrls = styleUrlsInint?.elements.map((element: ts.StringLiteral) => element.text);
  const componentUrls: string[] = [];

  // Skip over any urls that don't reference active theme files
  if (templateUrl && templateUrl.includes(PATH_MATCH)) {
    componentUrls.push(templateUrl);
  }
  if (styleUrls) {
    componentUrls.push(...styleUrls.filter(styleUrl => styleUrl.includes(PATH_MATCH)));
  }

  const templatePaths: IComponentPath = {
    componentPath,
    templateUrl,
    styleUrls,
    componentUrls
  };

  return templatePaths;
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
 * @param source SourceFile
 */
function getDecoratorMetaData(source: ts.SourceFile): ts.Node {
  return ast.getDecoratorMetadata(source, 'Component', '@angular/core')[0];
}

/**
 * 
 * @param content string
 */
function getSource(content: string): ts.SourceFile {
  return ts.createSourceFile('node.ts', content, ts.ScriptTarget.Latest, true);
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
 * @param tree Tree
 * @param source string
 */
function buildPaths(tree: Tree, source: string = '.'): string[] {
  const paths: string[] = [];
  tree.getDir(source).visit((path: Path) => {
    // Skip any files that aren't TypeScript and skip tests
    if (path.includes('.ts') && !path.includes('.spec.ts')) {
      paths.push(path);
    }
  });
  return paths;
}
