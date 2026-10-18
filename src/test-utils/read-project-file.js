import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

/** Read a project source fixture with stable text newlines on Windows and Linux. */
export const readProjectFile = (file) =>
  readFileSync(resolve(process.cwd(), file), "utf8").replace(/\r\n/g, "\n");
