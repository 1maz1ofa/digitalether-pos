// generate-sitemap.js
// Generates SITEMAP.md with a full repo tree structure

const fs = require("fs");
const path = require("path");

// folders to ignore
const IGNORE = new Set([
  "node_modules",
  ".git",
  ".vscode",
  ".idea",
  "dist",
  "build"
]);

// recursively build the tree
function buildTree(dir, prefix = "") {
  let output = "";
  const items = fs.readdirSync(dir, { withFileTypes: true });

  items.forEach((item, index) => {
    const isLast = index === items.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const nextPrefix = isLast ? "    " : "│   ";

    if (IGNORE.has(item.name)) return;

    output += `${prefix}${connector}${item.name}\n`;

    if (item.isDirectory()) {
      const subDir = path.join(dir, item.name);
      output += buildTree(subDir, prefix + nextPrefix);
    }
  });

  return output;
}

// generate the tree
const projectRoot = process.cwd();
const tree = buildTree(projectRoot);

// markdown content
const mdContent = `# 📁 Repository Sitemap

This file documents the full folder & file structure of the project.

---

\`\`\`
${tree}
\`\`\`

Generated on: ${new Date().toLocaleString()}
`;

// write SITEMAP.md
fs.writeFileSync(path.join(projectRoot, "SITEMAP.md"), mdContent);

console.log("✅ SITEMAP.md has been generated!");