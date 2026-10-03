// Text helpers shared by the export formats. helptai is English-only for now, so the PDF text
// layer uses WinAnsi (Windows-1252), which covers accented Latin letters and common punctuation.

const WIN_ANSI_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

// Symbols WinAnsi lacks, replaced by readable ASCII so search still works.
const ASCII_FALLBACK: Record<string, string> = {
  '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~',
  '−': '-', '∧': '^', '∨': 'v', '∞': 'inf', '✓': 'v',
  '∃': 'exists', '∀': 'forall', '⊨': '|=', '⊢': '|-', '∈': 'in', '∉': 'not in', '⊂': 'subset', '⊆': 'subseteq',
  '∪': 'union', '∩': 'intersect', '√': 'sqrt', '∑': 'sum', '∫': 'integral', 'α': 'alpha', 'β': 'beta', 'γ': 'gamma',
  'δ': 'delta', 'Δ': 'Delta', 'θ': 'theta', 'λ': 'lambda', 'μ': 'mu', 'π': 'pi', 'σ': 'sigma', 'Σ': 'Sigma',
  'φ': 'phi', 'ω': 'omega', 'Ω': 'Omega',
  '⁻': '-', '⁰': '0', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9',
};

export function toWinAnsiBytes(value: string): number[] {
  const out: number[] = [];
  for (const char of value.normalize('NFC')) {
    const code = char.codePointAt(0) ?? 63;
    if (code === 9 || code === 0xa0) out.push(32);
    else if (code >= 32 && code <= 126) out.push(code);
    else if (code >= 0xa1 && code <= 0xff) out.push(code);
    else if (WIN_ANSI_EXTRA[code] !== undefined) out.push(WIN_ANSI_EXTRA[code]);
    else if (ASCII_FALLBACK[char]) for (const c of ASCII_FALLBACK[char]) out.push(c.charCodeAt(0));
    else if (code < 32) out.push(32);
    else out.push(63);
  }
  return out;
}

// A PDF literal string "(...)" for WinAnsi bytes, using only ASCII characters.
export function pdfString(value: string) {
  let out = '(';
  for (const byte of toWinAnsiBytes(value)) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 32 || byte > 126) out += `\\${byte.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(byte);
  }
  return `${out})`;
}

export function xmlEscape(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function paragraphsOf(text: string) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

// Greedy word wrap by character count.
export function wrapText(text: string, maxChars: number) {
  const lines: string[] = [];
  for (const paragraph of paragraphsOf(text)) {
    let line = '';
    for (let word of paragraph.split(/\s+/)) {
      while (word.length > maxChars) {
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(word.slice(0, maxChars));
        word = word.slice(maxChars);
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

// "Untitled page" is noise in an export; fall back to the page number.
export function displayTitle(title: string, pageNumber: number) {
  const clean = title.trim();
  return !clean || /^untitled page$/i.test(clean) ? `Page ${pageNumber}` : clean;
}

// "Page 3 - Title" for headings and navigation; just "Page 3" when there is no real title.
export function pageHeading(title: string, pageNumber: number) {
  const clean = title.trim();
  return !clean || /^untitled page$/i.test(clean) ? `Page ${pageNumber}` : `Page ${pageNumber} \u2014 ${clean}`;
}
