import { readMissionState } from "./common.mjs";

export const readStatus = ({ cwd = process.cwd() } = {}) =>
  readMissionState(cwd);

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write(`${JSON.stringify(readStatus(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
