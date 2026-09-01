export type PdfBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "spacer"; text?: string };

interface PositionedLine {
  text: string;
  font: "regular" | "bold";
  size: number;
  indent: number;
  gapAfter: number;
}

function ascii(value: string) {
  return value
    .replace(/[–—]/g, "-")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/→/g, "->")
    .replace(/•/g, "-")
    .replace(/[^\x20-\x7E\n]/g, "");
}

function escapePdfText(value: string) {
  return ascii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrap(text: string, maxChars: number) {
  const words = ascii(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (`${current} ${word}`.length <= maxChars) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function expandBlocks(title: string, blocks: PdfBlock[]): PositionedLine[] {
  const output: PositionedLine[] = [
    { text: title, font: "bold", size: 20, indent: 0, gapAfter: 14 },
  ];
  for (const block of blocks) {
    if (block.kind === "spacer") {
      output.push({ text: "", font: "regular", size: 9, indent: 0, gapAfter: 9 });
      continue;
    }
    const size = block.kind === "heading" ? 13 : 9;
    const font = block.kind === "heading" ? "bold" : "regular";
    const indent = block.kind === "bullet" ? 14 : 0;
    const prefix = block.kind === "bullet" ? "- " : "";
    const max = block.kind === "heading" ? 72 : block.kind === "bullet" ? 92 : 98;
    const lines = wrap(`${prefix}${block.text}`, max);
    lines.forEach((line, index) => {
      output.push({
        text: line,
        font,
        size,
        indent,
        gapAfter: index === lines.length - 1 ? (block.kind === "heading" ? 8 : 5) : 2,
      });
    });
  }
  return output;
}

function paginate(lines: PositionedLine[]) {
  const pages: PositionedLine[][] = [];
  let page: PositionedLine[] = [];
  let y = 730;
  for (const line of lines) {
    const height = Math.max(11, line.size + 3) + line.gapAfter;
    if (y - height < 58 && page.length > 0) {
      pages.push(page);
      page = [];
      y = 730;
    }
    page.push(line);
    y -= height;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

function streamForPage(lines: PositionedLine[], pageNumber: number, totalPages: number) {
  const commands: string[] = [];
  let y = 730;
  for (const line of lines) {
    if (line.text) {
      const font = line.font === "bold" ? "/F2" : "/F1";
      commands.push(`BT ${font} ${line.size} Tf ${54 + line.indent} ${y} Td (${escapePdfText(line.text)}) Tj ET`);
    }
    y -= Math.max(11, line.size + 3) + line.gapAfter;
  }
  commands.push(`BT /F1 7 Tf 54 30 Td (RepoFinisher investor report - page ${pageNumber} of ${totalPages}) Tj ET`);
  return commands.join("\n");
}

export function createSimplePdf(title: string, blocks: PdfBlock[]) {
  const pages = paginate(expandBlocks(title, blocks));
  const objects = new Map<number, string>();
  const pageIds: number[] = [];

  objects.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.set(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  pages.forEach((pageLines, index) => {
    const pageId = 5 + index * 2;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const stream = streamForPage(pageLines, index + 1, pages.length);
    objects.set(contentId, `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`);
    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
  });

  objects.set(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");

  const maxId = Math.max(...objects.keys());
  let pdf = "%PDF-1.4\n%RepoFinisher\n";
  const offsets: number[] = [0];
  for (let id = 1; id <= maxId; id += 1) {
    const object = objects.get(id);
    if (!object) throw new Error(`Missing PDF object ${id}`);
    offsets[id] = Buffer.byteLength(pdf, "utf8");
    pdf += `${id} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}
