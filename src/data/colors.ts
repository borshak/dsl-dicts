/**
 * Color names accepted by `[c name]`.
 *
 * Lingvo accepts the HTML (CSS) named colors, written in lowercase only: `[c red]` is valid,
 * `[c Red]` is a compiler error. Sources: the DSL manual by Anatoly
 * (https://anatoly.dev/dsl-manual/, "DSL color palette") and the Mostitsky DSL Reference
 * (https://github.com/yozhic/DSL-Reference, `colors.html`).
 *
 * Discrepancies in the sources: the palette chapter claims 136 colors but lists 140 distinct CSS
 * names (141 spellings), and two of its lowercase listings spell `cornflowerblue` as
 * `cornflower`. Only the CSS spelling `cornflowerblue` is stored. The CSS `grey` aliases
 * (`grey`, `darkgrey`, ...) and `rebeccapurple` are not in the manual and are not stored.
 *
 * Only names are stored; the color values are left to the renderer.
 *
 * @packageDocumentation
 */

/** Color names allowed in `[c name]`, in alphabetical order. */
export const COLOR_NAMES = [
  'aliceblue',
  'antiquewhite',
  'aqua',
  'aquamarine',
  'azure',
  'beige',
  'bisque',
  'black',
  'blanchedalmond',
  'blue',
  'blueviolet',
  'brown',
  'burlywood',
  'cadetblue',
  'chartreuse',
  'chocolate',
  'coral',
  'cornflowerblue',
  'cornsilk',
  'crimson',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkgoldenrod',
  'darkgray',
  'darkgreen',
  'darkkhaki',
  'darkmagenta',
  'darkolivegreen',
  'darkorange',
  'darkorchid',
  'darkred',
  'darksalmon',
  'darkseagreen',
  'darkslateblue',
  'darkslategray',
  'darkturquoise',
  'darkviolet',
  'deeppink',
  'deepskyblue',
  'dimgray',
  'dodgerblue',
  'firebrick',
  'floralwhite',
  'forestgreen',
  'fuchsia',
  'gainsboro',
  'ghostwhite',
  'gold',
  'goldenrod',
  'gray',
  'green',
  'greenyellow',
  'honeydew',
  'hotpink',
  'indianred',
  'indigo',
  'ivory',
  'khaki',
  'lavender',
  'lavenderblush',
  'lawngreen',
  'lemonchiffon',
  'lightblue',
  'lightcoral',
  'lightcyan',
  'lightgoldenrodyellow',
  'lightgray',
  'lightgreen',
  'lightpink',
  'lightsalmon',
  'lightseagreen',
  'lightskyblue',
  'lightslategray',
  'lightsteelblue',
  'lightyellow',
  'lime',
  'limegreen',
  'linen',
  'magenta',
  'maroon',
  'mediumaquamarine',
  'mediumblue',
  'mediumorchid',
  'mediumpurple',
  'mediumseagreen',
  'mediumslateblue',
  'mediumspringgreen',
  'mediumturquoise',
  'mediumvioletred',
  'midnightblue',
  'mintcream',
  'mistyrose',
  'moccasin',
  'navajowhite',
  'navy',
  'oldlace',
  'olive',
  'olivedrab',
  'orange',
  'orangered',
  'orchid',
  'palegoldenrod',
  'palegreen',
  'paleturquoise',
  'palevioletred',
  'papayawhip',
  'peachpuff',
  'peru',
  'pink',
  'plum',
  'powderblue',
  'purple',
  'red',
  'rosybrown',
  'royalblue',
  'saddlebrown',
  'salmon',
  'sandybrown',
  'seagreen',
  'seashell',
  'sienna',
  'silver',
  'skyblue',
  'slateblue',
  'slategray',
  'snow',
  'springgreen',
  'steelblue',
  'tan',
  'teal',
  'thistle',
  'tomato',
  'turquoise',
  'violet',
  'wheat',
  'white',
  'whitesmoke',
  'yellow',
  'yellowgreen',
] as const;

/**
 * A color name allowed in `[c name]`.
 *
 * @experimental Part of the tag registry.
 */
export type ColorName = (typeof COLOR_NAMES)[number];

const KNOWN: ReadonlySet<string> = new Set(COLOR_NAMES);

/**
 * Tells whether `name` is a color accepted by `[c name]`.
 *
 * The check is case-sensitive, like Lingvo: `red` is known, `Red` is not.
 *
 * @experimental Part of the tag registry.
 */
export function isKnownColor(name: string): name is ColorName {
  return KNOWN.has(name);
}
