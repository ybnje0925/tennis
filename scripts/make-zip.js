import archiver from "archiver";
import { createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";

const outputName = process.argv[2] || "tennis-jabajwo.zip";
const entries = [
  "package.json",
  "package-lock.json",
  ".env.example",
  ".gitignore",
  "README.md",
  "Dockerfile",
  "src",
  "public",
  "tests",
  "scripts"
];

const output = createWriteStream(outputName);
const archive = archiver("zip", { zlib: { level: 9 } });

archive.pipe(output);
archive.on("error", (error) => {
  throw error;
});

for (const entry of entries) {
  try {
    const info = await stat(entry);
    if (info.isDirectory()) archive.directory(entry, entry);
    else archive.file(entry, { name: entry });
  } catch (error) {
    if (entry !== "package-lock.json") throw error;
  }
}

await archive.finalize();
