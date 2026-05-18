#!/usr/bin/env node
/**
 * Stage app source, commit, and push in one step.
 * Usage: npm run ship -- "your commit message"
 */
const { execSync, spawnSync } = require("child_process");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const message = process.argv.slice(2).join(" ").trim();

if (!message) {
  console.error("Usage: npm run ship -- \"commit message\"");
  console.error("");
  console.error("Stages client/src and server (not node_modules), commits, and pushes.");
  process.exit(1);
}

function run(cmd, opts = {}) {
  execSync(cmd, { cwd: repoRoot, stdio: "inherit", ...opts });
}

function statusPorcelain() {
  return execSync("git status --porcelain", {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
}

const before = statusPorcelain();
if (!before) {
  console.log("Working tree clean — nothing to commit.");
  const branch = execSync("git branch --show-current", {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  const push = spawnSync("git", ["push", "origin", branch], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  process.exit(push.status ?? 1);
}

run("git add client/src server/index.js server/routes");

const afterAdd = statusPorcelain();
const unstaged = afterAdd
  .split("\n")
  .filter((line) => line.startsWith("??") || line.startsWith(" M") || line.startsWith("M "));

if (unstaged.length > 0) {
  console.warn("\nNote: some paths were not staged (only client/src and server are included):");
  unstaged.forEach((line) => console.warn(" ", line));
}

run(`git commit -m ${JSON.stringify(message)}`);

const branch = execSync("git branch --show-current", {
  cwd: repoRoot,
  encoding: "utf8",
}).trim();

run(`git push -u origin ${branch}`);
console.log("\nDone — changes are on origin.");
