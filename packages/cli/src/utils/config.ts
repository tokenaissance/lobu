import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { join } from "node:path";

export async function checkConfigExists(cwd: string): Promise<boolean> {
  try {
    await access(join(cwd, ".termos"), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
