const fs = require("fs");
const path = require("path");
const { renderSite } = require("../src/main.js");

function loadYamlParser() {
  try {
    return require("js-yaml");
  } catch (error) {
    const message = "Missing dependency: install js-yaml (npm i js-yaml) to parse src/main.yaml.";
    throw new Error(message);
  }
}

function readYaml(filePath) {
  const yamlText = fs.readFileSync(filePath, "utf8");
  const yamlParser = loadYamlParser();
  return yamlParser.load(yamlText);
}

function wrapHtml(bodyHtml, headExtras = "", bodyClass = "") {
  const bodyAttr = bodyClass ? ` class="${bodyClass}"` : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Static Build</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    ${headExtras}
  </head>
  <body${bodyAttr}>
    <main>
      ${bodyHtml}
    </main>
  </body>
</html>`;
}

function build() {
  const sourcePath = path.join(__dirname, "..", "src", "main.yaml");
  const outputDir = path.join(__dirname, "..", "tmp-build");
  const outputPath = path.join(outputDir, "index.html");
  const yaml = readYaml(sourcePath);
  const pages = renderSite(yaml);
  const baseStyles = ["/styles/site.css"];
  const styleMappings = {
    "/": baseStyles,
    "/m8-plate": baseStyles,
    "/m8-backpack": baseStyles,
    "/m8-kit": baseStyles,
    "/cart": baseStyles,
    "/checkout": baseStyles,
    "/stripe/return.html": baseStyles,
  };
  const styleSourceDir = path.join(__dirname, "..", "src", "styles");
  const styleOutputDir = path.join(outputDir, "styles");

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(styleOutputDir, { recursive: true });

  for (const styleList of Object.values(styleMappings)) {
    for (const stylePath of styleList) {
      const fileName = path.basename(stylePath);
      const sourceFile = path.join(styleSourceDir, fileName);
      const outputFile = path.join(styleOutputDir, fileName);
      if (fs.existsSync(sourceFile)) {
        fs.copyFileSync(sourceFile, outputFile);
      }
    }
  }

  for (const [route, html] of Object.entries(pages)) {
    const slug = route.replace(/^\/+/, "");
    const pageDir = slug ? path.join(outputDir, slug) : outputDir;
    const pagePath = path.join(pageDir, "index.html");
    const styleList = styleMappings[route] || [];
    const bodyClass = yaml.pages?.[route]?.body_class || "";
    const headExtras = styleList
      .map((href) => `<link rel="stylesheet" href="${href}" />`)
      .join("");
    fs.mkdirSync(pageDir, { recursive: true });
    fs.writeFileSync(pagePath, wrapHtml(html, headExtras, bodyClass), "utf8");
  }

  return outputPath;
}

if (require.main === module) {
  const outputPath = build();
  // eslint-disable-next-line no-console
  console.log(`Built ${outputPath}`);
}

module.exports = { build };
