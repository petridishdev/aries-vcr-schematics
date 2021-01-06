import * as ts from 'typescript';
import * as path from 'path';

import { Path } from '@angular-devkit/core';
import { apply, move, url, Rule, SchematicContext, Tree, mergeWith, chain, MergeStrategy, filter, forEach } from '@angular-devkit/schematics';

/**
 * Utility functions are not necessarily public facing and are therefore
 * subject to change at any time. This could lead to schematics breaking.
 */
import * as ast from '@schematics/angular/utility/ast-utils';
// import * as change from '@schematics/angular/utility/change';

// interface IComponentDescriptorDiff {
//   descriptor: IComponentDescriptor;
//   modifications: IComponentUrl[];
// }

interface IComponentDescriptor {
  componentPath: string;
  templateUrl?: IComponentUrl;
  styleUrls?: IComponentUrl[];
  componentUrls: IComponentUrl[];
}

interface IComponentUrl {
  text: string,
  pos: number,
}

const PATH_MATCH = '/themes/_active/';

// You don't have to export the function as default. You can also have more than one rule factory
// per file.
export function mergeTheme(_options: any): Rule {
  return (tree: Tree, _context: SchematicContext) => {
    try {
      // Get all descrptiors that reference urls.
      // Skips components that use inline templates/styles
      const cDescriptors = buildPaths(tree, './src')
        .map(tsPath => buildComponentDescriptor(tree, tsPath))
        .filter(cDescriptor => !!cDescriptor?.componentUrls.length) as IComponentDescriptor[];

      const sharedReferences = getSharedReferences(cDescriptors);

      console.log(sharedReferences);

      const merges = [];
      for (const cDescriptor of cDescriptors) {
        const cPathObj = path.parse(cDescriptor.componentPath);
        for (const descriptorUrl of cDescriptor.componentUrls) {
          const dPathObj = path.parse(descriptorUrl.text);
          const from = path.resolve(path.join(process.cwd(), cPathObj.dir, dPathObj.dir));
          const to = cPathObj.dir;
          const templateSource = apply(url(from), [
            filter(treePath => {
              const tPathObj = path.parse(treePath);
              return tPathObj.base === dPathObj.base;
            }),
            move(to),
            forEach(file => {
              // Handles the case where a file already exists in the same path as the component
              if (tree.exists(file.path)) {
                tree.overwrite(file.path, file.content);
              }
              return file;
            }),
          ]);
          merges.push(mergeWith(templateSource, MergeStrategy.Overwrite));
        }
      }

      const rule = chain(merges);
      return rule(tree, _context);
    } catch (error) {
      console.error(`Something went wrong: ${error}`);
    }
  };
}

// Step 0. Ensure we're at the root of an angular application

// Step 1. Move shared references over

// Step 2. Update component decorator references. If using a shared reference update accordingly 

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

  const templateUrl = templateUrlInit && { text: templateUrlInit.text, pos: templateUrlInit.pos };
  const styleUrls = styleUrlsInint?.elements
    .map((element: ts.StringLiteral) => ({ text: element.text, pos: element.pos }));
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
 * @param cDescriptors IComponentDescriptor[]
 */
function getSharedReferences(cDescriptors: IComponentDescriptor[] = []): Set<string> {
  const urlCounts = cDescriptors
    .reduce((refs, cDescriptor) => {
      return refs.concat(cDescriptor.componentUrls);
    }, [] as IComponentUrl[])
    .map(url => {
      // Some urls are deeply nested but reference shared active theme files
      const urlMatch = url.text.match(`${PATH_MATCH}(.*)`);
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