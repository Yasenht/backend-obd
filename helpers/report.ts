/**
 * Minimal, dependency-free PDF writer for health reports.
 *
 * The generated document intentionally contains only a plain-text summary in
 * English (Latin-1). It is a valid PDF 1.4 file and is suitable for reports
 * where a full layout engine is not available.
 */

const PageWidth = 595;
const PageHeight = 842;
const Margin = 50;
const FontSize = 10;
const Leading = 14;
const MaxLineLength = 96;

const escapePdfText = (value: string) =>
  value
    .replace(/[\\()]/g, (match) => `\\${match}`)
    .replace(/[^\x20-\x7E]/g, "?");

const wrapLine = (value: string) => {
  const Text = value.replace(/\s+/g, " ").trim();

  if (Text.length <= MaxLineLength) return [Text];

  const Lines: string[] = [];
  let Remaining = Text;

  while (Remaining.length > MaxLineLength) {
    let Cut = Remaining.lastIndexOf(" ", MaxLineLength);

    if (Cut <= 0) Cut = MaxLineLength;

    Lines.push(Remaining.slice(0, Cut));
    Remaining = Remaining.slice(Cut).trimStart();
  }

  if (Remaining) Lines.push(Remaining);

  return Lines;
};

const paginate = (lines: string[]) => {
  const Capacity = Math.floor((PageHeight - Margin * 2) / Leading);
  const Pages: string[][] = [];

  for (let index = 0; index < lines.length; index += Capacity) {
    Pages.push(lines.slice(index, index + Capacity));
  }

  return Pages.length ? Pages : [[]];
};

const contentStream = (lines: string[]) => {
  const Commands = [
    "BT",
    `/F1 ${FontSize} Tf`,
    `${Leading} TL`,
    `${Margin} ${PageHeight - Margin} Td`,
  ];

  for (const Line of lines) {
    Commands.push(`(${escapePdfText(Line)}) Tj`);
    Commands.push("T*");
  }

  Commands.push("ET");

  return Commands.join("\n");
};

export const renderTextPdf = (title: string, body: string[]) => {
  const Lines = [
    title,
    "",
    ...body.flatMap((line) => wrapLine(line)),
  ];

  const Pages = paginate(Lines);
  const PageIds = Pages.map((_, index) => 4 + index * 2);
  const ContentIds = Pages.map((_, index) => 5 + index * 2);
  const Objects: string[] = [];

  Objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  Objects[1] = `<< /Type /Pages /Kids [${
    PageIds.map((id) => `${id} 0 R`).join(" ")
  }] /Count ${Pages.length} >>`;
  Objects[2] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";

  Pages.forEach((PageLines, index) => {
    const Stream = contentStream(PageLines);

    Objects[PageIds[index] - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PageWidth} ${PageHeight}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${
        ContentIds[index]
      } 0 R >>`;

    Objects[ContentIds[index] - 1] = `<< /Length ${
      new TextEncoder().encode(Stream).length
    } >>\nstream\n${Stream}\nendstream`;
  });

  let Pdf = "%PDF-1.4\n";
  const Offsets: number[] = [];

  Objects.forEach((Object, index) => {
    Offsets[index] = new TextEncoder().encode(Pdf).length;
    Pdf += `${index + 1} 0 obj\n${Object}\nendobj\n`;
  });

  const XrefOffset = new TextEncoder().encode(Pdf).length;

  Pdf += `xref\n0 ${Objects.length + 1}\n`;
  Pdf += "0000000000 65535 f \n";

  for (const Offset of Offsets) {
    Pdf += `${String(Offset).padStart(10, "0")} 00000 n \n`;
  }

  Pdf += `trailer\n<< /Size ${
    Objects.length + 1
  } /Root 1 0 R >>\nstartxref\n${XrefOffset}\n%%EOF\n`;

  return new TextEncoder().encode(Pdf);
};
