import fs from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

// Windows readers and virus scanners can briefly hold the destination open.
// Retry replacement without deleting the readable previous snapshot.
export async function replaceFile(temporary, target, { rename = fs.rename, wait = sleep } = {}) {
  for (let attempt = 0; ; attempt++) {
    try { await rename(temporary, target); return; }
    catch (error) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 9) throw error;
      await wait(50 * (attempt + 1));
    }
  }
}
