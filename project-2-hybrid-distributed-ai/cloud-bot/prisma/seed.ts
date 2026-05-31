/**
 * Thin entry for `prisma db seed` (and `npm run seed`) in local development,
 * executed via tsx. The real logic lives in ../src/seed.ts so production runs
 * the compiled dist/seed.js without needing tsx. Importing it for its side
 * effect runs the seed.
 */
import "../src/seed.js";
