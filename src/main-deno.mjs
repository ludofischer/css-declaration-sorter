import shorthandData from './shorthand-data.mjs';

const currentDirectory = new URL('.', import.meta.url).pathname;

const builtInOrders = [
  'alphabetical',
  'concentric-css',
  'smacss',
];

/**
 * Sort CSS, SCSS or Less declarations based on their property names.
 * @public
 * @param order - Provide the name of one of the built-in sort orders or a comparison function that is passed to `Array.sort`.
 * @param keepOverrides - Prevent breaking legacy CSS where shorthand declarations override longhand declarations.
 * @see {@link https://github.com/Siilwyn/css-declaration-sorter/blob/master/readme.md#api | API documentation}
 * @see {@link https://github.com/Siilwyn/css-declaration-sorter/blob/master/readme.md#usage | Usage examples}
 */
const pluginEntrypoint = ({ order = 'alphabetical', keepOverrides = false } = {}) => ({
  postcssPlugin: 'css-declaration-sorter',
  OnceExit (css) {
    let withKeepOverrides = comparator => comparator;
    if (keepOverrides) {
      withKeepOverrides = withOverridesComparator(shorthandData);
    }

    if (typeof order === 'function') {
      return processCss({ css, comparator: withKeepOverrides(order) });
    }

    if (!builtInOrders.includes(order))
      return Promise.reject(
        Error([
          `Invalid built-in order '${order}' provided.`,
          `Available built-in orders are: ${builtInOrders}`,
        ].join('\n'))
      );

    // Load in the array containing the order from a JSON file
    return Deno.readTextFile(`${currentDirectory}/../orders/${order}.json`)
      .then(data => processCss({
        css,
        comparator: withKeepOverrides(orderComparator(JSON.parse(data))),
      }));
  },
});

pluginEntrypoint.postcss = true;
export default pluginEntrypoint;

function processCss ({ css, comparator }) {
  const comments = [];
  const rulesCache = [];

  css.walk(node => {
    const nodes = node.nodes;
    const type = node.type;

    if (type === 'comment') {
      // Don't do anything to root comments or the last newline comment
      const isNewlineNode = node.raws.before && ~node.raws.before.indexOf('\n');
      const lastNewlineNode = isNewlineNode && !node.next();
      const onlyNode = !node.prev() && !node.next();

      if (lastNewlineNode || onlyNode || node.parent.type === 'root') {
        return;
      }

      if (isNewlineNode) {
        const pairedNode = node.next() ? node.next() : node.prev().prev();
        if (pairedNode) {
          comments.unshift({
            'comment': node,
            'pairedNode': pairedNode,
            'insertPosition': node.next() ? 'Before' : 'After',
          });
          node.remove();
        }
      } else {
        const pairedNode = node.prev() ? node.prev() : node.next().next();
        if (pairedNode) {
          comments.push({
            'comment': node,
            'pairedNode': pairedNode,
            'insertPosition': 'After',
          });
          node.remove();
        }
      }
      return;
    }

    // Add rule-like nodes to a cache so that we can remove all
    // comment nodes before we start sorting.
    const isRule = type === 'rule' || type === 'atrule';
    if (isRule && nodes && nodes.length > 1) {
      rulesCache.push(nodes);
    }
  });

  // Perform a sort once all comment nodes are removed
  rulesCache.forEach(nodes => {
    sortCssDeclarations({ nodes, comparator });
  });

  // Add comments back to the nodes they are paired with
  comments.forEach(node => {
    const pairedNode = node.pairedNode;
    node.comment.remove();
    pairedNode.parent['insert' + node.insertPosition](pairedNode, node.comment);
  });
}

function sortCssDeclarations ({ nodes, comparator }) {
  nodes.sort((a, b) => {
    if (a.type === 'decl' && b.type === 'decl') {
      return comparator(a.prop, b.prop);
    } else {
      return compareDifferentType(a, b);
    }
  });
}

function withOverridesComparator (shorthandData) {
  return function (comparator) {
    return function (a, b) {
      a = removeVendorPrefix(a);
      b = removeVendorPrefix(b);

      if (shorthandData[a] && shorthandData[a].includes(b)) return 0;
      if (shorthandData[b] && shorthandData[b].includes(a)) return 0;

      return comparator(a, b);
    };
  };
}

function orderComparator (order) {
  return function (a, b) {
    return order.indexOf(a) - order.indexOf(b);
  };
}

function compareDifferentType (a, b) {
  if (b.type === 'atrule') {
    return 0;
  }

  return a.type === 'decl' ? -1 : b.type === 'decl' ? 1 : 0;
}

function removeVendorPrefix (property) {
  return property.replace(/^-\w+-/, '');
}
