import { runHermes } from '../src/hermes.mjs';

try {
  await runHermes(process.argv[2]);
} catch {
  console.error('Coach Hermes command failed.');
  process.exitCode = 1;
}
