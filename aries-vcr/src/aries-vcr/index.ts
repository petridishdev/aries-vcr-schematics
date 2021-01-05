import * as ts from 'typescript';

import { Path } from '@angular-devkit/core';
import { Rule, SchematicContext, Tree } from '@angular-devkit/schematics';

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

      for (const path of tsPaths) {
        const content = readPath(tree, path);
        if (!content) {
          continue;
        }

        const source = getSource(content);
        if (!source) {
          continue;
        }

        const decoratorNode: ts.Node | undefined = getDecorator(source);
        // Likely not a component
        if (!decoratorNode) {
          continue;
        }

        const decoratorMetaDataNode: ts.Node = getDecoratorMetaData(source);
        if (!decoratorMetaDataNode) {
          continue;
        }

        const templateUrlNode = ast.getMetadataField(decoratorMetaDataNode as ts.ObjectLiteralExpression, 'templateUrl');
        const styleUrlsNode = ast.getMetadataField(decoratorMetaDataNode as ts.ObjectLiteralExpression, 'styleUrls');

        // Note: not all components will have `templateUrl` or `styleUrls` defined in the decorator

        const templateUrl = ((templateUrlNode[0] as ts.PropertyAssignment).initializer as ts.StringLiteral).text;
        const styleUrls = (((styleUrlsNode[0] as ts.PropertyAssignment).initializer) as ts.ArrayLiteralExpression).elements
          .map((element: ts.StringLiteral) => element.text);

        console.log(templateUrl);
        console.log(styleUrls);
      }
      return tree;

    } catch (error) {
      console.error(`Something went wrong: ${error}`);
    }
  };
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
  const allNodes: ts.Node[] = ast.getSourceNodes(source);
  const decoratorNode: ts.Node | undefined = allNodes.find((node: ts.Node) => ts.isDecorator(node));
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
