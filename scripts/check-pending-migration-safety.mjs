import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const migrationRoot = path.resolve("packages/db/prisma/migrations");

const destructivePatterns = [
  /\bDROP\s+(?:TABLE|COLUMN|TYPE)\b/i,
  /\bRENAME\s+(?:COLUMN|TO)\b/i,
  /\bALTER\s+COLUMN\b[\s\S]*\bTYPE\b/i,
  /\bALTER\s+COLUMN\b[\s\S]*\bSET\s+NOT\s+NULL\b/i,
  /\bTRUNCATE\b/i,
];

try {
  const appliedRows = await prisma.$queryRawUnsafe(
    'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
  );
  const applied = new Set(appliedRows.map((row) => row.migration_name));
  const entries = await readdir(migrationRoot, { withFileTypes: true });
  const pending = entries
    .filter((entry) => entry.isDirectory() && !applied.has(entry.name))
    .map((entry) => entry.name)
    .sort();
  const violations = [];

  for (const migrationName of pending) {
    const sql = await readFile(
      path.join(migrationRoot, migrationName, "migration.sql"),
      "utf8",
    );
    const statements = sql
      .split(";")
      .map((statement) => statement.replace(/--.*$/gm, " ").replace(/\s+/g, " ").trim())
      .filter(Boolean);

    for (const statement of statements) {
      if (destructivePatterns.some((pattern) => pattern.test(statement))) {
        violations.push(`${migrationName}: ${statement.slice(0, 180)}`);
        continue;
      }

      if (
        /\bADD\s+COLUMN\b/i.test(statement) &&
        /\bNOT\s+NULL\b/i.test(statement) &&
        !/\bDEFAULT\b/i.test(statement)
      ) {
        violations.push(
          `${migrationName}: non-null column without a default is not compatible with the running API`,
        );
      }
    }
  }

  if (violations.length > 0) {
    console.error("Unsafe pending migrations detected:");
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    console.error(
      "Use an expand/contract release: add compatible schema first, deploy compatible code, then remove old schema in a later release.",
    );
    process.exitCode = 1;
  } else {
    console.log(
      pending.length > 0
        ? `Pending migrations are backward-compatible: ${pending.join(", ")}`
        : "No pending migrations require compatibility review.",
    );
  }
} finally {
  await prisma.$disconnect();
}
