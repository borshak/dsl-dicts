import { DslError, parseDsl } from 'dsl-dicts';

const text = `#NAME "Tiny English-German"
#INDEX_LANGUAGE "English"
#CONTENTS_LANGUAGE "German"

cat
\t[m1][trn]Katze[/trn] [b]never closed
`;

// Tolerant by default: problems become diagnostics, and parsing goes on.
const dict = parseDsl(text);
for await (const entry of dict.entries()) console.log(entry.headwords[0]?.text); // cat
for (const { code, severity, message, position } of dict.diagnostics) {
  console.log(`${position?.line}:${position?.column} ${severity} ${code} ${message}`);
}
console.log(dict.diagnosticCounts().byCode); // { DSL4202: 1 }

// Strict: the first diagnostic of that severity, or a worse one, stops reading.
try {
  for await (const entry of parseDsl(text, { strict: 'warning' }).entries()) {
    console.log(entry.headwords[0]?.text); // never reached
  }
} catch (error) {
  if (!(error instanceof DslError)) throw error;
  console.log(error.code, error.diagnostic?.position?.line); // DSL4202 6
}
