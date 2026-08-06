export interface DocSection {
  id: string;
  heading?: string;
  body: string;
  /** Vùng khoá template (Loại B) — không contentEditable */
  locked?: boolean;
}

/** Parse plain text mẫu thành section kiểu HĐ dịch vụ. */
export function parseContractSections(text: string): DocSection[] {
  const blocks = (text || "").trim().split(/\n\s*\n/);
  return blocks.map((block, i) => {
    const lines = block.split("\n");
    const first = lines[0] || "";
    const isHeading = /^ĐIỀU\s+\d+/i.test(first) || /^Điều\s+\d+/i.test(first);
    if (isHeading && lines.length > 1) {
      return {
        id: `s_${i}`,
        heading: first,
        body: lines.slice(1).join("\n"),
        locked: /BẢO MẬT|bảo mật/i.test(first),
      };
    }
    return {
      id: `s_${i}`,
      body: block,
      locked: false,
    };
  });
}
