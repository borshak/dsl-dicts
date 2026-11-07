/**
 * `dsl-dicts info`.
 *
 * @packageDocumentation
 */

import { resolve } from 'node:path';
import { AST_VERSION, findDiagnosticSpec, VERSION } from '../../index.js';
import { openDsl } from '../open.js';
import { openOptions } from './convert.js';
import { CliError, describeError, EXIT } from './errors.js';
import type { CliIo } from './io.js';
import type { InfoOptions } from './options.js';
import { writeChunks } from './output.js';
import { createReporter } from './report.js';

/** Runs `info`; returns the exit code. */
export async function info(options: InfoOptions, io: CliIo): Promise<number> {
  const file = resolve(io.cwd, options.path);
  const reporter = createReporter(file, io.stderr, options.verbosity);
  const dict = await openDsl(file, {
    ...openOptions(options, io.cwd),
    positions: false,
    diagnostics: reporter,
  }).catch((error: unknown) => {
    throw new CliError(EXIT.dictionary, `${file}: ${describeError(error)}`, { cause: error });
  });

  let entries = 0;
  for await (const batch of dict.batches()) entries += batch.length;
  const header = await dict.header;
  const decode = await dict.info;
  const counts = dict.diagnosticCounts();

  const report: InfoReport = {
    file,
    generator: { name: 'dsl-dicts', version: VERSION },
    astVersion: AST_VERSION,
    dictionary: {
      name: header.name ?? null,
      indexLanguage: header.indexLanguage ?? null,
      contentsLanguage: header.contentsLanguage ?? null,
    },
    directives: header.directives.map(({ name, value }) => ({ name, value })),
    decode: {
      encoding: decode.encoding,
      source: decode.source,
      bom: decode.bom,
      compression: decode.compression,
      asciiOnly: decode.asciiOnly,
      ...(decode.directive === undefined ? {} : { sourceCodePage: decode.directive }),
    },
    files: { ...dict.files },
    abbreviations: dict.abbreviations?.size ?? null,
    annotationSections: dict.annotation?.sections.length ?? null,
    entries,
    diagnostics: counts,
  };

  const text =
    options.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report);
  await writeChunks(io.stdout, [text]);
  return EXIT.ok;
}

/** What `info` finds out about a dictionary; printed as is by `--format json`. */
interface InfoReport {
  readonly file: string;
  readonly generator: { readonly name: string; readonly version: string };
  readonly astVersion: number;
  readonly dictionary: {
    readonly name: string | null;
    readonly indexLanguage: string | null;
    readonly contentsLanguage: string | null;
  };
  readonly directives: readonly { readonly name: string; readonly value: string }[];
  readonly decode: {
    readonly encoding: string;
    readonly source: string;
    readonly bom: boolean;
    readonly compression: string;
    readonly asciiOnly: boolean;
    readonly sourceCodePage?: string;
  };
  readonly files: Readonly<Record<string, string | undefined>>;
  readonly abbreviations: number | null;
  readonly annotationSections: number | null;
  readonly entries: number;
  readonly diagnostics: {
    readonly total: number;
    readonly bySeverity: Readonly<Record<string, number>>;
    readonly byCode: Readonly<Record<string, number>>;
  };
}

function formatReport(report: InfoReport): string {
  const rows: [string, string][] = [
    ['File', report.file],
    ['Name', report.dictionary.name ?? '(none)'],
    ['Index language', report.dictionary.indexLanguage ?? '(none)'],
    ['Contents language', report.dictionary.contentsLanguage ?? '(none)'],
    [
      'Encoding',
      `${report.decode.encoding} (detected by: ${report.decode.source}${report.decode.bom && report.decode.source !== 'bom' ? ', BOM present' : ''})`,
    ],
    ['Compression', report.decode.compression],
    ['Entries', String(report.entries)],
  ];
  if (report.decode.sourceCodePage !== undefined) {
    rows.splice(5, 0, ['#SOURCE_CODE_PAGE', report.decode.sourceCodePage]);
  }
  const width = Math.max(...rows.map(([name]) => name.length));
  const lines = rows.map(([name, value]) => `${`${name}:`.padEnd(width + 2)}${value}`);

  lines.push('', 'Companion files:');
  const kinds = ['abbreviations', 'annotation', 'icon', 'media'] as const;
  for (const kind of kinds) {
    const path = report.files[kind];
    const detail =
      kind === 'abbreviations' && report.abbreviations !== null
        ? ` (${report.abbreviations} abbreviations)`
        : kind === 'annotation' && report.annotationSections !== null
          ? ` (${report.annotationSections} sections)`
          : '';
    lines.push(`  ${kind.padEnd(14)}${path === undefined ? '-' : `${path}${detail}`}`);
  }

  const { total, bySeverity, byCode } = report.diagnostics;
  lines.push('', total === 0 ? 'Diagnostics: none' : `Diagnostics: ${total}`);
  if (total > 0) {
    lines.push(
      `  ${Object.entries(bySeverity)
        .filter(([, count]) => count > 0)
        .map(([severity, count]) => `${count} ${severity}`)
        .join(', ')}`,
    );
    for (const [code, count] of Object.entries(byCode)) {
      const spec = findDiagnosticSpec(code);
      lines.push(`  ${code}  ${String(count).padStart(7)}  ${spec?.summary ?? ''}`.trimEnd());
    }
  }
  return `${lines.join('\n')}\n`;
}
