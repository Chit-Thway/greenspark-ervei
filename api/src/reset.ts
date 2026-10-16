import { rmSync } from "node:fs";
import { DB_PATH } from "./config";

// Deletes the workflow database (and its WAL files). The next start reseeds from the fixture.
for (const suffix of ["", "-wal", "-shm"]) rmSync(DB_PATH + suffix, { force: true });
console.log(`Reset: removed ${DB_PATH}. It will be recreated from the fixture on next start.`);
