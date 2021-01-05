import * as ts from 'typescript';
// import * as path from 'path';

import { Path } from '@angular-devkit/core';
import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';

interface IComponentPath {
  componentPath: string;
  templateUrl?: string;
  styleUrls?: string[];
  componentUrls: string[];
}

/**
 * Utility functions are not necessarily public facing and are therefore
 * subject to change at any time. This could lead to schematics breaking.
 */
import * as ast from '@schematics/angular/utility/ast-utils';

// You don't have to export the function as default. You can also have more than one rule factory
// per file.
export function ariesVcr(_options: any): Rule {
  return (tree: Tree, _context: SchematicContext) => {
    try {

      const tsPaths = buildPaths(tree, './src');
      const componentPaths = tsPaths
        .map(path => buildComponentPath(tree, path))
        .filter(path => !!path) as IComponentPath[];
      // const sharedUrlRefs = getSharedUrlRefs(componentPaths);

      console.log(componentPaths);

      return tree;

    } catch (error) {
      console.error(`Something went wrong: ${error}`);
    }
  };
}

// function getSharedUrlRefs(componentPaths: IComponentPath[] = []): Set<string> {
//   const urlCounts = componentPaths
//     .reduce((refs, path) => {
//       if (path?.templateUrl) {
//         refs.push(path.templateUrl);
//       }
//       if (path?.styleUrls) {
//         refs.push(...path.styleUrls)
//       }
//       return refs;
//     }, [] as string[])
//     .reduce((counts: any, url: string) => {
//       return { ...counts, [url]: (counts[url] || 0) + 1 }
//     }, {} as { [url: string]: number });

//   return new Set<string>(Object.keys(urlCounts)
//     .filter(url => urlCounts[url] > 1));
// }

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

  if (templateUrl) {
    componentUrls.push(templateUrl);
  }
  if (styleUrls) {
    componentUrls.push(...styleUrls);
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
